"""
Utilidades de seguridad:
  - RateLimiter: limitador de tasa en memoria (ventana deslizante por clave).
  - client_ip: IP real del cliente (nginx fija X-Real-IP en /data/report).
  - Validadores de parámetros que se interpolan en consultas Flux, para evitar
    inyección (station / measurement / tiempos start-stop).
"""
import re
import time
from collections import defaultdict, deque
from typing import Optional


# --- Limitador de tasa (en memoria, por clave; p. ej. por IP) ---
class RateLimiter:
    """Permite hasta `limit` eventos por `window_s` segundos para cada clave."""

    # Cada cuánto se barren las claves (IPs) que ya no tienen eventos en su ventana:
    # antes nunca se borraban y el dict crecía con cada IP distinta que llegaba.
    _SWEEP_S = 600

    def __init__(self) -> None:
        self._hits: "defaultdict[str, deque]" = defaultdict(deque)
        self._last_sweep = time.time()

    def allow(self, key: str, limit: int, window_s: float) -> bool:
        now = time.time()
        if now - self._last_sweep > self._SWEEP_S:
            self._last_sweep = now
            for k in [k for k, d in self._hits.items() if not d or d[-1] <= now - window_s]:
                del self._hits[k]
        dq = self._hits[key]
        cutoff = now - window_s
        while dq and dq[0] <= cutoff:
            dq.popleft()
        if len(dq) >= limit:
            return False
        dq.append(now)
        return True


def client_ip(request) -> str:
    """IP real del cliente. nginx fija X-Real-IP; si no, X-Forwarded-For o socket."""
    xri = request.headers.get("x-real-ip")
    if xri:
        return xri.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


# --- Validadores anti-inyección para parámetros que entran a Flux ---
# Nombre de estación secundaria: minúsculas/dígitos/guion/guion bajo.
_STATION_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
# Measurement de InfluxDB: alfanumérico + guion bajo.
_MEASUREMENT_RE = re.compile(r"^[A-Za-z0-9_]{1,40}$")
# Tiempo Flux: duración relativa (-24h, -7d, 90d, -3650d…) con unidades válidas.
_DURATION_RE = re.compile(r"^-?\d+(ns|us|µs|ms|s|m|h|d|w|mo|y)$")
# Timestamp RFC3339 (fecha, opcionalmente con hora y zona).
_RFC3339_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}"
    r"([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$"
)


def validate_station(station: Optional[str]) -> Optional[str]:
    """None (principal) o un nombre seguro; si no, ValueError."""
    if station is None:
        return None
    if not _STATION_RE.match(station):
        raise ValueError("Parámetro 'station' inválido")
    return station


def validate_measurement(measurement: str) -> str:
    if not _MEASUREMENT_RE.match(measurement or ""):
        raise ValueError("Parámetro 'measurement' inválido")
    return measurement


def validate_flux_time(value: str, name: str = "tiempo") -> str:
    """Acepta now(), duración relativa o RFC3339; si no, ValueError."""
    v = (value or "").strip()
    if v == "now()" or _DURATION_RE.match(v) or _RFC3339_RE.match(v):
        return v
    raise ValueError(f"Parámetro '{name}' inválido")

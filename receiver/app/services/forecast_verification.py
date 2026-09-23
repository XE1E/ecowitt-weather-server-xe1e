"""
Verificación de pronósticos: ¿quién ACERTÓ, no sólo quién coincidió con quién?

La tarjeta vieja de "Precisión del pronóstico" comparaba la cámara contra
Open-Meteo, pero una coincidencia/diferencia entre dos fuentes no dice cuál
tenía razón. Aquí cada fuente se califica contra lo OBSERVADO:

- **Lluvia**: la verdad es el pluviómetro propio (`rain_total`, el conteo
  exacto del balancín -- ver `InfluxDBStorage.get_rain_hours`). "Llovió" es
  >= RAIN_MM_THRESHOLD en la ventana: un solo volteo suelto (rocío, un golpe)
  no cuenta como lluvia.
- **Nubosidad**: la verdad es la cámara (es una observación, no un modelo);
  sólo se mide cuánto se desvía el modelo de lo que se vio.

Dos horizontes:
- `now`: ¿llueve AHORA? (ventana +-30 min alrededor de cada captura de la
  cámara). Retroactivo: sale del histórico diario de la cámara, que ya guarda
  lo que Open-Meteo predecía para esa hora (ver `CameraStore._append_to_daily`).
- `next3h`: ¿lloverá en las PRÓXIMAS 3 h? La presión propia se reconstruye
  de InfluxDB (retroactiva); el resto de fuentes (Open-Meteo, WeatherAPI, SMN,
  "nuestro pronóstico", tendencia de la cámara) sólo desde que existe la
  bitácora de pronósticos (`ForecastLog`, una foto cada 30 min).

Métricas (tabla de contingencia estándar de verificación meteorológica):
- POD ("avisó"): de las veces que llovió, cuántas lo avisó.
- FAR ("falsas alarmas"): de las veces que avisó, cuántas NO llovió.
- CSI ("acierto en lluvia"): aciertos / (aciertos + fallos + falsas alarmas).
  Es la métrica principal porque NO premia decir siempre "no llueve": la
  exactitud simple sí (si llueve el 9% del tiempo, "nunca llueve" tiene 91%).

Todo aquí es puro (recibe series ya obtenidas) para poder probarlo sin
InfluxDB, igual que services/digest.py.
"""
import bisect
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

from .forecaster import classify_trend

logger = logging.getLogger(__name__)

RAIN_MM_THRESHOLD = 0.2
NOW_WINDOW_MIN = 30
HORIZON_H = 3
TREND_DAYS = 7
MIN_EVENTS_FOR_CSI = 3  # con menos casos "de lluvia" el CSI es puro ruido

_PRECIP_CONDITIONS = {"rainy", "stormy"}
_CLOUDINESS_RANK = {"clear": 0, "partly_cloudy": 1, "mostly_cloudy": 2, "overcast": 3}

# Etiquetas para la UI. El orden es el de la tarjeta; el color lo pone el
# frontend por clave (el color sigue a la fuente, nunca al lugar en el ranking).
SOURCE_LABELS = {
    "openmeteo": "Open-Meteo",
    "camera": "Cámara",
    # Se sigue calificando para ver si algún día aporta, pero desde 2026-09-23
    # ya no dispara lluvia en `own_forecast` (ver su docstring).
    "pressure": "Presión propia (ya no se usa)",
    "own": "Nuestro pronóstico",
    "camera_trend": "Cámara (nubes de lluvia formándose)",
    "weatherapi": "WeatherAPI",
    "smn": "SMN",
}
# Referencia "a vencer": avisar lluvia sólo por la hora local, sin mirar nada
# más. En el backtest de 2026-09-23 (30 días, lluvia a 3 h) daba CSI 26%, el
# doble que la presión: una fuente que no la supera no aporta información.
CLIMATOLOGY_KEY = "climatology"
CLIMATOLOGY_HOURS = (14, 20)  # inclusive, hora local
SOURCE_LABELS[CLIMATOLOGY_KEY] = f"Solo por horario ({CLIMATOLOGY_HOURS[0]}-{CLIMATOLOGY_HOURS[1]} h)"

NOW_SOURCES = ("openmeteo", "camera", CLIMATOLOGY_KEY)
NEXT3H_SOURCES = ("own", "pressure", "openmeteo", "weatherapi", "smn", "camera_trend", CLIMATOLOGY_KEY)


# ---------------------------------------------------------------- verdad ---

class RainIndex:
    """Lluvia observada por intervalos, a partir de la serie de `rain_total`
    (contador acumulado; se reinicia a 0 en año nuevo -> ese salto negativo
    se toma como 0, igual criterio que `get_rain_hours`)."""

    def __init__(self, rain_total: Sequence[Tuple[datetime, float]]):
        self.times: List[datetime] = []
        self.cum: List[float] = []
        acc = 0.0
        prev: Optional[float] = None
        for t, v in rain_total:
            if prev is not None:
                acc += max(0.0, v - prev)
            prev = v
            self.times.append(t)
            self.cum.append(acc)

    @property
    def start(self) -> Optional[datetime]:
        return self.times[0] if self.times else None

    @property
    def end(self) -> Optional[datetime]:
        return self.times[-1] if self.times else None

    def covers(self, a: datetime, b: datetime) -> bool:
        return bool(self.times) and self.times[0] <= a and b <= self.times[-1]

    def between(self, a: datetime, b: datetime) -> float:
        """mm caídos en (a, b]."""
        if not self.times:
            return 0.0
        i = bisect.bisect_right(self.times, a) - 1
        j = bisect.bisect_right(self.times, b) - 1
        ca = self.cum[i] if i >= 0 else 0.0
        cb = self.cum[j] if j >= 0 else 0.0
        return max(0.0, cb - ca)

    def rained(self, a: datetime, b: datetime) -> bool:
        return self.between(a, b) >= RAIN_MM_THRESHOLD


# ------------------------------------------------------------- métricas ---

def contingency(pairs: Iterable[Tuple[bool, bool]]) -> Dict[str, Any]:
    """(predijo lluvia, llovió) -> tabla de contingencia + POD/FAR/CSI."""
    hits = misses = fa = cn = 0
    for pred, obs in pairs:
        if pred and obs:
            hits += 1
        elif obs:
            misses += 1
        elif pred:
            fa += 1
        else:
            cn += 1
    n = hits + misses + fa + cn
    events = hits + misses + fa

    def pct(num: int, den: int) -> Optional[float]:
        return round(100 * num / den, 1) if den else None

    return {
        "n": n,
        "hits": hits, "misses": misses, "false_alarms": fa, "correct_negatives": cn,
        "observed": hits + misses,
        "predicted": hits + fa,
        "pod": pct(hits, hits + misses),
        "far": pct(fa, hits + fa),
        "csi": pct(hits, events) if events >= MIN_EVENTS_FOR_CSI else None,
        "accuracy": pct(hits + cn, n),
    }


# -------------------------------------------------------- casos a calificar ---

# Un caso = (instante UTC, {fuente: predijo_lluvia}, llovió)
Case = Tuple[datetime, Dict[str, bool], bool]


def _parse_ts(s: str) -> Optional[datetime]:
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def cases_now(camera_entries: Iterable[Dict[str, Any]], rain: RainIndex) -> List[Case]:
    """¿Llueve AHORA? por captura de la cámara (histórico diario).

    Se omiten las de noche (la cámara no ve bien sin luz) y las que no tienen
    pronóstico guardado: así Open-Meteo y la cámara se califican sobre
    EXACTAMENTE los mismos instantes y el ranking es justo."""
    out: List[Case] = []
    w = timedelta(minutes=NOW_WINDOW_MIN)
    for e in camera_entries:
        if "forecast_condition" not in e or e.get("condition") == "night":
            continue
        ts = _parse_ts(e.get("ts", ""))
        if ts is None or not rain.covers(ts - w, ts + w):
            continue
        preds = {
            "openmeteo": e.get("forecast_condition") in _PRECIP_CONDITIONS,
            "camera": bool(e.get("precip")) or e.get("condition") in _PRECIP_CONDITIONS,
        }
        out.append((ts, preds, rain.rained(ts - w, ts + w)))
    return out


def pressure_predictions(pressure: Sequence[Tuple[datetime, float]],
                         step_min: int = 30) -> List[Tuple[datetime, bool]]:
    """Reconstruye, cada `step_min`, lo que habría dicho la tendencia de
    presión propia (misma clasificación que /api/forecast/local): "va a
    llover" si la presión va bajando (falling/falling_fast) en 3 h."""
    if not pressure:
        return []
    times = [t for t, _ in pressure]
    out: List[Tuple[datetime, bool]] = []
    t = times[0] + timedelta(hours=HORIZON_H)
    t = t.replace(minute=(t.minute // step_min) * step_min, second=0, microsecond=0)
    tol = timedelta(minutes=20)
    while t <= times[-1]:
        i = bisect.bisect_right(times, t) - 1
        j = bisect.bisect_right(times, t - timedelta(hours=HORIZON_H)) - 1
        if i >= 0 and j >= 0 and t - times[i] <= tol and (t - timedelta(hours=HORIZON_H)) - times[j] <= tol:
            code = classify_trend(pressure[i][1] - pressure[j][1])["code"]
            out.append((t, code in ("falling", "falling_fast")))
        t += timedelta(minutes=step_min)
    return out


def cases_next3h(pressure: Sequence[Tuple[datetime, float]],
                 snapshots: Iterable[Dict[str, Any]],
                 rain: RainIndex) -> List[Case]:
    """¿Lloverá en las próximas 3 h? Une la presión reconstruida (cada 30 min)
    con la bitácora de pronósticos (también cada 30 min) en el mismo instante
    redondeado, para que cada caso lleve todas las fuentes disponibles."""
    by_slot: Dict[datetime, Dict[str, bool]] = {}

    def slot(t: datetime) -> datetime:
        return t.replace(minute=(t.minute // 30) * 30, second=0, microsecond=0)

    for t, pred in pressure_predictions(pressure):
        by_slot.setdefault(slot(t), {})["pressure"] = pred
    for snap in snapshots:
        ts = _parse_ts(snap.get("ts", ""))
        if ts is None:
            continue
        preds = by_slot.setdefault(slot(ts), {})
        for k, v in (snap.get("p") or {}).items():
            if k != "pressure" and isinstance(v, dict) and v.get("rain") is not None:
                preds[k] = bool(v["rain"])

    out: List[Case] = []
    h = timedelta(hours=HORIZON_H)
    for t in sorted(by_slot):
        if not rain.covers(t, t + h):
            continue  # la ventana aún no termina (o no hay datos): no se califica
        out.append((t, by_slot[t], rain.rained(t, t + h)))
    return out


# ------------------------------------------------------------ resúmenes ---

def summarize(cases: List[Case], sources: Sequence[str], tz: ZoneInfo) -> Dict[str, Any]:
    """Ranking, desglose por hora local y tendencia diaria (CSI móvil de 7 días)."""
    ranking = []
    for s in sources:
        pairs = [(p[s], obs) for _, p, obs in cases if s in p]
        m = contingency(pairs)
        if m["n"]:
            ranking.append({"key": s, "label": SOURCE_LABELS.get(s, s),
                            "reference": s == CLIMATOLOGY_KEY, **m})
    ranking.sort(key=lambda r: (r["csi"] is None, -(r["csi"] or 0), -(r["pod"] or 0)))

    by_hour = []
    for hr in range(24):
        sub = [(p, obs) for t, p, obs in cases if t.astimezone(tz).hour == hr]
        if not sub:
            continue
        row: Dict[str, Any] = {"hour": hr, "n": len(sub),
                               "observed_pct": round(100 * sum(o for _, o in sub) / len(sub), 1),
                               "predicted_pct": {}}
        for s in sources:
            vals = [p[s] for p, _ in sub if s in p]
            if vals:
                row["predicted_pct"][s] = round(100 * sum(vals) / len(vals), 1)
        by_hour.append(row)

    by_date: Dict[str, List[Case]] = {}
    for c in cases:
        by_date.setdefault(c[0].astimezone(tz).strftime("%Y-%m-%d"), []).append(c)
    dates = sorted(by_date)
    trend = []
    for i, d in enumerate(dates):
        window = [c for dd in dates[max(0, i - TREND_DAYS + 1):i + 1] for c in by_date[dd]]
        day_cases = by_date[d]
        row = {"date": d, "rained": any(obs for _, _, obs in day_cases), "csi": {}}
        for s in sources:
            pairs = [(p[s], obs) for _, p, obs in window if s in p]
            if pairs:
                row["csi"][s] = contingency(pairs)["csi"]
        trend.append(row)

    n = len(cases)
    return {
        "n": n,
        "observed_pct": round(100 * sum(obs for _, _, obs in cases) / n, 1) if n else None,
        "ranking": ranking,
        "by_hour": by_hour,
        "trend": trend,
    }


def sky_summary(camera_entries: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """Nubosidad: cuánto se desvía Open-Meteo de lo que VIO la cámara.

    Sólo capturas de día en las que NINGUNO de los dos dice lluvia (eso ya lo
    califica el eje de lluvia contra el pluviómetro, que es la verdad ahí)."""
    steps = {"0": 0, "1": 0, "2+": 0}
    diffs: List[float] = []
    rain_disagree = 0
    for e in camera_entries:
        cam, fc = e.get("condition"), e.get("forecast_condition")
        if fc is None or cam == "night":
            continue
        cam_rain = bool(e.get("precip")) or cam in _PRECIP_CONDITIONS
        fc_rain = fc in _PRECIP_CONDITIONS
        if cam_rain or fc_rain:
            rain_disagree += cam_rain != fc_rain
            continue
        if cam in _CLOUDINESS_RANK and fc in _CLOUDINESS_RANK:
            d = abs(_CLOUDINESS_RANK[cam] - _CLOUDINESS_RANK[fc])
            steps["0" if d == 0 else "1" if d == 1 else "2+"] += 1
        if e.get("forecast_coverage_pct") is not None and e.get("coverage") is not None:
            diffs.append(float(e["forecast_coverage_pct"]) - float(e["coverage"]))
    n = sum(steps.values())
    return {
        "n": n,
        "steps": steps,
        "steps_pct": {k: round(100 * v / n, 1) if n else None for k, v in steps.items()},
        # Positivo = el modelo pronostica MÁS nubes de las que se vieron.
        "coverage_bias_pct": round(sum(diffs) / len(diffs), 1) if diffs else None,
        "coverage_mae_pct": round(sum(abs(d) for d in diffs) / len(diffs), 1) if diffs else None,
        "rain_disagreements": rain_disagree,
    }


# ------------------------------------------------------ bitácora (disco) ---

class ForecastLog:
    """Bitácora de lo que dijo cada fuente, una foto cada ~30 min, un JSON por
    día local (mismo esquema de archivos que el histórico de la cámara). Sin
    esto no hay forma de calificar pronósticos a 3 h: los modelos sólo
    exponen el pronóstico VIGENTE, no lo que dijeron hace 3 horas."""

    def __init__(self, directory: str, tz: ZoneInfo, retention_days: int = 120):
        self.dir = directory
        self.tz = tz
        self.retention_days = retention_days

    def _path(self, date_str: str) -> str:
        datetime.strptime(date_str, "%Y-%m-%d")  # valida (anti path traversal)
        return os.path.join(self.dir, f"{date_str}.json")

    def read_day(self, date_str: str) -> List[Dict[str, Any]]:
        try:
            with open(self._path(date_str), encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except (OSError, ValueError):
            return []

    def append(self, snapshot: Dict[str, Any], now: Optional[datetime] = None) -> None:
        now = now or datetime.now(timezone.utc)
        date_str = now.astimezone(self.tz).strftime("%Y-%m-%d")
        os.makedirs(self.dir, exist_ok=True)
        day = self.read_day(date_str)
        day.append(snapshot)
        path = self._path(date_str)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(day, f, ensure_ascii=False)
        os.replace(tmp, path)
        self._prune(now)

    def read_range(self, days: int, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
        now = now or datetime.now(timezone.utc)
        today = now.astimezone(self.tz).date()
        out: List[Dict[str, Any]] = []
        for i in range(days, -1, -1):
            out.extend(self.read_day((today - timedelta(days=i)).strftime("%Y-%m-%d")))
        return out

    def first_day(self) -> Optional[str]:
        """Primer día con bitácora (YYYY-MM-DD), para decir en la UI desde
        cuándo se acumulan las fuentes que no se pueden reconstruir."""
        try:
            dias = sorted(os.path.splitext(n)[0] for n in os.listdir(self.dir)
                          if n.endswith(".json") and len(n) == 15)
        except OSError:
            return None
        return dias[0] if dias else None

    def _prune(self, now: datetime) -> None:
        limite = (now.astimezone(self.tz) - timedelta(days=self.retention_days)).strftime("%Y-%m-%d")
        try:
            for nombre in os.listdir(self.dir):
                base, ext = os.path.splitext(nombre)
                if ext == ".json" and len(base) == 10 and base < limite:
                    os.remove(os.path.join(self.dir, nombre))
        except OSError as e:
            logger.warning(f"No se pudo podar la bitácora de pronósticos: {e}")


def max_prob_next_hours(times: Sequence[str], probs: Sequence[Any], now_local: datetime,
                        hours: int = HORIZON_H) -> Optional[float]:
    """Máxima probabilidad de lluvia (%) en las horas locales que tocan la
    ventana (ahora, ahora+`hours`]. `times` en formato "YYYY-MM-DDTHH:MM" local
    (Open-Meteo con timezone=auto, WeatherAPI, SMN)."""
    start = now_local.replace(minute=0, second=0, microsecond=0)
    keys = {(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H") for i in range(hours + 1)}
    vals = []
    for t, p in zip(times, probs):
        if isinstance(t, str) and t[:13] in keys and isinstance(p, (int, float)):
            vals.append(float(p))
    return max(vals) if vals else None


PROB_THRESHOLD = 50.0


def prob_prediction(prob: Optional[float]) -> Dict[str, Any]:
    """{"prob": %, "rain": ¿avisa lluvia?} -- umbral fijo de 50%: es lo que un
    lector entiende por "dice que va a llover"."""
    return {"prob": prob, "rain": None if prob is None else prob >= PROB_THRESHOLD}


def build_report(camera_entries: List[Dict[str, Any]], rain_total: Sequence[Tuple[datetime, float]],
                 pressure: Sequence[Tuple[datetime, float]], snapshots: List[Dict[str, Any]],
                 tz: ZoneInfo, days: int, log_started: Optional[str],
                 since: Optional[datetime] = None) -> Dict[str, Any]:
    """`since`: sólo se califican casos desde ese instante (la presión se pide
    con un día de margen para poder calcular su tendencia desde el principio)."""
    rain = RainIndex(rain_total)
    now_cases = cases_now(camera_entries, rain)
    next_cases = cases_next3h(pressure, snapshots, rain)
    if since is not None:
        now_cases = [c for c in now_cases if c[0] >= since]
        next_cases = [c for c in next_cases if c[0] >= since]
    lo, hi = CLIMATOLOGY_HOURS
    for t, preds, _ in now_cases + next_cases:
        preds[CLIMATOLOGY_KEY] = lo <= t.astimezone(tz).hour <= hi
    return {
        "days": days,
        "rain_threshold_mm": RAIN_MM_THRESHOLD,
        "prob_threshold_pct": PROB_THRESHOLD,
        "log_started": log_started,
        "horizons": {
            "now": summarize(now_cases, NOW_SOURCES, tz),
            "next3h": summarize(next_cases, NEXT3H_SOURCES, tz),
        },
        "sky": sky_summary(camera_entries),
    }

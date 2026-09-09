"""Tests del Índice de Calidad del Aire (NADF-009-AIRE-2017, lo que la gente
sigue llamando "IMECA"): promedios móviles reales por contaminante y el
tramo "Peligrosa" de PM10/PM2.5 con pendiente propia.
"""
import asyncio

from app.services.imeca import (
    _moving_avg,
    compute_imeca,
    get_imeca,
    AVG_WINDOW_H,
)


def test_moving_avg_ventana_completa():
    valores = [10.0, 20.0, 30.0, 40.0]
    # Ventana de 2 terminando en el índice 3 (últimos dos: 30, 40) -> 35
    assert _moving_avg(valores, 3, 2) == 35.0


def test_moving_avg_ventana_de_1_es_el_valor_puntual():
    valores = [5.0, 15.0]
    assert _moving_avg(valores, 1, 1) == 15.0


def test_moving_avg_insuficiencia_de_informacion():
    """Norma §5: 8h necesita >=6 horas válidas, 24h necesita >=18.
    Con solo 3 de 8 horas válidas, no alcanza -> None (no se inventa un
    promedio con datos insuficientes)."""
    valores = [1.0, None, None, None, None, 2.0, None, 3.0]
    assert _moving_avg(valores, 7, 8) is None


def test_moving_avg_justo_en_el_umbral():
    """Exactamente 6 de 8 horas válidas (el mínimo que exige la norma) SÍ
    calcula el promedio."""
    valores = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, None, None]
    assert _moving_avg(valores, 7, 8) == 1.0


def test_moving_avg_fuera_de_rango():
    assert _moving_avg([1.0, 2.0], 5, 3) is None
    assert _moving_avg([1.0, 2.0], -1, 3) is None


def test_avg_window_por_contaminante():
    """O3/NO2 no se promedian mas alla de la hora; SO2/PM10/PM2.5 son 24h;
    CO es 8h -- exactamente lo que dice la norma NADF-009-AIRE-2017 §6.2."""
    assert AVG_WINDOW_H["ozone"] == 1
    assert AVG_WINDOW_H["nitrogen_dioxide"] == 1
    assert AVG_WINDOW_H["sulphur_dioxide"] == 24
    assert AVG_WINDOW_H["carbon_monoxide"] == 8
    assert AVG_WINDOW_H["pm10"] == 24
    assert AVG_WINDOW_H["pm2_5"] == 24


def test_pm10_tramo_peligroso_usa_pendiente_correcta():
    """Antes el tramo 425-604 (Peligrosa) era una sola recta; la norma
    (Anexo C, Tabla C.5) tiene DOS pendientes distintas ahi (425-504 y
    505-604). A 550 ug/m3 el indice oficial es 446, no ~440 (la version
    colapsada de antes)."""
    r = compute_imeca({"pm10": 550.0})
    assert r["available"] is True
    assert r["imeca"] == 446


def test_pm25_tramo_peligroso_usa_pendiente_correcta():
    """Mismo caso que PM10 pero para PM2.5 (Anexo C, Tabla C.6): a 400
    ug/m3 el indice oficial es 401 + 0.6604*(400-350.5) = 401 + 32.69 = 434."""
    r = compute_imeca({"pm2_5": 400.0})
    assert r["available"] is True
    assert r["imeca"] == 434


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class _FakeAsyncClient:
    def __init__(self, payload):
        self._payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, params=None, headers=None):
        return _FakeResponse(self._payload)


def _payload_pm25_pico_ultima_hora():
    """24 horas previas de PM2.5 en 10 ug/m3 (Buena) + la hora actual con
    un pico a 300 ug/m3. Si get_imeca usara el valor instantáneo (bug de
    antes), "ahora" saldría Peligrosa de golpe; con el promedio móvil de
    24h real, el pico se diluye entre las 24 horas."""
    horas = [f"2026-01-01T{h:02d}:00" for h in range(0, 24)] + ["2026-01-02T00:00"]
    pm25 = [10.0] * 24 + [300.0]
    ceros = [0.001] * len(horas)
    return {
        "current": {"time": horas[-1]},
        "hourly": {
            "time": horas,
            "pm2_5": pm25,
            "pm10": [0.0] * len(horas),
            "ozone": ceros, "nitrogen_dioxide": ceros,
            "sulphur_dioxide": ceros, "carbon_monoxide": ceros,
        },
    }


def test_get_imeca_usa_promedio_movil_no_el_valor_instantaneo(monkeypatch):
    import app.services.imeca as imeca_mod
    imeca_mod._CACHE.clear()

    payload = _payload_pm25_pico_ultima_hora()

    def fake_client(timeout=None):
        return _FakeAsyncClient(payload)

    monkeypatch.setattr(imeca_mod.httpx, "AsyncClient", fake_client)

    data = asyncio.run(get_imeca(19.4, -99.1))
    assert data["available"] is True
    # Promedio de 24h: 23*10 + 300 = 530 -> 530/24 = 22.08 ug/m3 -> índice
    # ~66 ("Regular"). El valor INSTANTÁNEO (300 ug/m3, el pico solo) daría
    # ~350 ("Peligrosa") -- así se veía antes del fix, con un solo pico de
    # una hora disparando la categoría más grave sin promediar nada.
    assert 55 <= data["imeca"] <= 75
    assert data["category"] == "Regular"

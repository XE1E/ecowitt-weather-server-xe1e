"""Tests del servicio de sismos (SSN/USGS), centrados en distance_km.

`check_earthquake` (alerts.py) necesita `distance_km` para el criterio de
"sismo cercano" -- antes solo la rama del SSN lo calculaba, la de USGS nunca
lo hacía (ver earthquakes.py::_from_usgs).
"""
import asyncio

from app.services.earthquakes import _haversine_km, _from_usgs


def test_haversine_un_grado_de_latitud():
    """1° de latitud son ~111 km en cualquier punto de la esfera."""
    dist = _haversine_km(19.0, -99.0, 20.0, -99.0)
    assert abs(dist - 111.2) < 1.0


def test_haversine_mismo_punto_es_cero():
    assert _haversine_km(19.38, -99.17, 19.38, -99.17) == 0.0


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


def test_from_usgs_computa_distance_km(monkeypatch):
    """Antes esta rama nunca incluía distance_km en el resultado -- el
    filtro de sismo cercano (check_earthquake) no podía aplicarse a sismos
    que llegaban por USGS en vez de por el SSN."""
    # Un punto a ~1° de latitud de la estación (19.0 vs 20.0) -> ~111 km
    payload = {
        "features": [{
            "properties": {"mag": 5.5, "place": "10 km SW of Somewhere", "time": 1700000000000, "url": "http://x"},
            "geometry": {"coordinates": [-99.0, 20.0, 12.5]},
        }]
    }

    def fake_client(timeout=None):
        return _FakeAsyncClient(payload)

    monkeypatch.setattr("app.services.earthquakes.httpx.AsyncClient", fake_client)

    quakes = asyncio.run(_from_usgs(19.0, -99.0, 800.0, 3.0, 10))
    assert len(quakes) == 1
    assert quakes[0]["mag"] == 5.5
    assert quakes[0]["depth_km"] == 12.5
    assert quakes[0]["distance_km"] is not None
    assert abs(quakes[0]["distance_km"] - 111) <= 2

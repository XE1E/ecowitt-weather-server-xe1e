"""Tests for the public-network publishers (WU-like protocol / WOW-BE)."""

import asyncio

from app.services.publishers import _wu_like


class FakeResponse:
    def __init__(self, status_code=200, text="success"):
        self.status_code = status_code
        self.text = text


class FakeClient:
    """Registra la última llamada a `get` sin tocar la red de verdad."""

    def __init__(self, status_code=200):
        self.status_code = status_code
        self.last_url = None
        self.last_params = None

    async def get(self, url, params=None, timeout=None):
        self.last_url = url
        self.last_params = params
        return FakeResponse(self.status_code)


DATA = {
    "temperature_outdoor": 20.0,
    "humidity_outdoor": 55,
    "dew_point": 11.0,
    "wind_speed": 10.0,
    "wind_gust": 20.0,
    "wind_direction": 180,
    "pressure_relative": 1015.0,
    "pressure_absolute": 780.0,
    "rain_hourly": 2.0,
    "rain_daily": 5.0,
    "solar_radiation": 400,
    "uv_index": 6,
    "temperature_indoor": 22.0,
    "humidity_indoor": 45,
}


def test_wu_like_default_keys_are_ID_PASSWORD():
    client = FakeClient()
    ok = asyncio.run(_wu_like(client, "https://example.com/update", "STATIONID", "secret", DATA, "Test"))
    assert ok is True
    assert client.last_params["ID"] == "STATIONID"
    assert client.last_params["PASSWORD"] == "secret"
    assert "siteid" not in client.last_params


def test_wu_like_custom_keys_for_wow_be():
    # WOW-BE reusa el mismo protocolo pero con otros nombres de campo para
    # el ID de estación y la clave de autenticación.
    client = FakeClient()
    ok = asyncio.run(_wu_like(
        client, "http://wow.meteo.be/api/v2/send", "site-uuid", "auth-key", DATA, "WOW-BE",
        id_key="siteid", pw_key="siteAuthenticationKey"))
    assert ok is True
    assert client.last_params["siteid"] == "site-uuid"
    assert client.last_params["siteAuthenticationKey"] == "auth-key"
    assert "ID" not in client.last_params
    assert "PASSWORD" not in client.last_params
    assert client.last_url == "http://wow.meteo.be/api/v2/send"


def test_wu_like_includes_absbaromin_when_present():
    client = FakeClient()
    asyncio.run(_wu_like(client, "https://example.com/update", "ID1", "pw", DATA, "Test"))
    assert "absbaromin" in client.last_params
    assert client.last_params["absbaromin"] > 0


def test_wu_like_omits_absbaromin_when_missing():
    client = FakeClient()
    data = {k: v for k, v in DATA.items() if k != "pressure_absolute"}
    asyncio.run(_wu_like(client, "https://example.com/update", "ID1", "pw", data, "Test"))
    assert "absbaromin" not in client.last_params


def test_wu_like_reports_failure_on_non_200():
    client = FakeClient(status_code=403)
    ok = asyncio.run(_wu_like(client, "https://example.com/update", "ID1", "pw", DATA, "Test"))
    assert ok is False

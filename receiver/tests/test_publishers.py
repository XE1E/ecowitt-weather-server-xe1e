"""Tests for the public-network publishers (WU-like protocol / WOW-BE / Weathercloud)."""

import asyncio

from app.services.publishers import _wu_like, _weathercloud, _awekas, _windy


class FakeResponse:
    def __init__(self, status_code=200, text="success"):
        self.status_code = status_code
        self.text = text


class FakeClient:
    """Registra la última llamada a `get` sin tocar la red de verdad."""

    def __init__(self, status_code=200, text="success"):
        self.status_code = status_code
        self.text = text
        self.last_url = None
        self.last_params = None
        self.last_headers = None

    async def get(self, url, params=None, timeout=None, headers=None):
        self.last_url = url
        self.last_params = params
        self.last_headers = headers
        return FakeResponse(self.status_code, self.text)


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
    "wind_chill": 18.0,
    "heat_index": 24.0,
    "rain_rate": 3.0,
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


def test_weathercloud_scales_values_by_10():
    client = FakeClient()
    ok = asyncio.run(_weathercloud(client, DATA, "WID123", "key123"))
    assert ok is True
    p = client.last_params
    assert p["wid"] == "WID123"
    assert p["key"] == "key123"
    assert p["temp"] == 200          # 20.0 °C -> 200
    assert p["tempin"] == 220        # 22.0 °C -> 220
    assert p["chill"] == 180         # 18.0 °C -> 180
    assert p["dew"] == 110           # 11.0 °C -> 110
    assert p["heat"] == 240          # 24.0 °C -> 240
    assert p["hum"] == 55            # % sin escalar
    assert p["humin"] == 45
    assert p["bar"] == 10150         # 1015.0 hPa -> 10150
    assert p["wdir"] == 180          # grados sin escalar
    assert p["rain"] == 50           # 5.0 mm -> 50
    assert p["rainrate"] == 30       # 3.0 mm/h -> 30
    assert p["solarrad"] == 4000     # 400 W/m2 -> 4000
    assert p["uvi"] == 60            # 6 -> 60


def test_weathercloud_wind_speed_converted_kmh_to_ms_then_scaled():
    client = FakeClient()
    asyncio.run(_weathercloud(client, DATA, "WID123", "key123"))
    # 10 km/h = 2.7778 m/s -> x10 -> 28 (redondeado)
    assert client.last_params["wspd"] == 28
    # 20 km/h gust = 5.5556 m/s -> x10 -> 56
    assert client.last_params["wspdhi"] == 56


def test_weathercloud_omits_missing_fields():
    client = FakeClient()
    data = {k: v for k, v in DATA.items() if k not in ("wind_chill", "heat_index")}
    asyncio.run(_weathercloud(client, data, "WID123", "key123"))
    assert "chill" not in client.last_params
    assert "heat" not in client.last_params
    # El resto sigue mandandose normal
    assert "temp" in client.last_params


def test_weathercloud_url_and_failure():
    client = FakeClient(status_code=401)
    ok = asyncio.run(_weathercloud(client, DATA, "WID123", "key123"))
    assert ok is False
    assert client.last_url == "http://api.weathercloud.net/v01/set"


def test_awekas_sends_condition_code_in_position_11():
    client = FakeClient(text="OK")
    ok = asyncio.run(_awekas(client, DATA, "xe1e", "pw", 19.38, -99.17, condition=3))
    assert ok is True
    assert ";3;" in client.last_url  # posicion 11 (partly cloudy)


def test_awekas_condition_blank_when_none():
    client = FakeClient(text="OK")
    asyncio.run(_awekas(client, DATA, "xe1e", "pw", 19.38, -99.17, condition=None))
    # posicion 10 (direccion) y 11 (condicion, vacia) seguidas de ";;"
    assert ";;en;" in client.last_url


def test_windy_v2_uses_station_id_and_bearer_password():
    client = FakeClient()
    ok = asyncio.run(_windy(client, DATA, "abc123", "s3cr3t"))
    assert ok is True
    assert client.last_url == "https://stations.windy.com/api/v2/observation/update"
    assert client.last_params["id"] == "abc123"
    assert client.last_headers == {"Authorization": "Bearer s3cr3t"}
    # la password NUNCA va en la query string
    assert "s3cr3t" not in str(client.last_params)


def test_windy_v2_field_names_and_units():
    client = FakeClient()
    asyncio.run(_windy(client, DATA, "abc123", "s3cr3t"))
    p = client.last_params
    assert p["humidity"] == 55       # no "rh" (protocolo v1 viejo)
    assert "rh" not in p
    assert p["pressure"] == 101500.0  # 1015.0 hPa -> Pa
    assert p["wind"] == round(10.0 / 3.6, 2)   # km/h -> m/s
    assert p["gust"] == round(20.0 / 3.6, 2)


def test_windy_v2_reports_failure_on_non_200():
    client = FakeClient(status_code=401)
    ok = asyncio.run(_windy(client, DATA, "abc123", "wrong-password"))
    assert ok is False

"""Pruebas de humo de los endpoints (app.main) con TestClient.

Red de seguridad para refactorizar main.py (docs/internal/PLAN-REVISION-CODIGO.md,
fase 0): la ingesta, las estaciones y el admin deben seguir respondiendo igual. Sin
InfluxDB ni red: `storage` y las tareas que salen a internet se sustituyen. El
TestClient se usa SIN `with`, así que el lifespan (tareas de fondo, MQTT) no arranca.
"""
import json

import pytest
from fastapi.testclient import TestClient

from app import main as m
from app import state
from app.routers import stations as r_stations
from app.services import admin as adminsvc

PRINCIPAL_PK = "A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6"
REMOTA_PK = "0F1E2D3C4B5A69788796A5B4C3D2E1F0"

WS2910 = {
    "PASSKEY": PRINCIPAL_PK, "stationtype": "EasyWeatherPro_V5.1.1",
    "dateutc": "2026-07-05+14:30:00", "tempinf": "75.2", "humidityin": "50",
    "baromrelin": "29.92", "baromabsin": "22.85", "tempf": "68.9", "humidity": "62",
    "winddir": "180", "windspeedmph": "5.6", "windgustmph": "8.2",
    "solarradiation": "245.6", "uv": "3", "rainratein": "0.00", "dailyrainin": "0.12",
    "model": "WS2910_Pro",
}
GW1100 = {
    "PASSKEY": REMOTA_PK, "stationtype": "GW1100B_V2.3.1", "dateutc": "2026-07-05+14:30:00",
    "tempinf": "77.0", "humidityin": "45", "baromrelin": "29.90", "baromabsin": "22.80",
    "model": "GW1100B",
}


class FakeStorage:
    """Lo mínimo de InfluxDBStorage que tocan estos endpoints."""

    def __init__(self):
        self.written = []

    async def write(self, data):
        self.written.append(dict(data))

    async def get_rain_accumulations(self, station=None):
        return {}

    async def get_rain_hours(self, hours=2, station=None):
        return None

    async def get_wind_avg10m(self, station=None):
        return None

    async def get_wind_dir_avg10m(self, station=None):
        return None


@pytest.fixture
def api(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(json.dumps({"stations": {"remota": {"label": "Remota", "alerts_enabled": True}}}),
                             encoding="utf-8")
    s = m.settings
    # Los endpoints de admin cambian `settings` en vivo (apply_overrides): se guarda
    # todo y se restaura al final para no contaminar las demás pruebas.
    snapshot = s.model_dump()
    for k, v in {
        "settings_file": str(settings_file),
        "primary_passkey": PRINCIPAL_PK,
        "secondary_stations": f"{REMOTA_PK}:remota",
        "admin_user": "admin", "admin_password": "secreto", "admin_password_hash": None,
        "ecowitt_ip_allowlist": "", "ecowitt_secure_enabled": False,
        "alerts_enabled": False, "mqtt_enabled": False,
    }.items():
        monkeypatch.setattr(s, k, v)

    fake = FakeStorage()
    latest: dict = {}
    # main.py y los routers (vía `state`) deben ver los MISMOS objetos.
    for mod in (m, state):
        monkeypatch.setattr(mod, "storage", fake)
        monkeypatch.setattr(mod, "latest_by_station", latest)
    from app.routers import data as r_data
    monkeypatch.setattr(r_data, "_current_extras_cache", {})
    # Nada sale a internet: la condición de AWEKAS y las redes públicas se registran.
    published = []

    async def _no_awekas(_data):
        return None

    async def _fake_publish(data, settings, awekas_condition=None):
        published.append(data)
        return {}

    monkeypatch.setattr(m, "_awekas_condition_code", _no_awekas)
    monkeypatch.setattr(m, "publish_all", _fake_publish)
    alerts = []

    async def _fake_process(data, **kw):
        alerts.append((kw.get("station"), data))

    monkeypatch.setattr(m.alert_service, "process", _fake_process)
    # Límites por IP limpios en cada prueba.
    monkeypatch.setattr(m, "_report_limiter", m.secsvc.RateLimiter())
    monkeypatch.setattr(m, "_login_limiter", m.secsvc.RateLimiter())

    client = TestClient(m.app)
    client.fake_storage = fake
    client.published = published
    client.alerts = alerts
    yield client
    for k, v in snapshot.items():
        setattr(s, k, v)


def _login(api) -> dict:
    r = api.post("/api/admin/login", json={"user": "admin", "password": "secreto"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_health(api):
    assert api.get("/health").json()["status"] == "healthy"


def test_ingest_principal_stores_publishes_and_hides_passkey(api):
    r = api.post("/data/report/", data=WS2910)
    assert r.status_code == 200 and r.json()["status"] == "success"
    row = api.fake_storage.written[-1]
    assert "station" not in row                      # la principal va sin tag
    assert "passkey" not in row                      # nunca se guarda el passkey
    assert row["temperature_outdoor"] == pytest.approx(20.5, abs=0.1)
    assert len(api.published) == 1                   # sólo la principal publica
    cur = api.get("/api/current").json()
    assert "passkey" not in cur and cur["humidity_outdoor"] == 62


def test_ingest_without_trailing_slash_is_accepted_too(api):
    assert api.post("/data/report", data=WS2910).status_code == 200


def test_ingest_secondary_is_tagged_and_not_published(api):
    assert api.post("/data/report/", data=GW1100).status_code == 200
    row = api.fake_storage.written[-1]
    assert row["station"] == "remota"
    assert api.published == []
    assert [st for st, _ in api.alerts] == ["remota"]  # alertas propias (activadas)
    assert api.get("/api/current", params={"station": "remota"}).status_code == 200
    assert api.get("/api/current").status_code == 404  # la principal aún sin datos


def test_ingest_rejects_unknown_passkey(api):
    r = api.post("/data/report/", data={**WS2910, "PASSKEY": "F" * 32})
    assert r.status_code == 403
    assert api.fake_storage.written == []


def test_ingest_uses_the_ip_nginx_sets_for_the_allowlist(api, monkeypatch):
    monkeypatch.setattr(m.settings, "ecowitt_ip_allowlist", "201.137.91.124")
    ok = api.post("/data/report/", data=WS2910, headers={"X-Real-IP": "201.137.91.124"})
    no = api.post("/data/report/", data=WS2910, headers={"X-Real-IP": "8.8.8.8"})
    assert (ok.status_code, no.status_code) == (200, 403)


def test_stations_lists_principal_and_secondary(api):
    api.post("/data/report/", data=WS2910)
    names = [s["name"] for s in api.get("/api/stations").json()["stations"]]
    assert names == [None, "remota"]


def test_admin_requires_login(api):
    assert api.get("/api/admin/settings").status_code == 401
    assert api.post("/api/admin/login", json={"user": "admin", "password": "mal"}).status_code == 401


def test_admin_login_then_read_and_save_settings(api):
    h = _login(api)
    s = api.get("/api/admin/settings", headers=h).json()
    assert "alerts_enabled" in s and "admin_password" not in s
    r = api.post("/api/admin/settings", headers=h, json={"alert_temp_high": 33.5})
    assert r.status_code == 200
    assert m.settings.alert_temp_high == 33.5
    saved = json.loads(open(m.settings.settings_file, encoding="utf-8").read())
    assert saved["alert_temp_high"] == 33.5
    assert saved["stations"]["remota"]["label"] == "Remota"  # no borra lo demás


def test_login_rate_limit_is_per_real_ip(api):
    for _ in range(12):
        api.post("/api/admin/login", json={"user": "x", "password": "y"},
                 headers={"X-Real-IP": "9.9.9.9"})
    blocked = api.post("/api/admin/login", json={"user": "admin", "password": "secreto"},
                       headers={"X-Real-IP": "9.9.9.9"})
    other = api.post("/api/admin/login", json={"user": "admin", "password": "secreto"},
                     headers={"X-Real-IP": "7.7.7.7"})
    assert blocked.status_code == 429
    assert other.status_code == 200


def test_add_and_delete_secondary_station(api):
    h = _login(api)
    r = api.post("/api/admin/stations", headers=h, json={"name": "azotea", "mac": "8C:4F:00:4F:8B:63"})
    assert r.status_code == 200, r.text
    assert "azotea" in m.settings.secondary_station_map.values()
    names = [s["name"] for s in api.get("/api/stations").json()["stations"]]
    assert "azotea" in names
    # Cambiar la MAC de una que no existe ya no da de alta
    r = api.post("/api/admin/registry/secondary", headers=h, json={"name": "nueva", "mac": "8C:4F:00:4F:8B:64"})
    assert r.status_code == 404
    assert api.delete("/api/admin/stations/azotea", headers=h).status_code == 200
    assert "azotea" not in m.settings.secondary_station_map.values()


def test_station_config_put_needs_admin_and_merges(api):
    assert api.put("/api/stations/remota", json={"config": {"label": "X"}}).status_code == 401
    h = _login(api)
    assert api.put("/api/stations/remota", headers=h, json={"config": {"label": "Azotea"}}).status_code == 200
    cfg = api.get("/api/stations/remota").json()["config"]
    assert cfg["label"] == "Azotea" and cfg["alerts_enabled"] is True


@pytest.fixture(autouse=True)
def _clean_sessions():
    adminsvc._SESSIONS.clear()
    yield
    adminsvc._SESSIONS.clear()


def test_station_status_compares_utc_received_at_with_utc_now(monkeypatch):
    """received_at va en UTC sin zona: con el contenedor en hora de México, una
    estación callada hace 30 min debe salir offline, no "en línea" 6 h más."""
    from datetime import datetime, timedelta
    import time as _time
    monkeypatch.setenv("TZ", "America/Mexico_City")
    if hasattr(_time, "tzset"):
        _time.tzset()
    hace_30 = (datetime.utcnow() - timedelta(minutes=30)).isoformat()
    hace_2 = (datetime.utcnow() - timedelta(minutes=2)).isoformat()
    assert r_stations._station_status(hace_30, 15) == "offline"
    assert r_stations._station_status(hace_2, 15) == "online"
    assert r_stations._station_status(hace_2 + "Z", 15) == "online"


def test_admin_settings_exposes_principal_altitude(api):
    h = _login(api)
    assert "station_altitude_m" in api.get("/api/admin/settings", headers=h).json()


def test_principal_station_uses_global_offline_minutes(api, monkeypatch):
    monkeypatch.setattr(m.settings, "alert_station_offline_minutes", 5)
    from datetime import datetime, timedelta
    api.post("/data/report/", data=WS2910)
    m.latest_by_station[None]["received_at"] = (datetime.utcnow() - timedelta(minutes=10)).isoformat()
    assert api.get("/api/stations/_principal").json()["status"] == "offline"
    assert api.get("/api/stations").json()["stations"][0]["status"] == "offline"


def test_rate_limiter_forgets_idle_ips(monkeypatch):
    from app.services import security
    rl = security.RateLimiter()
    t = [1000.0]
    monkeypatch.setattr(security.time, "time", lambda: t[0])
    rl._last_sweep = t[0]
    for i in range(50):
        rl.allow(f"10.0.0.{i}", limit=5, window_s=60)
    t[0] += security.RateLimiter._SWEEP_S + 1
    rl.allow("1.1.1.1", limit=5, window_s=60)
    assert set(rl._hits) == {"1.1.1.1"}


def test_metar_rejects_bad_station_codes():
    import asyncio
    from app.services import metar
    assert asyncio.run(metar.get_metar("MM MX&x=1")) == {}
    assert asyncio.run(metar.get_taf("../etc")) == {}


def test_kiosk_local_ignores_impossible_values_and_honours_optional_token(api, monkeypatch):
    from app.routers import kiosk as r_kiosk
    monkeypatch.setattr(r_kiosk, "_kiosk_limiter", m.secsvc.RateLimiter())
    monkeypatch.setattr(r_kiosk, "_KIOSK_LOCAL_FILE", str(__import__("tempfile").mkdtemp()) + "/k.json")
    assert api.post("/api/kiosk/local", json={"temperature": 22.4, "humidity": 999, "pressure": 780.2}).status_code == 200
    latest = api.get("/api/kiosk/local").json()["latest"]
    assert latest["temperature"] == 22.4 and latest["pressure"] == 780.2 and "humidity" not in latest
    monkeypatch.setattr(m.settings, "kiosk_local_token", "abc")
    assert api.post("/api/kiosk/local", json={"temperature": 20}).status_code == 401
    assert api.post("/api/kiosk/local", json={"temperature": 20}, headers={"X-Kiosk-Token": "abc"}).status_code == 200


def test_history_rejects_huge_ranges(api):
    async def fake_query(**kw):
        return []
    api.fake_storage.query = fake_query
    assert api.get("/api/history", params={"start": "-30d"}).status_code == 200
    assert api.get("/api/history", params={"start": "-3650d"}).status_code == 400
    assert api.get("/api/history", params={"start": "2026-01-01T00:00:00Z",
                                           "stop": "2026-06-01T00:00:00Z"}).status_code == 400
    assert api.get("/api/history", params={"start": "2026-09-01T06:00:00Z",
                                           "stop": "2026-09-02T06:00:00Z"}).status_code == 200


def test_current_adds_influx_extras_and_caches_them(api):
    calls = []

    async def rain_hours(hours=2, station=None):
        calls.append(hours)
        return 1.2 if hours == 2 else 4.5

    api.fake_storage.get_rain_hours = rain_hours
    api.post("/data/report/", data=WS2910)
    cur = api.get("/api/current").json()
    assert (cur["rain_2h"], cur["rain_24h"]) == (1.2, 4.5)
    api.get("/api/current")
    assert sorted(calls) == [2, 24]          # la segunda vez sale de la caché de 30 s


def test_history_every_needs_valid_fields(api):
    seen = {}

    async def fake_query(**kw):
        seen.update(kw)
        if kw.get("every") and not kw.get("fields"):
            raise ValueError("every requiere fields")
        return []
    api.fake_storage.query = fake_query
    r = api.get("/api/history", params={"start": "-7d", "every": "10m", "fields": "temperature_outdoor,humidity_outdoor"})
    assert r.status_code == 200 and seen["fields"] == ["temperature_outdoor", "humidity_outdoor"]
    assert api.get("/api/history", params={"start": "-7d", "every": "10m"}).status_code == 400


def test_routers_keep_their_urls(api, monkeypatch, tmp_path):
    """Endpoints movidos a app/routers/: mismas URLs y mismo comportamiento."""
    from app.routers import external
    from app.services import imeca
    monkeypatch.setattr(m.settings, "radar_archive_dir", str(tmp_path / "radar"))
    r = api.get("/api/radar/sacmex/archive").json()
    assert r["frames"] == 0 and "keep_days" in r
    assert api.get("/api/radar/sacmex/no-es-un-cuadro.JPG").status_code == 404
    seen = {}

    async def fake_imeca(lat, lon, pressure_hpa=None):
        seen["p"] = pressure_hpa
        return {"imeca": 40}
    monkeypatch.setattr(imeca, "get_imeca", fake_imeca)
    api.post("/data/report/", data=WS2910)
    assert api.get("/api/airquality/imeca").json() == {"imeca": 40}
    assert seen["p"] == pytest.approx(22.85 * 33.8639, abs=0.5)  # presión de la principal
    assert external.router is not None

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
    monkeypatch.setattr(m, "storage", fake)
    monkeypatch.setattr(m, "latest_by_station", {})
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

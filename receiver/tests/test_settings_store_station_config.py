"""Config por estación: el guardado fusiona y las claves retiradas no reaparecen."""
import json

from app.services import settings_store as ss


def test_retired_keys_are_hidden_on_read_and_dropped_on_save(tmp_path):
    path = str(tmp_path / "settings.json")
    old = {"stations": {"gw1100": {
        "label": "Remota", "altitude_m": 2245, "publish_enabled": False,
        "mqtt_enabled": False, "treat_indoor_as_outdoor": False,
        "calibration": {"cal_enabled": True},
    }}}
    (tmp_path / "settings.json").write_text(json.dumps(old), encoding="utf-8")

    cfg = ss.get_station_config(path, "gw1100")
    assert not set(ss.RETIRED_STATION_KEYS) & set(cfg)
    assert cfg["label"] == "Remota" and cfg["altitude_m"] == 2245

    ss.save_station_config(path, "gw1100", {"label": "Azotea", "treat_indoor_as_outdoor": True})
    saved = json.loads((tmp_path / "settings.json").read_text(encoding="utf-8"))["stations"]["gw1100"]
    assert not set(ss.RETIRED_STATION_KEYS) & set(saved)
    assert saved["label"] == "Azotea"
    assert saved["calibration"] == {"cal_enabled": True}   # lo no enviado se conserva


def test_principal_ignores_keys_that_live_in_global_settings(tmp_path):
    """El "sin datos", las alertas y la altitud de la principal son globales: una
    copia vieja en stations._principal ya no le gana al global."""
    path = str(tmp_path / "settings.json")
    old = {"stations": {"_principal": {"label": "Principal WS2910", "watchdog_minutes": 5,
                                       "watchdog_enabled": True, "alerts_enabled": True, "altitude_m": 0}}}
    (tmp_path / "settings.json").write_text(json.dumps(old), encoding="utf-8")
    cfg = ss.get_station_config(path, "_principal")
    assert cfg["label"] == "Principal WS2910"
    assert not set(ss.RETIRED_PRINCIPAL_KEYS) & set(cfg)
    ss.save_station_config(path, "_principal", {"label": "Casa", "watchdog_minutes": 30})
    saved = json.loads((tmp_path / "settings.json").read_text(encoding="utf-8"))["stations"]["_principal"]
    assert saved == {"label": "Casa"}
    # En una secundaria esas claves siguen siendo suyas
    ss.save_station_config(path, "gw1100", {"watchdog_minutes": 30, "altitude_m": 2245})
    assert ss.get_station_config(path, "gw1100")["watchdog_minutes"] == 30


def test_write_is_atomic_and_keeps_permissions(tmp_path):
    path = str(tmp_path / "settings.json")
    ss.save_overrides(path, {"alert_temp_high": 30})
    ss.save_overrides(path, {"alert_temp_low": 2})
    data = json.loads((tmp_path / "settings.json").read_text(encoding="utf-8"))
    assert data == {"alert_temp_high": 30, "alert_temp_low": 2}
    assert [p.name for p in tmp_path.iterdir()] == ["settings.json"]  # sin temporales


def test_unreadable_file_is_never_overwritten(tmp_path):
    """Un settings.json truncado se lee como vacío (la ingesta sigue), pero guardar
    encima se niega: antes se fusionaba con {} y se perdía todo."""
    f = tmp_path / "settings.json"
    f.write_text('{"stations": {"gw1100": {"label": "Rem', encoding="utf-8")
    path = str(f)
    assert ss.get_station_config(path, "gw1100")["label"] == ""
    import pytest
    with pytest.raises(ss.SettingsUnreadable):
        ss.save_overrides(path, {"alert_temp_high": 30})
    with pytest.raises(ss.SettingsUnreadable):
        ss.save_station_config(path, "gw1100", {"label": "X"})
    assert f.read_text(encoding="utf-8").startswith('{"stations": {"gw1100"')

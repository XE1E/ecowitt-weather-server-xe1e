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

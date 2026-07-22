"""Tests for the weather alerts service."""

import asyncio
from types import SimpleNamespace

from app.services.alerts import AlertService, _category_for


def make_settings(**kw):
    base = dict(
        alerts_enabled=True,
        alert_temp_high=35.0,
        alert_temp_low=0.0,
        alert_wind_high=50.0,
        alert_rain_rate=10.0,
        alert_gust_high=70.0,
        alert_rain_daily=40.0,
        alert_pressure_high=1030.0,
        alert_pressure_low=1000.0,
        alert_battery_enabled=True,
        alert_sensor_lost_enabled=True,
        telegram_enabled=False,
        telegram_bot_token=None,
        telegram_chat_id=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


class Collector:
    """Async notifier that records the messages it receives."""

    def __init__(self):
        self.msgs = []

    async def __call__(self, text):
        self.msgs.append(text)


def test_gust_rain_daily_pressure_alarms():
    svc = AlertService(make_settings(), notifier=Collector())
    r = svc.evaluate({
        "wind_speed": 20, "wind_gust": 85, "rain_daily": 55,
        "pressure_relative": 1032,
    })
    assert r["wind_high"][0] is False       # 20 < 50 sostenido
    assert r["gust_high"][0] is True        # 85 >= 70 ráfaga
    assert r["rain_daily"][0] is True       # 55 >= 40 acumulada
    assert r["pressure_high"][0] is True    # 1032 >= 1030
    assert r["pressure_low"][0] is False
    # Presión baja
    r2 = svc.evaluate({"pressure_relative": 998})
    assert r2["pressure_low"][0] is True
    assert r2["pressure_high"][0] is False


def test_battery_low_alarm():
    svc = AlertService(make_settings(), notifier=Collector())
    # WN31 canal 1 batería baja (False = baja); WS69 OK (True)
    rules = svc.evaluate({"battery_ch1": False, "battery_ws69": True})
    assert rules["battery_ch1"][0] is True
    assert "canal 1" in rules["battery_ch1"][1]
    assert rules["battery_ws69"][0] is False


def test_battery_alarm_toggle_off():
    svc = AlertService(make_settings(alert_battery_enabled=False), notifier=Collector())
    rules = svc.evaluate({"battery_ch1": False})
    assert "battery_ch1" not in rules


def test_sensor_lost_alarm():
    svc = AlertService(make_settings(), notifier=Collector())
    # Primera lectura: el canal 1 está presente -> queda "conocido", sin alarma
    rules = svc.evaluate({"temperature_ch1": 21.0})
    assert rules["sensor_temperature_ch1"][0] is False
    # Segunda lectura: el canal 1 desaparece -> alarma de sensor perdido
    rules = svc.evaluate({"temperature_outdoor": 20.0})
    assert rules["sensor_temperature_ch1"][0] is True
    assert "canal 1" in rules["sensor_temperature_ch1"][1]
    # Vuelve a reportar -> se normaliza
    rules = svc.evaluate({"temperature_ch1": 21.5})
    assert rules["sensor_temperature_ch1"][0] is False


def test_evaluate_temp_thresholds():
    svc = AlertService(make_settings(), notifier=Collector())
    rules = svc.evaluate({"temperature_outdoor": 36})
    assert rules["temp_high"][0] is True
    assert rules["temp_low"][0] is False

    rules = svc.evaluate({"temperature_outdoor": -2})
    assert rules["temp_high"][0] is False
    assert rules["temp_low"][0] is True


def test_wind_sustained_vs_gust():
    # wind_high = viento sostenido; gust_high = ráfaga (reglas separadas)
    svc = AlertService(make_settings(), notifier=Collector())
    rules = svc.evaluate({"wind_gust": 75, "wind_speed": 10})
    assert rules["wind_high"][0] is False   # sostenido 10 < 50
    assert rules["gust_high"][0] is True     # ráfaga 75 >= 70
    # Sin ráfaga, wind_high usa la velocidad sostenida disponible
    rules2 = svc.evaluate({"wind_speed": 55})
    assert rules2["wind_high"][0] is True


def test_rain_rate_threshold():
    svc = AlertService(make_settings(), notifier=Collector())
    assert svc.evaluate({"rain_rate": 12})["rain_rate"][0] is True
    assert svc.evaluate({"rain_rate": 3})["rain_rate"][0] is False


def test_notifies_once_while_active():
    c = Collector()
    svc = AlertService(make_settings(), notifier=c)
    asyncio.run(svc.process({"temperature_outdoor": 40}))
    asyncio.run(svc.process({"temperature_outdoor": 41}))  # still high -> no repeat
    assert len(c.msgs) == 1
    assert "ALERTA" in c.msgs[0]
    assert "alta" in c.msgs[0]


def test_notifies_on_clear():
    c = Collector()
    svc = AlertService(make_settings(), notifier=c)
    asyncio.run(svc.process({"temperature_outdoor": 40}))   # trigger
    asyncio.run(svc.process({"temperature_outdoor": 20}))   # normalize
    assert len(c.msgs) == 2
    assert "Normalizado" in c.msgs[1]
    assert "temp_high" not in svc.active


def test_disabled_does_not_notify():
    c = Collector()
    svc = AlertService(make_settings(alerts_enabled=False), notifier=c)
    asyncio.run(svc.process({"temperature_outdoor": 40}))
    assert c.msgs == []


def test_station_offline_then_recovery():
    from datetime import datetime, timedelta
    c = Collector()
    svc = AlertService(make_settings(), notifier=c)
    now = datetime(2026, 7, 8, 12, 0, 0)
    fresh = (now - timedelta(minutes=2)).isoformat()
    stale = (now - timedelta(minutes=30)).isoformat()

    # Fresco -> nada
    asyncio.run(svc.check_station(fresh, now, 15 * 60))
    assert svc.station_offline is False
    assert c.msgs == []

    # Viejo -> alerta de caída (una vez)
    asyncio.run(svc.check_station(stale, now, 15 * 60))
    asyncio.run(svc.check_station(stale, now, 15 * 60))  # no repite
    assert svc.station_offline is True
    assert len(c.msgs) == 1 and "no envía datos" in c.msgs[0]

    # Fresco de nuevo -> recuperación
    asyncio.run(svc.check_station(fresh, now, 15 * 60))
    assert svc.station_offline is False
    assert len(c.msgs) == 2 and "volvió a enviar" in c.msgs[1]


def test_station_check_ignores_empty():
    from datetime import datetime
    c = Collector()
    svc = AlertService(make_settings(), notifier=c)
    asyncio.run(svc.check_station(None, datetime(2026, 7, 8), 900))
    assert c.msgs == []


def test_category_mapping():
    assert _category_for("temp_high") == "temp"
    assert _category_for("temp_low") == "temp"
    assert _category_for("gust_high") == "wind"
    assert _category_for("wind_high") == "wind"
    assert _category_for("rain_daily") == "rain"
    assert _category_for("pressure_low") == "pressure"
    assert _category_for("station_offline_principal") == "station"
    assert _category_for("battery_ch1") == "battery"
    assert _category_for("sensor_temperature_ch1") == "sensor"
    assert _category_for("aqi_high") == "air"


def test_channel_allows_by_category():
    # None = todas las categorías; lista = solo esas; [] = ninguna.
    svc = AlertService(make_settings(
        telegram_categories=None,
        email_categories=["rain", "station"],
    ))
    assert svc._channel_allows("telegram", "battery") is True   # None -> todas
    assert svc._channel_allows("email", "rain") is True
    assert svc._channel_allows("email", "battery") is False     # no está en la lista
    assert svc._channel_allows("email", None) is True           # mensaje suelto -> siempre

    svc_none = AlertService(make_settings(email_categories=[]))
    assert svc_none._channel_allows("email", "rain") is False   # [] -> ninguna


def test_alerts_isolated_per_station():
    # La principal y una secundaria evalúan la misma regla de forma INDEPENDIENTE:
    # estado namespaced por estación y mensaje etiquetado para la secundaria.
    c = Collector()
    svc = AlertService(make_settings(), notifier=c)
    asyncio.run(svc.process({"temperature_outdoor": 40}))                                  # principal
    asyncio.run(svc.process({"temperature_outdoor": 41}, station="gw1100", label="Remota"))  # secundaria
    assert "temp_high" in svc.active            # principal (sin prefijo)
    assert "gw1100:temp_high" in svc.active     # secundaria (namespaced)
    assert len(c.msgs) == 2
    assert any("[Remota]" in m for m in c.msgs)
    # Normalizar la secundaria no afecta a la principal
    asyncio.run(svc.process({"temperature_outdoor": 20}, station="gw1100", label="Remota"))
    assert "gw1100:temp_high" not in svc.active
    assert "temp_high" in svc.active


def test_notification_failure_does_not_raise():
    async def boom(_text):
        raise RuntimeError("network down")

    svc = AlertService(make_settings(), notifier=boom)
    # Should swallow the error, not propagate
    asyncio.run(svc.process({"temperature_outdoor": 40}))
    assert "temp_high" in svc.active

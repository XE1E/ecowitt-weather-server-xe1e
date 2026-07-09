"""Tests for the weather alerts service."""

import asyncio
from types import SimpleNamespace

from app.services.alerts import AlertService


def make_settings(**kw):
    base = dict(
        alerts_enabled=True,
        alert_temp_high=35.0,
        alert_temp_low=0.0,
        alert_wind_high=50.0,
        alert_rain_rate=10.0,
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


def test_wind_gust_preferred_over_speed():
    svc = AlertService(make_settings(), notifier=Collector())
    rules = svc.evaluate({"wind_gust": 60, "wind_speed": 10})
    assert rules["wind_high"][0] is True


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


def test_notification_failure_does_not_raise():
    async def boom(_text):
        raise RuntimeError("network down")

    svc = AlertService(make_settings(), notifier=boom)
    # Should swallow the error, not propagate
    asyncio.run(svc.process({"temperature_outdoor": 40}))
    assert "temp_high" in svc.active

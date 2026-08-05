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
        alert_humidity_low=25.0,
        alert_humidity_high=85.0,
        alert_pressure_drop_warn=1.5,
        alert_pressure_drop_strong=3.0,
        alert_pressure_rise_warn=1.5,
        alert_pressure_rise_strong=3.0,
        alert_pressure_trend_window_min=60,
        alert_uv_high=8.0,
        alert_solar_high=1000.0,
        alert_dew_high=20.0,
        alert_dew_low=-5.0,
        alert_feels_high=38.0,
        alert_feels_low=-2.0,
        alert_temp_drop_warn=3.0,
        alert_temp_drop_strong=5.0,
        alert_temp_rise_warn=3.0,
        alert_temp_rise_strong=5.0,
        alert_temp_trend_window_min=60,
        # 0 = inmediato: mantiene el comportamiento clásico salvo donde se prueba
        # la persistencia explícitamente.
        alert_persist_minutes=0.0,
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
    assert _category_for("pressure_drop") == "pressure"
    assert _category_for("humidity_high") == "humidity"
    assert _category_for("station_offline_principal") == "station"
    assert _category_for("battery_ch1") == "battery"
    assert _category_for("sensor_temperature_ch1") == "sensor"
    assert _category_for("aqi_high") == "air"
    # Rocío y sensación viajan con temperatura; UV y solar tienen su propia categoría
    assert _category_for("dew_high") == "temp"
    assert _category_for("feels_low") == "temp"
    assert _category_for("temp_drop") == "temp"
    assert _category_for("uv_high") == "sun"
    assert _category_for("solar_high") == "sun"


def test_all_categories_are_declared():
    """Ninguna regla debe caer en 'other': eso la volvería inseleccionable en el
    panel y, si el canal tiene lista explícita, se descartaría en silencio."""
    from app.services.alerts import ALERT_CATEGORIES
    svc = AlertService(make_settings(), notifier=Collector())
    r = svc.evaluate({
        "temperature_outdoor": 20, "humidity_outdoor": 50, "wind_speed": 10,
        "wind_gust": 20, "rain_rate": 0, "rain_daily": 0, "pressure_relative": 1015,
        "dew_point": 9, "feels_like": 20, "uv_index": 3, "solar_radiation": 400,
        "battery_ch1": True,
    })
    for key in r:
        cat = _category_for(key)
        assert cat != "other", f"la regla {key} no tiene categoría"
        assert cat in ALERT_CATEGORIES, f"{cat} no está en ALERT_CATEGORIES"


# ── Humedad exterior ──
def test_humidity_thresholds():
    svc = AlertService(make_settings(), notifier=Collector())
    r = svc.evaluate({"humidity_outdoor": 20})
    assert r["humidity_low"][0] is True     # 20 <= 25
    assert r["humidity_high"][0] is False
    r = svc.evaluate({"humidity_outdoor": 90})
    assert r["humidity_high"][0] is True     # 90 >= 85
    assert r["humidity_low"][0] is False


def test_humidity_per_station_override_for_mold():
    # El GW1100 (trampa=exterior) usa umbral propio: alto=65 (moho), bajo=0 (off).
    svc = AlertService(make_settings(), notifier=Collector())
    th = {"alert_humidity_high": 65.0, "alert_humidity_low": 0.0}
    r = svc.evaluate({"humidity_outdoor": 70}, station="gw1100", thresholds=th)
    assert r["humidity_high"][0] is True     # 70 >= 65 (moho)
    assert r["humidity_low"][0] is False     # 70 <= 0 -> nunca (desactivada)


# ── Tendencia de presión (2 niveles) ──
def test_pressure_trend_needs_history():
    from datetime import datetime
    svc = AlertService(make_settings(), notifier=Collector())
    t0 = datetime(2026, 7, 25, 12, 0, 0)
    # Una sola lectura -> aún no hay tendencia
    r = svc.evaluate({"pressure_relative": 1020}, now=t0)
    assert "pressure_drop" not in r and "pressure_rise" not in r


def test_pressure_drop_levels():
    from datetime import datetime, timedelta
    svc = AlertService(make_settings(), notifier=Collector())
    t0 = datetime(2026, 7, 25, 12, 0, 0)
    svc.evaluate({"pressure_relative": 1020}, now=t0)
    # 1 h después: cae 2.5 hPa -> aviso (>=1.5, <3)
    r = svc.evaluate({"pressure_relative": 1017.5}, now=t0 + timedelta(minutes=60))
    assert r["pressure_drop"][0] is True and "aviso" in r["pressure_drop"][1]
    # Otra estación/servicio: caída fuerte
    svc2 = AlertService(make_settings(), notifier=Collector())
    svc2.evaluate({"pressure_relative": 1020}, now=t0)
    r2 = svc2.evaluate({"pressure_relative": 1016}, now=t0 + timedelta(minutes=60))
    assert r2["pressure_drop"][0] is True and "fuerte" in r2["pressure_drop"][1]


def test_pressure_rise_level():
    from datetime import datetime, timedelta
    svc = AlertService(make_settings(), notifier=Collector())
    t0 = datetime(2026, 7, 25, 12, 0, 0)
    svc.evaluate({"pressure_relative": 1018}, now=t0)
    r = svc.evaluate({"pressure_relative": 1022}, now=t0 + timedelta(minutes=60))
    assert r["pressure_rise"][0] is True and "fuerte" in r["pressure_rise"][1]  # +4 >= 3
    assert r["pressure_drop"][0] is False


def test_pressure_trend_isolated_per_station():
    from datetime import datetime, timedelta
    svc = AlertService(make_settings(), notifier=Collector())
    t0 = datetime(2026, 7, 25, 12, 0, 0)
    # La principal cae; la secundaria no debe verse afectada por ese historial
    svc.evaluate({"pressure_relative": 1020}, now=t0)
    svc.evaluate({"pressure_relative": 1030}, now=t0, station="gw1100")
    r = svc.evaluate({"pressure_relative": 1030}, now=t0 + timedelta(minutes=60), station="gw1100")
    assert r["pressure_drop"][0] is False and r["pressure_rise"][0] is False  # estable


# ── Rocío, sensación térmica, UV y radiación solar ──
def test_dew_point_thresholds():
    svc = AlertService(make_settings(), notifier=Collector())
    r = svc.evaluate({"dew_point": 22})
    assert r["dew_high"][0] is True      # 22 >= 20 (bochorno)
    assert r["dew_low"][0] is False
    r = svc.evaluate({"dew_point": -8})
    assert r["dew_low"][0] is True       # -8 <= -5 (aire seco)
    assert r["dew_high"][0] is False


def test_feels_like_thresholds():
    svc = AlertService(make_settings(), notifier=Collector())
    r = svc.evaluate({"feels_like": 40})
    assert r["feels_high"][0] is True    # 40 >= 38
    assert r["feels_low"][0] is False
    r = svc.evaluate({"feels_like": -5})
    assert r["feels_low"][0] is True     # -5 <= -2


def test_uv_and_solar_thresholds():
    svc = AlertService(make_settings(), notifier=Collector())
    r = svc.evaluate({"uv_index": 9, "solar_radiation": 1050})
    assert r["uv_high"][0] is True       # 9 >= 8
    assert r["solar_high"][0] is True    # 1050 >= 1000
    r = svc.evaluate({"uv_index": 4, "solar_radiation": 500})
    assert r["uv_high"][0] is False
    assert r["solar_high"][0] is False


def test_sun_rules_absent_without_sensors():
    """La remota no trae UV ni radiación: esas reglas no deben ni registrarse,
    para que no aparezcan como 'normalizadas' en /api/alerts."""
    svc = AlertService(make_settings(), notifier=Collector())
    r = svc.evaluate({"temperature_outdoor": 20, "humidity_outdoor": 50})
    assert "uv_high" not in r
    assert "solar_high" not in r


def test_dew_uses_per_station_override():
    svc = AlertService(make_settings(), notifier=Collector())
    r = svc.evaluate({"dew_point": 16}, station="gw1100",
                     thresholds={"alert_dew_high": 15.0})
    assert r["dew_high"][0] is True      # 16 >= 15 (umbral propio de la remota)


# ── Tendencia de temperatura (2 niveles) ──
def test_temp_trend_needs_history():
    from datetime import datetime
    svc = AlertService(make_settings(), notifier=Collector())
    r = svc.evaluate({"temperature_outdoor": 22}, now=datetime(2026, 8, 3, 12, 0, 0))
    assert "temp_drop" not in r and "temp_rise" not in r


def test_temp_drop_levels():
    from datetime import datetime, timedelta
    t0 = datetime(2026, 8, 3, 12, 0, 0)
    # Cae 4 °C en 1 h -> aviso (>=3, <5)
    svc = AlertService(make_settings(), notifier=Collector())
    svc.evaluate({"temperature_outdoor": 26}, now=t0)
    r = svc.evaluate({"temperature_outdoor": 22}, now=t0 + timedelta(minutes=60))
    assert r["temp_drop"][0] is True and "aviso" in r["temp_drop"][1]
    assert r["temp_rise"][0] is False
    # Cae 6 °C -> fuerte
    svc2 = AlertService(make_settings(), notifier=Collector())
    svc2.evaluate({"temperature_outdoor": 26}, now=t0)
    r2 = svc2.evaluate({"temperature_outdoor": 20}, now=t0 + timedelta(minutes=60))
    assert r2["temp_drop"][0] is True and "fuerte" in r2["temp_drop"][1]


def test_temp_rise_level():
    from datetime import datetime, timedelta
    t0 = datetime(2026, 8, 3, 8, 0, 0)
    svc = AlertService(make_settings(), notifier=Collector())
    svc.evaluate({"temperature_outdoor": 14}, now=t0)
    r = svc.evaluate({"temperature_outdoor": 20}, now=t0 + timedelta(minutes=60))
    assert r["temp_rise"][0] is True and "fuerte" in r["temp_rise"][1]  # +6 >= 5
    assert r["temp_drop"][0] is False


def test_temp_trend_isolated_per_station():
    from datetime import datetime, timedelta
    t0 = datetime(2026, 8, 3, 12, 0, 0)
    svc = AlertService(make_settings(), notifier=Collector())
    # La principal se desploma; la remota se mantiene estable
    svc.evaluate({"temperature_outdoor": 30}, now=t0)
    svc.evaluate({"temperature_outdoor": 20}, now=t0, station="gw1100")
    r = svc.evaluate({"temperature_outdoor": 20}, now=t0 + timedelta(minutes=60), station="gw1100")
    assert r["temp_drop"][0] is False and r["temp_rise"][0] is False


def test_temp_trend_does_not_share_buffer_with_pressure():
    """Regresión: los dos buffers usan el mismo helper, no deben mezclarse."""
    from datetime import datetime, timedelta
    t0 = datetime(2026, 8, 3, 12, 0, 0)
    svc = AlertService(make_settings(), notifier=Collector())
    svc.evaluate({"temperature_outdoor": 26, "pressure_relative": 1020}, now=t0)
    r = svc.evaluate({"temperature_outdoor": 20, "pressure_relative": 1020},
                     now=t0 + timedelta(minutes=60))
    assert r["temp_drop"][0] is True         # -6 °C
    assert r["pressure_drop"][0] is False    # la presión no se movió


# ── Histéresis / persistencia ──
def test_persistence_delays_trigger():
    from datetime import datetime, timedelta
    c = Collector()
    svc = AlertService(make_settings(alert_persist_minutes=3.0), notifier=c)
    t = datetime(2026, 7, 25, 12, 0, 0)
    asyncio.run(svc.process({"temperature_outdoor": 40}, now=t))                      # inicia cuenta
    assert c.msgs == [] and "temp_high" not in svc.active
    asyncio.run(svc.process({"temperature_outdoor": 41}, now=t + timedelta(minutes=1)))
    assert c.msgs == []                                                              # aún <3 min
    asyncio.run(svc.process({"temperature_outdoor": 41}, now=t + timedelta(minutes=3)))
    assert len(c.msgs) == 1 and "temp_high" in svc.active                            # sostenido 3 min


def test_persistence_resets_on_flicker():
    from datetime import datetime, timedelta
    c = Collector()
    svc = AlertService(make_settings(alert_persist_minutes=3.0), notifier=c)
    t = datetime(2026, 7, 25, 12, 0, 0)
    asyncio.run(svc.process({"temperature_outdoor": 40}, now=t))                      # cuenta
    asyncio.run(svc.process({"temperature_outdoor": 20}, now=t + timedelta(minutes=1)))  # cae -> reset
    asyncio.run(svc.process({"temperature_outdoor": 40}, now=t + timedelta(minutes=2)))  # recomienza
    asyncio.run(svc.process({"temperature_outdoor": 40}, now=t + timedelta(minutes=4)))  # solo 2 min
    assert c.msgs == []                                                              # nunca sostenido 3 min


def test_gust_fires_immediately_despite_persistence():
    c = Collector()
    svc = AlertService(make_settings(alert_persist_minutes=5.0), notifier=c)
    asyncio.run(svc.process({"wind_gust": 85}))   # ráfaga: exenta -> avisa al instante
    assert len(c.msgs) == 1 and "gust_high" in svc.active


# ── Habilitar/deshabilitar por alarma ──
def test_disabled_rule_does_not_fire_and_clears_silently():
    c = Collector()
    svc = AlertService(make_settings(), notifier=c)
    asyncio.run(svc.process({"temperature_outdoor": 40}))          # dispara temp_high
    assert "temp_high" in svc.active and len(c.msgs) == 1
    # Apagar temp_high mientras está activa -> se limpia SIN "Normalizado"
    asyncio.run(svc.process({"temperature_outdoor": 41}, disabled=["temp_high"]))
    assert "temp_high" not in svc.active
    assert not any("Normalizado" in m for m in c.msgs)
    # Ya apagada: no vuelve a disparar aunque siga alta
    c.msgs.clear()
    asyncio.run(svc.process({"temperature_outdoor": 42}, disabled=["temp_high"]))
    assert c.msgs == [] and "temp_high" not in svc.active


def test_disable_one_does_not_affect_others():
    c = Collector()
    svc = AlertService(make_settings(), notifier=c)
    # Apagar temp_low no afecta a temp_high (que sí debe disparar)
    asyncio.run(svc.process({"temperature_outdoor": 40}, disabled=["temp_low"]))
    assert "temp_high" in svc.active


def test_principal_uses_global_disabled_list():
    c = Collector()
    svc = AlertService(make_settings(alert_rules_disabled=["temp_high"]), notifier=c)
    asyncio.run(svc.process({"temperature_outdoor": 40}))   # disabled=None -> usa la global
    assert "temp_high" not in svc.active and c.msgs == []


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


def test_qc_rejected_value_is_not_a_lost_sensor():
    """Un pico que el QC anula NO debe disparar 'sensor sin contacto'.

    El filtro de picos pone el campo a None, y la regla de presencia leía ese None
    como sensor ausente. Como las reglas sensor_* están exentas de histéresis,
    avisaban de inmediato: cuanto mejor filtraba el QC, más falsos avisos.
    """
    svc = AlertService(make_settings(), notifier=None)
    # Primero se ve el sensor, para que quede registrado como conocido.
    svc.evaluate({"temperature_outdoor": 25.0})

    # Ahora llega sin valor PORQUE el QC lo anuló.
    rules = svc.evaluate({"temperature_outdoor": None},
                         qc_rejected={"temperature_outdoor"})
    assert rules.get("sensor_temperature_outdoor") is None

    # Sin esa señal, el mismo dato sí se interpreta como sensor perdido...
    rules = svc.evaluate({"temperature_outdoor": None})
    assert rules["sensor_temperature_outdoor"][0] is True

    # ...igual que cuando el campo sencillamente no llega, que es lo correcto.
    rules = svc.evaluate({"humidity_outdoor": 40.0}, qc_rejected=set())
    assert rules["sensor_temperature_outdoor"][0] is True


def test_indoor_humidity_rules():
    """La vigilancia de moho va sobre humidity_indoor.

    Mientras el GW1100 usó la trampa `treat_indoor_as_outdoor` su lectura entraba
    por la regla exterior; al retirarla, sin esta regla el umbral de moho se quedó
    sin nadie que lo evaluara.
    """
    s = make_settings(alert_humidity_indoor_low=20.0, alert_humidity_indoor_high=65.0)
    svc = AlertService(s, notifier=None)

    assert svc.evaluate({"humidity_indoor": 45.0})["humidity_indoor_high"][0] is False
    assert svc.evaluate({"humidity_indoor": 70.0})["humidity_indoor_high"][0] is True
    assert svc.evaluate({"humidity_indoor": 15.0})["humidity_indoor_low"][0] is True

    # Es independiente de la exterior: una no debe disparar la otra.
    rules = svc.evaluate({"humidity_indoor": 70.0, "humidity_outdoor": 40.0})
    assert rules["humidity_indoor_high"][0] is True
    assert rules["humidity_high"][0] is False

    # Y admite umbral propio por estación (el GW1100 puede ser más estricto).
    rules = svc.evaluate({"humidity_indoor": 62.0}, station="gw1100",
                         thresholds={"alert_humidity_indoor_high": 60.0})
    assert rules["humidity_indoor_high"][0] is True


def test_indoor_sensor_loss_is_watched():
    """El sensor interior también se vigila: era el único que no avisaba al caer."""
    svc = AlertService(make_settings(), notifier=None)
    svc.evaluate({"temperature_indoor": 22.0})
    rules = svc.evaluate({"temperature_outdoor": 25.0})
    assert rules["sensor_temperature_indoor"][0] is True

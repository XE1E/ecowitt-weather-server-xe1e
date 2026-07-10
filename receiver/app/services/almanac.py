"""
Almanaque astronómico ampliado (idea del almanac de WeeWX).

Calcula, para la ubicación de la estación y el día local en curso:
  - Sol: orto, ocaso, mediodía solar, duración del día.
  - Crepúsculos: civil (-6°), náutico (-12°) y astronómico (-18°), amanecer y anochecer.
  - Luna: orto, ocaso, fase, % de iluminación, próxima luna nueva y llena.
  - Planetas: Mercurio, Venus, Marte, Júpiter y Saturno — orto/ocaso, altitud
    actual, magnitud y si están sobre el horizonte.

Usa pyephem (cálculo local, sin depender de servicios externos). Los horarios se
devuelven en hora local de la estación (America/Mexico_City).
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import logging
import math

import ephem

try:
    from zoneinfo import ZoneInfo
    _TZ = ZoneInfo("America/Mexico_City")
except Exception:  # pragma: no cover
    _TZ = timezone(timedelta(hours=-6))

logger = logging.getLogger(__name__)

_CACHE: Dict[str, Any] = {"ts": 0.0, "key": None, "data": None}
_TTL = 600  # 10 min

_MESES = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def _hhmm_local(edate, local_day) -> Optional[str]:
    """ephem.Date (UTC) -> 'HH:MM' local, solo si cae en el día local dado."""
    if edate is None:
        return None
    dt = edate.datetime().replace(tzinfo=timezone.utc).astimezone(_TZ)
    if dt.date() != local_day:
        return None
    return dt.strftime("%H:%M")


def _fecha_local(edate) -> Optional[str]:
    if edate is None:
        return None
    dt = edate.datetime().replace(tzinfo=timezone.utc).astimezone(_TZ)
    return f"{dt.day} {_MESES[dt.month]}"


def _rise_set(obs, body, horizon: str, center: bool, local_day):
    obs.horizon = horizon
    rise = sett = None
    try:
        rise = obs.next_rising(body, use_center=center)
    except (ephem.AlwaysUpError, ephem.NeverUpError):
        rise = None
    try:
        sett = obs.next_setting(body, use_center=center)
    except (ephem.AlwaysUpError, ephem.NeverUpError):
        sett = None
    return _hhmm_local(rise, local_day), _hhmm_local(sett, local_day), rise, sett


def _moon_phase_name(illum: float, waxing: bool) -> str:
    if illum < 1:
        return "Luna nueva"
    if illum > 99:
        return "Luna llena"
    if 45 <= illum <= 55:
        return "Cuarto creciente" if waxing else "Cuarto menguante"
    if illum < 45:
        return "Luna creciente" if waxing else "Luna menguante"
    return "Gibosa creciente" if waxing else "Gibosa menguante"


def compute_almanac(lat: float, lon: float, elevation: float = 2240.0,
                    now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    local_now = now.astimezone(_TZ)
    local_day = local_now.date()
    local_midnight_utc = local_now.replace(hour=0, minute=0, second=0, microsecond=0)\
        .astimezone(timezone.utc).replace(tzinfo=None)

    obs = ephem.Observer()
    obs.lat = str(lat)
    obs.lon = str(lon)
    obs.elevation = elevation
    obs.date = local_midnight_utc

    sun = ephem.Sun()

    # Sol (orto/ocaso con limbo superior + refracción estándar)
    sr, ss, sr_e, ss_e = _rise_set(obs, sun, "0", False, local_day)
    # Mediodía solar
    noon = None
    try:
        noon = _hhmm_local(obs.next_transit(sun), local_day)
    except Exception:
        noon = None
    def _daylen_secs(midnight_naive_utc):
        o = ephem.Observer()
        o.lat, o.lon, o.elevation = str(lat), str(lon), elevation
        o.horizon = "0"
        o.date = midnight_naive_utc
        try:
            r = o.next_rising(sun, use_center=False)
            s = o.next_setting(sun, use_center=False)
            return (s.datetime() - r.datetime()).total_seconds()
        except (ephem.AlwaysUpError, ephem.NeverUpError):
            return None

    today_secs = _daylen_secs(local_midnight_utc)
    day_length = None
    if today_secs and today_secs > 0:
        day_length = f"{int(today_secs // 3600)} h {int((today_secs % 3600) // 60)} min"
    # Cambio de duración del día respecto a ayer
    daylen_change = None
    yest_secs = _daylen_secs(local_midnight_utc - timedelta(days=1))
    if today_secs is not None and yest_secs is not None:
        d = today_secs - yest_secs
        sign = "+" if d >= 0 else "-"
        d = abs(d)
        daylen_change = f"{sign}{int(d // 60)}m {int(d % 60)}s"

    # Crepúsculos (centro del sol)
    civ_dawn, civ_dusk, *_ = _rise_set(obs, sun, "-6", True, local_day)
    nau_dawn, nau_dusk, *_ = _rise_set(obs, sun, "-12", True, local_day)
    ast_dawn, ast_dusk, *_ = _rise_set(obs, sun, "-18", True, local_day)

    # Luna
    moon = ephem.Moon()
    mr, ms, *_ = _rise_set(obs, moon, "0", False, local_day)
    obs_now = ephem.Observer()
    obs_now.lat, obs_now.lon, obs_now.elevation = str(lat), str(lon), elevation
    obs_now.date = now.astimezone(timezone.utc).replace(tzinfo=None)
    sun.compute(obs_now)
    sun_alt = round(math.degrees(float(sun.alt)), 1)
    sun_az = round(math.degrees(float(sun.az)), 1)
    moon.compute(obs_now)
    moon_alt = round(math.degrees(float(moon.alt)), 1)
    moon_dist_km = round(moon.earth_distance * 149597870.7)
    try:
        moon_age = round(obs_now.date - ephem.previous_new_moon(obs_now.date), 1)
    except Exception:
        moon_age = None
    illum = round(moon.phase, 0)
    moon_tomorrow = ephem.Moon()
    obs_next = ephem.Observer()
    obs_next.lat, obs_next.lon = str(lat), str(lon)
    obs_next.date = obs_now.date + 1  # +1 día
    moon_tomorrow.compute(obs_next)
    waxing = moon_tomorrow.phase >= moon.phase

    # Planetas visibles
    planets = []
    for name, body in [("Mercurio", ephem.Mercury()), ("Venus", ephem.Venus()),
                       ("Marte", ephem.Mars()), ("Júpiter", ephem.Jupiter()),
                       ("Saturno", ephem.Saturn())]:
        pr, ps, *_ = _rise_set(obs, body, "0", False, local_day)
        body.compute(obs_now)
        alt_deg = round(float(body.alt) * 180.0 / 3.141592653589793, 1)
        planets.append({
            "name": name,
            "rise": pr, "set": ps,
            "altitude": alt_deg,
            "up": alt_deg > 0,
            "magnitude": round(body.mag, 1),
        })

    return {
        "available": True,
        "sun": {
            "rise": sr, "set": ss, "noon": noon, "day_length": day_length,
            "day_length_change": daylen_change,
            "altitude": sun_alt, "azimuth": sun_az,
        },
        "twilight": {
            "astronomical_dawn": ast_dawn, "nautical_dawn": nau_dawn, "civil_dawn": civ_dawn,
            "civil_dusk": civ_dusk, "nautical_dusk": nau_dusk, "astronomical_dusk": ast_dusk,
        },
        "moon": {
            "rise": mr, "set": ms,
            "illumination": illum,
            "phase": _moon_phase_name(illum, waxing),
            "waxing": waxing,
            "altitude": moon_alt, "age_days": moon_age, "distance_km": moon_dist_km,
            "next_new": _fecha_local(ephem.next_new_moon(obs.date)),
            "next_first_quarter": _fecha_local(ephem.next_first_quarter_moon(obs.date)),
            "next_full": _fecha_local(ephem.next_full_moon(obs.date)),
            "next_last_quarter": _fecha_local(ephem.next_last_quarter_moon(obs.date)),
        },
        "planets": planets,
    }


def get_almanac(lat: float, lon: float, elevation: float = 2240.0) -> Dict[str, Any]:
    """Versión con caché (10 min)."""
    import time
    key = f"{lat:.4f},{lon:.4f}"
    nowt = time.time()
    if _CACHE["data"] and _CACHE["key"] == key and nowt - _CACHE["ts"] < _TTL:
        return _CACHE["data"]
    try:
        data = compute_almanac(lat, lon, elevation)
    except Exception as e:
        logger.error(f"Error computing almanac: {e}")
        return {"available": False, "reason": "error"}
    _CACHE.update(ts=nowt, key=key, data=data)
    return data

"""Tests for the Ecowitt protocol parser, focused on WS2910 payloads."""

from app.services.parser import (
    parse_ecowitt_data,
    describe_device,
    get_tags,
    get_fields,
    resolve_station,
)
from app.services.converter import convert_to_metric


# Realistic form-encoded payload sent by a WS2910 console (WS69 outdoor
# 7-in-1 array + one WN31 channel), Ecowitt protocol, imperial units.
WS2910_PAYLOAD = {
    "PASSKEY": "A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6",
    "stationtype": "EasyWeatherPro_V5.1.1",
    "dateutc": "2026-07-05+14:30:00",
    "tempinf": "75.2",
    "humidityin": "50",
    "baromrelin": "29.92",
    "baromabsin": "29.85",
    "tempf": "68.9",
    "humidity": "62",
    "winddir": "180",
    "windspeedmph": "5.6",
    "windgustmph": "8.2",
    "maxdailygust": "12.1",
    "solarradiation": "245.6",
    "uv": "3",
    "rainratein": "0.00",
    "dailyrainin": "0.12",
    "wh65batt": "0",          # WS69 outdoor array: 0 = OK (binary)
    "temp1f": "70.2",         # WN31 channel 1
    "humidity1": "48",
    "batt1": "1",             # WN31 CH1 battery: 1 = Low (binary)
    "freq": "915M",
    "model": "WS2910_Pro",
}


def test_parses_outdoor_sensors():
    parsed = parse_ecowitt_data(WS2910_PAYLOAD)
    assert parsed["temperature_outdoor_f"] == 68.9
    assert parsed["humidity_outdoor"] == 62.0
    assert parsed["wind_direction"] == 180
    assert parsed["uv_index"] == 3


def test_parses_wn31_channel():
    parsed = parse_ecowitt_data(WS2910_PAYLOAD)
    assert parsed["temperature_ch1_f"] == 70.2
    assert parsed["humidity_ch1"] == 48.0


def test_binary_battery_flags():
    """WS69 array and WN31 report binary batteries: 0 = OK, 1 = Low."""
    parsed = parse_ecowitt_data(WS2910_PAYLOAD)
    assert parsed["battery_wh65"] is True   # 0 -> OK
    assert parsed["battery_ch1"] is False   # 1 -> Low


def test_voltage_battery_kept_numeric():
    """Voltage/level batteries (e.g. WH57 lightning) must stay numeric."""
    parsed = parse_ecowitt_data({"wh57batt": "3", "wh40batt": "1.3"})
    assert parsed["battery_wh57"] == 3.0
    assert parsed["battery_wh40"] == 1.3


def test_timestamp_parsed():
    parsed = parse_ecowitt_data(WS2910_PAYLOAD)
    assert "timestamp" in parsed
    assert parsed["timestamp"].year == 2026
    assert parsed["timestamp"].month == 7


def test_describe_device_identifies_ws2910():
    parsed = parse_ecowitt_data(WS2910_PAYLOAD)
    desc = describe_device(parsed)
    assert "WS2910_Pro" in desc
    assert "915M" in desc


def test_tags_and_fields_separation():
    parsed = parse_ecowitt_data(WS2910_PAYLOAD)
    tags = get_tags(parsed)
    fields = get_fields(parsed)

    # Metadata is tagged, not stored as a field
    assert tags["model"] == "WS2910_Pro"
    assert "passkey" not in fields
    assert "station_type" not in fields
    # Measurements are fields
    assert "temperature_outdoor_f" in fields


# Payload típico de un GW1100: solo sensor interconstruido (interior) +
# presión barométrica. Sin sensores exteriores, viento, lluvia ni UV.
GW1100_PAYLOAD = {
    "PASSKEY": "F00DCAFEF00DCAFEF00DCAFEF00DCAFE",
    "stationtype": "GW1100A_V2.3.4",
    "dateutc": "2026-07-05+14:30:00",
    "tempinf": "73.4",
    "humidityin": "55",
    "baromrelin": "29.90",
    "baromabsin": "29.80",
    "freq": "915M",
    "model": "GW1100A",
}

STATION_MAP = {"F00DCAFEF00DCAFEF00DCAFEF00DCAFE": "gw1100"}


def test_resolve_station_secondary():
    """Un passkey en el mapa se resuelve a su nombre de estación secundaria."""
    parsed = parse_ecowitt_data(GW1100_PAYLOAD)
    assert resolve_station(parsed, STATION_MAP) == "gw1100"


def test_resolve_station_primary_when_unknown():
    """Un passkey desconocido (o el de la principal) resuelve a None."""
    parsed = parse_ecowitt_data(WS2910_PAYLOAD)
    assert resolve_station(parsed, STATION_MAP) is None


def test_resolve_station_no_passkey():
    """Sin passkey no hay estación secundaria (None = principal)."""
    assert resolve_station({}, STATION_MAP) is None


def test_station_tag_only_when_set():
    """El tag 'station' se escribe solo si se marca (secundaria); nunca en fields."""
    parsed = parse_ecowitt_data(GW1100_PAYLOAD)
    # Sin marcar: la principal NO lleva tag 'station'
    assert "station" not in get_tags(parsed)

    # Marcada como secundaria (lo que hace main.py antes de escribir)
    parsed["station"] = "gw1100"
    tags = get_tags(parsed)
    fields = get_fields(parsed)
    assert tags["station"] == "gw1100"
    assert "station" not in fields  # es tag, no measurement


def test_full_pipeline_to_metric():
    """End-to-end: WS2910 payload -> parse -> metric conversion."""
    parsed = parse_ecowitt_data(WS2910_PAYLOAD)
    result = convert_to_metric(parsed)

    # 68.9 F -> ~20.5 C
    assert abs(result["temperature_outdoor"] - 20.5) < 0.1
    # 70.2 F -> ~21.2 C (WN31 CH1)
    assert abs(result["temperature_ch1"] - 21.2) < 0.1
    # 5.6 mph -> ~9.0 km/h
    assert abs(result["wind_speed"] - 9.0) < 0.1
    # Battery flags survive conversion untouched
    assert result["battery_wh65"] is True
    assert result["battery_ch1"] is False
    # Derived values are computed
    assert "dew_point" in result
    assert "feels_like" in result

"""
Ecowitt Protocol Parser

Parses the form-encoded data sent by Ecowitt gateways.
"""

from typing import Dict, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# Mapping of Ecowitt field names to standardized names
FIELD_MAPPING = {
    # Metadata
    "PASSKEY": "passkey",
    "stationtype": "station_type",
    "dateutc": "timestamp_utc",
    "model": "model",
    "freq": "frequency",

    # Indoor sensors
    "tempinf": "temperature_indoor_f",
    "humidityin": "humidity_indoor",

    # Outdoor sensors
    "tempf": "temperature_outdoor_f",
    "humidity": "humidity_outdoor",

    # Pressure
    "baromrelin": "pressure_relative_inhg",
    "baromabsin": "pressure_absolute_inhg",

    # Wind
    "winddir": "wind_direction",
    "windspeedmph": "wind_speed_mph",
    "windgustmph": "wind_gust_mph",
    "maxdailygust": "wind_gust_max_daily_mph",

    # Rain
    "rainratein": "rain_rate_in",
    "eventrainin": "rain_event_in",
    "hourlyrainin": "rain_hourly_in",
    "dailyrainin": "rain_daily_in",
    "weeklyrainin": "rain_weekly_in",
    "monthlyrainin": "rain_monthly_in",
    "yearlyrainin": "rain_yearly_in",
    "totalrainin": "rain_total_in",

    # Solar / UV
    "solarradiation": "solar_radiation",
    "uv": "uv_index",

    # Battery status
    "wh65batt": "battery_wh65",
    "wh26batt": "battery_wh26",
    "wh25batt": "battery_wh25",
    "wh40batt": "battery_wh40",
    "wh57batt": "battery_wh57",
    "wh68batt": "battery_wh68",
    "wh80batt": "battery_wh80",
    "wh90batt": "battery_wh90",
    "ws69batt": "battery_ws69",

    # Soil sensors (up to 8)
    "soilmoisture1": "soil_moisture_1",
    "soilmoisture2": "soil_moisture_2",
    "soilmoisture3": "soil_moisture_3",
    "soilmoisture4": "soil_moisture_4",

    # Extra temperature/humidity sensors WN31 (up to 8 channels)
    "temp1f": "temperature_ch1_f",
    "temp2f": "temperature_ch2_f",
    "temp3f": "temperature_ch3_f",
    "temp4f": "temperature_ch4_f",
    "temp5f": "temperature_ch5_f",
    "temp6f": "temperature_ch6_f",
    "temp7f": "temperature_ch7_f",
    "temp8f": "temperature_ch8_f",
    "humidity1": "humidity_ch1",
    "humidity2": "humidity_ch2",
    "humidity3": "humidity_ch3",
    "humidity4": "humidity_ch4",
    "humidity5": "humidity_ch5",
    "humidity6": "humidity_ch6",
    "humidity7": "humidity_ch7",
    "humidity8": "humidity_ch8",

    # WN31 battery status (up to 8 channels)
    "batt1": "battery_ch1",
    "batt2": "battery_ch2",
    "batt3": "battery_ch3",
    "batt4": "battery_ch4",
    "batt5": "battery_ch5",
    "batt6": "battery_ch6",
    "batt7": "battery_ch7",
    "batt8": "battery_ch8",

    # Lightning
    "lightning_num": "lightning_count",
    "lightning_time": "lightning_time",
    "lightning": "lightning_distance",
}

# Fields that are metadata (not measurements)
METADATA_FIELDS = {"passkey", "station_type", "timestamp_utc", "model", "frequency"}

# Fields that are tags in InfluxDB
TAG_FIELDS = {"station_type", "model", "frequency"}


def parse_ecowitt_data(raw_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parse raw Ecowitt data into a standardized format.

    Args:
        raw_data: Dictionary of form-encoded data from Ecowitt gateway

    Returns:
        Parsed and standardized data dictionary
    """
    parsed = {}

    for raw_key, value in raw_data.items():
        # Map to standardized name
        std_key = FIELD_MAPPING.get(raw_key, raw_key)

        # Convert value to appropriate type
        parsed[std_key] = _convert_value(std_key, value)

    # Parse timestamp if present
    if "timestamp_utc" in parsed:
        parsed["timestamp"] = _parse_timestamp(parsed["timestamp_utc"])

    logger.debug(f"Parsed {len(parsed)} fields from Ecowitt data")

    return parsed


def _convert_value(key: str, value: str) -> Any:
    """Convert string value to appropriate Python type."""
    if value is None or value == "":
        return None

    # Boolean battery fields (0 = OK, 1 = Low)
    if key.startswith("battery_"):
        try:
            return int(value) == 0  # True = OK, False = Low
        except ValueError:
            return None

    # Integer fields
    int_fields = {"wind_direction", "uv_index", "lightning_count", "lightning_distance"}
    if key in int_fields:
        try:
            return int(float(value))
        except ValueError:
            return None

    # Float fields (most measurements)
    try:
        return float(value)
    except ValueError:
        return value  # Return as string if not convertible


def _parse_timestamp(timestamp_str: str) -> datetime:
    """Parse Ecowitt timestamp format."""
    # Ecowitt format: "2024-01-15+14:30:00"
    try:
        # Replace + with space
        clean_str = timestamp_str.replace("+", " ")
        return datetime.strptime(clean_str, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        # Try alternative formats
        try:
            return datetime.fromisoformat(timestamp_str)
        except ValueError:
            return datetime.utcnow()


def get_tags(parsed_data: Dict[str, Any]) -> Dict[str, str]:
    """Extract tag fields from parsed data."""
    return {k: str(v) for k, v in parsed_data.items() if k in TAG_FIELDS and v is not None}


def get_fields(parsed_data: Dict[str, Any]) -> Dict[str, Any]:
    """Extract measurement fields from parsed data (excluding metadata)."""
    return {k: v for k, v in parsed_data.items()
            if k not in METADATA_FIELDS and k not in TAG_FIELDS and v is not None}

"""
InfluxDB Storage Service

Handles writing and querying weather data in InfluxDB.
"""

from typing import Dict, Any, List, Optional
from datetime import datetime
import logging

from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS

from .parser import get_tags, get_fields
from .security import validate_station, validate_measurement, validate_flux_time

logger = logging.getLogger(__name__)


def _station_filter(station: Optional[str]) -> str:
    """
    Línea Flux para acotar por estación.

    station=None  -> estación principal: registros SIN tag 'station' (incluye
                     todo el histórico previo a multi-estación).
    station="x"   -> estación secundaria concreta.

    Valida el nombre (anti-inyección Flux) ya que este es el único punto donde
    'station' se interpola en la consulta.
    """
    station = validate_station(station)
    if station is None:
        return '|> filter(fn: (r) => not exists r["station"])'
    return f'|> filter(fn: (r) => r["station"] == "{station}")'


class InfluxDBStorage:
    """InfluxDB storage handler for weather data."""

    def __init__(self, url: str, token: str, org: str, bucket: str):
        """
        Initialize InfluxDB connection.

        Args:
            url: InfluxDB server URL
            token: Authentication token
            org: Organization name
            bucket: Bucket name for weather data
        """
        self.url = url
        self.org = org
        self.bucket = bucket

        self.client = InfluxDBClient(url=url, token=token, org=org)
        self.write_api = self.client.write_api(write_options=SYNCHRONOUS)
        self.query_api = self.client.query_api()

        logger.info(f"Connected to InfluxDB at {url}")

    def close(self):
        """Close the InfluxDB connection."""
        self.client.close()
        logger.info("Closed InfluxDB connection")

    async def write(self, data: Dict[str, Any], measurement: str = "weather") -> None:
        """
        Write weather data to InfluxDB.

        Args:
            data: Parsed weather data dictionary
            measurement: InfluxDB measurement name
        """
        try:
            point = Point(measurement)

            # Add tags
            tags = get_tags(data)
            for tag_key, tag_value in tags.items():
                point.tag(tag_key, tag_value)

            # Add fields
            fields = get_fields(data)
            for field_key, field_value in fields.items():
                if isinstance(field_value, (int, float)):
                    point.field(field_key, field_value)
                elif isinstance(field_value, bool):
                    point.field(field_key, field_value)
                elif isinstance(field_value, str):
                    point.field(field_key, field_value)

            # Set timestamp
            timestamp = data.get("timestamp")
            if timestamp:
                point.time(timestamp)

            # Write to InfluxDB
            self.write_api.write(bucket=self.bucket, record=point)

            logger.debug(f"Wrote {len(fields)} fields to InfluxDB")

        except Exception as e:
            logger.error(f"Error writing to InfluxDB: {e}")
            raise

    async def get_latest(
        self, measurement: str = "weather", station: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Return the most recent reading as a dict of field -> value.

        Used to repopulate the in-memory "current" data after a restart so the
        API/dashboard keep showing the last reading instead of "no data".
        """
        try:
            query = f'''
                from(bucket: "{self.bucket}")
                |> range(start: -30d)
                |> filter(fn: (r) => r["_measurement"] == "{measurement}")
                {_station_filter(station)}
                |> last()
                |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
            '''
            tables = self.query_api.query(query)
            latest: Dict[str, Any] = {}
            for table in tables:
                for record in table.records:
                    for key, value in record.values.items():
                        # Skip Flux metadata columns
                        if key.startswith("_") or key in ("result", "table"):
                            continue
                        latest[key] = value
            return latest
        except Exception as e:
            logger.error(f"Error fetching latest reading: {e}")
            return {}

    async def query(
        self,
        start: str = "-24h",
        stop: str = "now()",
        measurement: str = "weather",
        fields: Optional[List[str]] = None,
        station: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Query weather data from InfluxDB.

        Args:
            start: Start time (e.g., "-24h", "-7d")
            stop: End time (e.g., "now()")
            measurement: Measurement name
            fields: Optional list of specific fields to retrieve

        Returns:
            List of data points
        """
        # Validación anti-inyección de los parámetros que se interpolan en Flux.
        validate_measurement(measurement)
        validate_flux_time(start, "start")
        validate_flux_time(stop, "stop")
        try:
            # Build Flux query
            field_filter = ""
            if fields:
                field_conditions = " or ".join([f'r["_field"] == "{f}"' for f in fields])
                field_filter = f'|> filter(fn: (r) => {field_conditions})'

            query = f'''
                from(bucket: "{self.bucket}")
                |> range(start: {start}, stop: {stop})
                |> filter(fn: (r) => r["_measurement"] == "{measurement}")
                {_station_filter(station)}
                {field_filter}
                |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
                |> sort(columns: ["_time"])
            '''

            # Execute query
            tables = self.query_api.query(query)

            # Convert to list of dicts
            results = []
            for table in tables:
                for record in table.records:
                    results.append(record.values)

            logger.debug(f"Query returned {len(results)} records")
            return results

        except Exception as e:
            logger.error(f"Error querying InfluxDB: {e}")
            raise

    async def get_daily_stats(
        self, measurement: str = "weather", start: str = "-24h", stop: str = "now()",
        station: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get statistics (min, max, avg) for key measurements over a time range.

        Args:
            start: Flux range start (e.g. "-24h", "-7d", "-30d", "-365d",
                or an RFC3339 timestamp)
            stop: Flux range stop (e.g. "now()" or an RFC3339 timestamp)

        Returns:
            Dictionary with statistics for each field
        """
        validate_measurement(measurement)
        validate_flux_time(start, "start")
        validate_flux_time(stop, "stop")
        try:
            stats_fields = [
                "temperature_outdoor",
                "humidity_outdoor",
                "dew_point",
                "wind_speed",
                "wind_gust",
                "rain_daily",
                "rain_rate",
                "pressure_relative",
                "uv_index",
                "solar_radiation",
                # Interior: necesarios para estaciones secundarias tipo GW1100
                # (solo sensor interconstruido). Aditivo para la principal.
                "temperature_indoor",
                "humidity_indoor",
            ]

            stats = {}

            for field in stats_fields:
                query = f'''
                    from(bucket: "{self.bucket}")
                    |> range(start: {start}, stop: {stop})
                    |> filter(fn: (r) => r["_measurement"] == "{measurement}")
                    {_station_filter(station)}
                    |> filter(fn: (r) => r["_field"] == "{field}")
                    |> group()
                '''

                # Min (min()/max() conservan el _time del registro extremo)
                min_query = query + '|> min()'
                min_result = self.query_api.query(min_query)
                min_val = min_time = None
                for table in min_result:
                    for record in table.records:
                        min_val = record.get_value()
                        min_time = record.get_time()

                # Max
                max_query = query + '|> max()'
                max_result = self.query_api.query(max_query)
                max_val = max_time = None
                for table in max_result:
                    for record in table.records:
                        max_val = record.get_value()
                        max_time = record.get_time()

                # Mean
                mean_query = query + '|> mean()'
                mean_result = self.query_api.query(mean_query)
                mean_val = None
                for table in mean_result:
                    for record in table.records:
                        mean_val = record.get_value()

                stats[field] = {
                    "min": round(min_val, 1) if min_val is not None else None,
                    "min_time": min_time.isoformat() if min_time is not None else None,
                    "max": round(max_val, 1) if max_val is not None else None,
                    "max_time": max_time.isoformat() if max_time is not None else None,
                    "avg": round(mean_val, 1) if mean_val is not None else None,
                }

            return {
                "period": start,
                "stats": stats,
                "generated_at": datetime.utcnow().isoformat()
            }

        except Exception as e:
            logger.error(f"Error getting daily stats: {e}")
            raise

    async def write_daily_summary(
        self, date_str: str, fields: Dict[str, Any], ts: datetime,
        station: Optional[str] = None
    ) -> None:
        """
        Escribe/actualiza el resumen de un día en el measurement 'weather_daily'.
        Un punto por día (tag date=YYYY-MM-DD), timestamp al inicio del día (UTC).
        Reescribir el mismo día sobrescribe (mismo measurement+tag+time).

        station: None para principal, nombre para secundarias (se guarda como tag).
        """
        try:
            point = Point("weather_daily").tag("date", date_str)
            if station is not None:
                point.tag("station", station)
            for k, v in fields.items():
                if v is None:
                    continue
                if isinstance(v, bool):
                    point.field(k, v)
                elif isinstance(v, (int, float)):
                    point.field(k, float(v))
                elif isinstance(v, str):
                    point.field(k, v)
            point.time(ts)
            self.write_api.write(bucket=self.bucket, record=point)
        except Exception as e:
            logger.error(f"Error writing daily summary {date_str}: {e}")
            raise

    async def query_daily_summaries(
        self, start: str = "-365d", stop: str = "now()",
        station: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Devuelve los resúmenes diarios (weather_daily) en el rango dado.

        station: None para principal (sin tag o tag inexistente),
                 nombre para secundarias.
        """
        validate_flux_time(start, "start")
        validate_flux_time(stop, "stop")
        try:
            query = f'''
                from(bucket: "{self.bucket}")
                |> range(start: {start}, stop: {stop})
                |> filter(fn: (r) => r["_measurement"] == "weather_daily")
                {_station_filter(station)}
                |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
            '''
            rows = []
            for table in self.query_api.query(query):
                for record in table.records:
                    rows.append(record.values)
            rows.sort(key=lambda r: r.get("date", ""))
            return rows
        except Exception as e:
            logger.error(f"Error querying daily summaries: {e}")
            return []

    async def get_field_value_ago(
        self, field: str, start: str = "-3h", measurement: str = "weather",
        station: Optional[str] = None
    ) -> Optional[float]:
        """Valor más antiguo del campo dentro de la ventana (p. ej. hace ~3 h)."""
        try:
            q = f'''
                from(bucket: "{self.bucket}")
                |> range(start: {start})
                |> filter(fn: (r) => r["_measurement"] == "{measurement}")
                {_station_filter(station)}
                |> filter(fn: (r) => r["_field"] == "{field}")
                |> first()
            '''
            for table in self.query_api.query(q):
                for record in table.records:
                    return record.get_value()
            return None
        except Exception as e:
            logger.error(f"Error fetching {field} ago: {e}")
            return None

    async def get_comparison(
        self, measurement: str = "weather", station: Optional[str] = None
    ) -> Dict[str, Any]:
        """Promedios de las últimas 24 h vs las 24 h previas (aprox. 'vs ayer')."""
        def avg(field: str, start: str, stop: str):
            q = f'''
                from(bucket: "{self.bucket}")
                |> range(start: {start}, stop: {stop})
                |> filter(fn: (r) => r["_measurement"] == "{measurement}")
                {_station_filter(station)}
                |> filter(fn: (r) => r["_field"] == "{field}")
                |> mean()
            '''
            for table in self.query_api.query(q):
                for record in table.records:
                    return record.get_value()
            return None

        result: Dict[str, Any] = {}
        for field in ("temperature_outdoor", "humidity_outdoor"):
            today = avg(field, "-24h", "now()")
            prev = avg(field, "-48h", "-24h")
            delta = round(today - prev, 1) if (today is not None and prev is not None) else None
            result[field] = {
                "today": round(today, 1) if today is not None else None,
                "yesterday": round(prev, 1) if prev is not None else None,
                "delta": delta,
            }
        return result

    async def get_rain_accumulations(
        self, station: Optional[str] = None
    ) -> Dict[str, Optional[float]]:
        """
        Calcula acumulados de lluvia (semanal, mensual, anual) desde weather_daily.
        Usa el campo rain_total que representa el máximo de rain_daily por día.
        """
        from datetime import datetime, timedelta
        import zoneinfo

        try:
            tz = zoneinfo.ZoneInfo("America/Mexico_City")
            now = datetime.now(tz)

            # Calcular fechas de inicio para cada período
            week_start = (now - timedelta(days=7)).strftime("%Y-%m-%d")
            month_start = now.replace(day=1).strftime("%Y-%m-%d")
            year_start = now.replace(month=1, day=1).strftime("%Y-%m-%d")

            result = {"rain_weekly": None, "rain_monthly": None, "rain_yearly": None}

            # Consulta para sumar rain_total desde weather_daily
            async def sum_rain(start_date: str) -> Optional[float]:
                station_filter = _station_filter(station)
                q = f'''
                    from(bucket: "{self.bucket}")
                    |> range(start: {start_date}T00:00:00Z)
                    |> filter(fn: (r) => r["_measurement"] == "weather_daily")
                    {station_filter}
                    |> filter(fn: (r) => r["_field"] == "rain_total")
                    |> sum()
                '''
                for table in self.query_api.query(q):
                    for record in table.records:
                        val = record.get_value()
                        return round(val, 1) if val is not None else None
                return None

            result["rain_weekly"] = await sum_rain(week_start)
            result["rain_monthly"] = await sum_rain(month_start)
            result["rain_yearly"] = await sum_rain(year_start)

            return result

        except Exception as e:
            logger.error(f"Error calculating rain accumulations: {e}")
            return {"rain_weekly": None, "rain_monthly": None, "rain_yearly": None}

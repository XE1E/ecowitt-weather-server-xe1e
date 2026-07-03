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

logger = logging.getLogger(__name__)


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

    async def query(
        self,
        start: str = "-24h",
        stop: str = "now()",
        measurement: str = "weather",
        fields: Optional[List[str]] = None
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
                {field_filter}
                |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
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

    async def get_daily_stats(self, measurement: str = "weather") -> Dict[str, Any]:
        """
        Get daily statistics (min, max, avg) for key measurements.

        Returns:
            Dictionary with statistics for each field
        """
        try:
            stats_fields = [
                "temperature_outdoor",
                "humidity_outdoor",
                "wind_speed",
                "wind_gust",
                "rain_daily",
                "pressure_relative"
            ]

            stats = {}

            for field in stats_fields:
                query = f'''
                    from(bucket: "{self.bucket}")
                    |> range(start: -24h)
                    |> filter(fn: (r) => r["_measurement"] == "{measurement}")
                    |> filter(fn: (r) => r["_field"] == "{field}")
                    |> group()
                '''

                # Min
                min_query = query + '|> min()'
                min_result = self.query_api.query(min_query)
                min_val = None
                for table in min_result:
                    for record in table.records:
                        min_val = record.get_value()

                # Max
                max_query = query + '|> max()'
                max_result = self.query_api.query(max_query)
                max_val = None
                for table in max_result:
                    for record in table.records:
                        max_val = record.get_value()

                # Mean
                mean_query = query + '|> mean()'
                mean_result = self.query_api.query(mean_query)
                mean_val = None
                for table in mean_result:
                    for record in table.records:
                        mean_val = record.get_value()

                stats[field] = {
                    "min": round(min_val, 1) if min_val is not None else None,
                    "max": round(max_val, 1) if max_val is not None else None,
                    "avg": round(mean_val, 1) if mean_val is not None else None
                }

            return {
                "period": "24h",
                "stats": stats,
                "generated_at": datetime.utcnow().isoformat()
            }

        except Exception as e:
            logger.error(f"Error getting daily stats: {e}")
            raise

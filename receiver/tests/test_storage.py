"""storage.py con un Influx falso: los resultados no cambian y las consultas no
bloquean el event loop (van en un hilo, ver InfluxDBStorage._q)."""
import asyncio
import threading
import time
from datetime import datetime, timezone

from app.services.storage import InfluxDBStorage


class Rec:
    def __init__(self, value=None, field=None, t=None):
        self.values = {"_field": field, "_time": t, "_value": value}
        self._v, self._t = value, t

    def get_value(self):
        return self._v

    def get_time(self):
        return self._t


class Table:
    def __init__(self, records):
        self.records = records


class FakeQueryApi:
    """Responde según un fragmento del Flux; anota en qué hilo corrió."""

    def __init__(self, answers, delay=0.0):
        self.answers, self.delay, self.threads, self.queries = answers, delay, set(), []

    def query(self, flux):
        self.threads.add(threading.get_ident())
        self.queries.append(flux)
        time.sleep(self.delay)
        for frag, tables in self.answers:
            if all(f in flux for f in frag):
                return tables
        return []


def _storage(answers, delay=0.0):
    st = InfluxDBStorage(url="http://influx.invalid:8086", token="t", org="o", bucket="b")
    st.query_api = FakeQueryApi(answers, delay)
    return st


def test_comparison_same_result_and_runs_off_the_loop():
    one = lambda v: [Table([Rec(v)])]  # noqa: E731
    st = _storage([
        (('"temperature_outdoor"', "-24h, stop: now()"), one(20.04)),
        (('"temperature_outdoor"', "-48h, stop: -24h"), one(18.0)),
        (('"humidity_outdoor"', "-24h, stop: now()"), one(55.0)),
        (('"humidity_outdoor"', "-48h, stop: -24h"), one(60.0)),
    ])
    r = asyncio.run(st.get_comparison())
    assert r["temperature_outdoor"] == {"today": 20.0, "yesterday": 18.0, "delta": 2.0}
    assert r["humidity_outdoor"]["delta"] == -5.0
    assert threading.get_ident() not in st.query_api.threads


def test_daily_stats_keeps_shape():
    t = datetime(2026, 9, 24, 15, tzinfo=timezone.utc)
    st = _storage([
        (("min()",), [Table([Rec(12.34, "temperature_outdoor", t)])]),
        (("max()",), [Table([Rec(26.0, "temperature_outdoor", t)])]),
        (("mean()",), [Table([Rec(19.0, "temperature_outdoor")])]),
    ])
    s = asyncio.run(st.get_daily_stats())["stats"]
    assert s["temperature_outdoor"] == {"min": 12.3, "min_time": t.isoformat(), "max": 26.0,
                                        "max_time": t.isoformat(), "avg": 19.0}
    assert s["humidity_outdoor"]["min"] is None  # los campos sin datos siguen apareciendo


def test_slow_influx_does_not_freeze_other_tasks():
    """Con Influx tardando 0.3 s, otra corrutina debe seguir avanzando mientras tanto
    (antes la consulta síncrona congelaba el loop entero)."""
    st = _storage([], delay=0.3)

    async def main():
        done = False
        ticks = 0

        async def query():
            nonlocal done
            await st.get_wind_avg10m()
            done = True

        async def ticker():
            nonlocal ticks
            while not done:
                await asyncio.sleep(0.02)
                ticks += 1

        await asyncio.gather(query(), ticker())
        return ticks

    # Con la consulta en un hilo, el ticker avanza ~15 veces mientras tanto; con la
    # consulta síncrona de antes, la corrutina bloqueaba y el ticker no avanzaba nada.
    assert asyncio.run(main()) >= 5


def test_history_query_aggregates_only_when_asked():
    st = _storage([])
    asyncio.run(st.query(start="-30d", fields=["temperature_outdoor", "humidity_outdoor"], every="1h"))
    asyncio.run(st.query(start="-24h"))
    agg, raw = st.query_api.queries
    assert "aggregateWindow(every: 1h, fn: mean" in agg and 'r["_field"] == "humidity_outdoor"' in agg
    assert "aggregateWindow" not in raw
    import pytest
    for kw in ({"every": "1h"}, {"every": "1d", "fields": ["x"]}, {"fields": ['x") or true or ("']}):
        with pytest.raises(ValueError):
            asyncio.run(st.query(start="-7d", **kw))

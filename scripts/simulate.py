#!/usr/bin/env python3
"""
Simulador de datos meteorológicos para el stack Ecowitt.

Genera una lectura realista (ciclo diario de temperatura + sol/UV según la hora
+ ruido) y la envía al receiver como si fuera un WS2910. Pensado para correr por
cron cada minuto mientras llega el hardware real, para ver el dashboard "vivo".

Se marca con stationtype=SIMULATOR para poder distinguir/limpiar estos datos.

Uso puntual:  python3 scripts/simulate.py
Cron:         * * * * * python3 /ruta/scripts/simulate.py
Limpiar:      ver docs/DEPLOY.md (sección Simulador)
"""
import math
import random
import urllib.parse
import urllib.request
from datetime import datetime

URL = "http://localhost:8080/data/report"


def c_to_f(c: float) -> float:
    return c * 9 / 5 + 32


def main() -> None:
    now = datetime.now()
    hour = now.hour + now.minute / 60.0

    # Ciclo diario de temperatura (pico ~15:00, mínimo ~03:00), en °C
    temp_c = 16 + 7 * math.sin((hour - 9) / 24 * 2 * math.pi) + random.uniform(-0.5, 0.5)
    # Humedad inversamente relacionada con la temperatura
    hum = max(30, min(95, 95 - (temp_c - 9) * 3 + random.uniform(-5, 5)))
    # Luz de día (0 de noche, pico a mediodía)
    day = max(0.0, math.sin((hour - 6) / 12 * math.pi)) if 6 <= hour <= 18 else 0.0
    solar = round(900 * day + random.uniform(0, 30), 1)
    uv = round(11 * day)
    # Viento
    wind = round(random.uniform(0, 14), 1)
    gust = round(wind + random.uniform(0, 6), 1)
    # Lluvia (en pulgadas/hora; casi siempre 0)
    rain_rate = random.choice([0, 0, 0, 0, 0, 0.02, 0.1])
    # Presión (inHg)
    baro = round(29.9 + random.uniform(-0.1, 0.1), 2)
    # Interior / WN31 canal 1 (más estable)
    t_in = 22 + random.uniform(-1, 1)
    h_in = 50 + random.uniform(-5, 5)

    payload = {
        "stationtype": "SIMULATOR",
        "model": "SIM",
        "tempf": round(c_to_f(temp_c), 1),
        "humidity": round(hum),
        "baromrelin": baro,
        "baromabsin": round(baro - 0.1, 2),
        "windspeedmph": wind,
        "windgustmph": gust,
        "winddir": random.randint(0, 359),
        "rainratein": rain_rate,
        "dailyrainin": round(random.uniform(0, 0.2), 2),
        "solarradiation": solar,
        "uv": uv,
        "tempinf": round(c_to_f(t_in), 1),
        "humidityin": round(h_in),
        "temp1f": round(c_to_f(t_in - 1), 1),
        "humidity1": round(h_in + 3),
        "wh65batt": 0,
        "batt1": 0,
    }

    data = urllib.parse.urlencode(payload).encode()
    stamp = now.isoformat(timespec="seconds")
    try:
        with urllib.request.urlopen(URL, data=data, timeout=10) as r:
            print(f"{stamp} -> HTTP {r.status}  temp={temp_c:.1f}C hum={hum:.0f}%")
    except Exception as e:
        print(f"{stamp} ERROR: {e}")


if __name__ == "__main__":
    main()

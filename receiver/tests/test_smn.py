"""Tests del pronóstico SMN, centrados en sobrevivir a las caídas de CONAGUA.

El webservice del SMN responde HTTP 500 con frecuencia. Lo que se fija aquí es que
una caída NO deje la página sin pronóstico habiendo una copia usable en caché.
"""
import asyncio
import time

import pytest

from app.services import smn


FILA = {
    "ides": "9", "idmun": "14", "nes": "Ciudad de México", "nmun": "Benito Juárez",
    "ndia": "0", "dloc": "20260804", "tmax": "24.5", "tmin": "12.0",
    "probprec": "60", "prec": "5.0", "desciel": "Medio nublado",
    "velvien": "10", "dirvienc": "NE", "raf": "25", "cc": "50",
    "lat": "19.38", "lon": "-99.17",
}
FILA_HORA = {
    "ides": "9", "idmun": "14", "hloc": "20260804T15", "temp": "22.0", "hr": "55",
    "dpt": "12.0", "probprec": "40", "prec": "0.5", "desciel": "Medio nublado",
    "velvien": "8", "dirvienc": "NE", "raf": "18",
}


@pytest.fixture(autouse=True)
def limpiar_cache():
    """Cada test arranca sin caché: si no, se contaminan entre sí."""
    smn._daily_cache.update(ts=0.0, rows=None)
    smn._muni_cache.update(ts=0.0, list=None)
    smn._hourly_cache.clear()
    yield


def parchar_fetch(monkeypatch, *, falla=False):
    """Sustituye la descarga real. `falla=True` simula el 500 de CONAGUA."""
    llamadas = []

    async def fake(method: int):
        llamadas.append(method)
        if falla:
            raise RuntimeError("500 Internal Server Error")
        return [FILA] if method == 1 else [FILA_HORA]

    monkeypatch.setattr(smn, "_fetch", fake)
    return llamadas


def test_pronostico_fresco(monkeypatch):
    parchar_fetch(monkeypatch)
    r = asyncio.run(smn.get_forecast())
    assert r["municipio"] == "Benito Juárez, Ciudad de México"
    assert len(r["days"]) == 1 and r["days"][0]["tmax"] == 24.5
    assert len(r["hours"]) == 1
    assert r["stale"] is False
    assert r["age_minutes"] < 1


def test_cae_conagua_y_hay_copia_se_sirve_la_copia(monkeypatch):
    """Lo importante: una caída con caché NO debe dejar sin pronóstico."""
    parchar_fetch(monkeypatch)
    asyncio.run(smn.get_forecast())            # llena la caché

    # el TTL expira y CONAGUA se cae
    smn._daily_cache["ts"] = time.time() - (smn._TTL + 600)
    for c in smn._hourly_cache.values():
        c["ts"] = time.time() - (smn._TTL + 600)
    parchar_fetch(monkeypatch, falla=True)

    r = asyncio.run(smn.get_forecast())
    assert len(r["days"]) == 1                 # sigue habiendo pronóstico
    assert r["days"][0]["tmax"] == 24.5
    assert r["stale"] is True                  # y se avisa que es viejo
    assert r["age_minutes"] > smn._TTL / 60


def test_cae_conagua_sin_copia_si_falla(monkeypatch):
    """Sin nada en caché no se puede inventar: debe propagar el error para que el
    endpoint responda 502 y la UI muestre el aviso."""
    parchar_fetch(monkeypatch, falla=True)
    with pytest.raises(Exception):
        asyncio.run(smn.get_forecast())


def test_fetched_at_es_la_hora_del_dato_no_de_la_respuesta(monkeypatch):
    parchar_fetch(monkeypatch)
    asyncio.run(smn.get_forecast())
    hace_2h = time.time() - 7200
    smn._daily_cache["ts"] = hace_2h
    parchar_fetch(monkeypatch, falla=True)

    r = asyncio.run(smn.get_forecast())
    assert 119 < r["age_minutes"] < 121, "la edad debe reflejar el dato, no el ahora"
    assert r["fetched_at"].startswith(
        time.strftime("%Y-%m-%dT%H", time.gmtime(hace_2h))
    )


def test_municipios_sobrevive_la_caida(monkeypatch):
    parchar_fetch(monkeypatch)
    lst = asyncio.run(smn.municipios())
    assert lst == [{"ides": "9", "idmun": "14",
                    "nes": "Ciudad de México", "nmun": "Benito Juárez"}]

    smn._muni_cache["ts"] = time.time() - (smn._TTL + 600)
    smn._daily_cache.update(ts=0.0, rows=None)   # fuerza descarga del diario
    parchar_fetch(monkeypatch, falla=True)

    assert asyncio.run(smn.municipios()) == lst   # la lista vieja sirve igual


def test_no_vuelve_a_descargar_dentro_del_ttl(monkeypatch):
    llamadas = parchar_fetch(monkeypatch)
    asyncio.run(smn.get_forecast())
    n = len(llamadas)
    asyncio.run(smn.get_forecast())
    assert len(llamadas) == n, "dentro del TTL debe responder desde la caché"

"""Ciclones tropicales (NHC): geometría de México, lectura de la trayectoria del
KMZ y nivel de amenaza. Nada de red: el KML de prueba es un recorte real (Polo,
aviso 20, 2026-09-25)."""
import asyncio

import pytest

from app.services import nhc

KML = """<kml><Document>
<Placemark><description>72 Hour Forecast Track</description>
<LineString><coordinates> -108.5,17.1,0 -109.8,17.2,0 </coordinates></LineString></Placemark>
<Placemark><description><![CDATA[<tr><td nowrap>12 hr Forecast</td></tr>
<tr><td nowrap>Valid at:  5:00 PM MST September 25, 2026 </td></tr>
<tr><td nowrap>Maximum Wind: 155 knots (180 mph) </td></tr>
<tr><td nowrap>Wind Gusts: 190 knots (220 mph) </td></tr>]]></description>
<Point><coordinates> -109.8,17.2,0 </coordinates></Point></Placemark>
<Placemark><description><![CDATA[<tr><td nowrap>84 hr Forecast</td></tr>
<tr><td nowrap>Valid at:  5:00 AM MST September 29, 2026 </td></tr>
<tr><td nowrap>Maximum Wind: 90 knots (105 mph) </td></tr>]]></description>
<Point><coordinates> -110.8,26.9,0 </coordinates></Point></Placemark>
</Document></kml>"""


@pytest.mark.parametrize("lat,lon,esperado", [
    (19.43, -99.13, True),     # CDMX
    (24.14, -110.31, True),    # La Paz, B.C.S.
    (29.07, -110.95, True),    # Hermosillo
    (20.97, -89.62, True),     # Mérida
    (27.0, -111.0, False),     # Golfo de California (mar entre la península y Sonora)
    (15.0, -105.0, False),     # Pacífico abierto
    (30.0, -97.0, False),      # Texas
    (15.0, -90.5, False),      # Guatemala
])
def test_en_mexico(lat, lon, esperado):
    assert nhc.en_mexico(lat, lon) is esperado


def test_cercania_da_lugar_y_distancia_razonable():
    c = nhc.cercania(15.0, -105.0)          # frente a Michoacán/Colima
    assert not c["sobre_tierra"]
    assert 250 < c["km_costa"] < 550
    assert c["lugar"].endswith(("Mich.", "Col.", "Jal.", "Gro."))


def test_categoria_saffir_simpson():
    assert nhc.categoria_ss(50) is None
    assert nhc.categoria_ss(64) == 1
    assert nhc.categoria_ss(96) == 3
    assert nhc.categoria_ss(137) == 5


def test_rumbo_en_espanol():
    assert nhc.rumbo(270) == "O"
    assert nhc.rumbo(30) == "NNE"
    assert nhc.rumbo(None) is None


def test_parse_track_kml_hora_en_utc():
    pts = nhc.parse_track_kml(KML)
    assert [p["horas"] for p in pts] == [12, 84]          # la línea se ignora
    assert pts[0]["valido"] == "2026-09-26T00:00:00Z"     # 5 PM MST = 00Z
    assert pts[0]["viento_kt"] == 155 and pts[0]["racha_kt"] == 190
    assert pts[1]["racha_kt"] is None


def test_evaluar_toca_tierra_es_alta_con_hora():
    ev = nhc.evaluar(17.1, -108.5, nhc.parse_track_kml(KML), con_avisos=False)
    assert ev["nivel"] == "alta"
    assert ev["toca_tierra"] is not None
    assert ev["toca_tierra"]["hora"].startswith("2026-09-2")


def test_evaluar_lejos_es_baja():
    ev = nhc.evaluar(30.1, -42.5, [], con_avisos=False)   # Fay, a media Atlántico
    assert ev["nivel"] == "baja" and ev["toca_tierra"] is None


def test_img_url_lista_blanca():
    assert nhc.img_url("EP172026", "cono").endswith("/storm_graphics/EP17/EP172026_5day_cone_es.png")
    assert nhc.img_url("ep172026", "mensajes").endswith("EP172026_spanish_key_messages.png")
    assert "/storm_graphics/AT06/AL062026_" in nhc.img_url("AL062026", "cono")   # carpeta AT, no AL
    assert nhc.img_url("outlook", "atlantico").endswith("two_atl_7d0.png")
    assert nhc.img_url("../../etc", "cono") is None
    assert nhc.img_url("EP172026", "http://evil") is None
    assert nhc.img_url("CP012026", "cono") is None


def test_get_ciclones_sirve_copia_si_el_nhc_cae(monkeypatch):
    nhc._storms_cache.update(ts=0.0, data={"tormentas": [], "amenaza": None, "stale": False})

    async def falla(*a, **k):
        raise RuntimeError("HTTP 500")
    monkeypatch.setattr(nhc, "_get", falla)
    d = asyncio.run(nhc.get_ciclones(19.38, -99.17))
    assert d["stale"] is True
    nhc._storms_cache.update(ts=0.0, data=None)

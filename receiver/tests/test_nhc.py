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


class _Resp:
    def __init__(self, status, content=b"", headers=None):
        self.status_code, self.content, self.headers = status, content, headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


def test_get_img_revalida_con_if_modified_since(monkeypatch):
    """Tras el TTL se pregunta al NHC con If-Modified-Since; un 304 conserva la
    imagen y un 200 la reemplaza (el cono nuevo llega sin esperar 15 min)."""
    nhc._img_cache.clear()
    pedidos = []
    respuestas = [
        _Resp(200, b"v1", {"content-type": "image/png", "last-modified": "L1"}),
        _Resp(304),
        _Resp(200, b"v2", {"content-type": "image/png", "last-modified": "L2"}),
    ]

    class _Cliente:
        def __init__(self, headers=None, **k):
            self.h = headers or {}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            pedidos.append(self.h.get("If-Modified-Since"))
            return respuestas.pop(0)

    monkeypatch.setattr(nhc.httpx, "AsyncClient", _Cliente)
    url = "https://www.nhc.noaa.gov/x.png"
    assert asyncio.run(nhc.get_img(url))["data"] == b"v1"
    assert asyncio.run(nhc.get_img(url))["data"] == b"v1"      # dentro del TTL: no pregunta
    nhc._img_cache[url]["ts"] -= 120
    assert asyncio.run(nhc.get_img(url))["data"] == b"v1"      # 304: se queda
    nhc._img_cache[url]["ts"] -= 120
    assert asyncio.run(nhc.get_img(url))["data"] == b"v2"      # 200: se reemplaza
    assert pedidos == [None, "L1", "L1"]
    nhc._img_cache.clear()


# ── Textos: probabilidades (PWS) y avisos (TCP) ──────────────────────────────
PWS = """
LOCATION       KT

PUNTA EUGENIA  34  X   X( X)   X( X)   X( X)   2( 2)   2( 4)   X( 4)

LORETO         34  X   X( X)   X( X)   X( X)  38(38)  33(71)   1(72)
LORETO         50  X   X( X)   X( X)   X( X)   9( 9)  25(34)   X(34)
LORETO         64  X   X( X)   X( X)   X( X)   3( 3)  11(14)   X(14)

ISLA SOCORRO   34 46  43(89)   1(90)   X(90)   X(90)   X(90)   X(90)
20N 115W       34  X   X( X)  18(18)  14(32)   2(34)   X(34)   X(34)
HILO           34  X   X( X)   5( 5)
"""

TCP = """WATCHES AND WARNINGS
--------------------
CHANGES WITH THIS ADVISORY:

The government of Mexico has issued a Hurricane Warning.

SUMMARY OF WATCHES AND WARNINGS IN EFFECT:

A Hurricane Warning is in effect for...
* The coast of Mexico from Cabo San Lucas to Santa Fe

A Tropical Storm Watch is in effect for...
* Baja California Sur from Punta Abreojos northward to Punta Eugenia
* Hawaii County

Interests in Sinaloa should closely monitor the progress of this system.
Additional watches may be required for portions of the area tonight or early Saturday.


DISCUSSION AND OUTLOOK
----------------------
At 200 PM MST...
"""


def test_parse_pws_acumulada_y_mexico():
    p = {d["lugar"]: d for d in nhc.parse_pws(PWS)}
    assert p["Loreto"] == {"lugar": "Loreto", "mexico": True, "p34": 72, "p50": 34, "p64": 14}
    assert p["Punta Eugenia"]["p34"] == 4
    assert p["Isla Socorro"]["p34"] == 90
    assert "20N 115W" not in p and "20n 115w" not in {k.lower() for k in p}   # puntos de mar fuera
    assert p["Hilo"]["mexico"] is False


def test_parse_avisos_tcp():
    a = nhc.parse_avisos_tcp(TCP)
    assert a["mexico"] == "aviso"
    tipos = [v["tipo"] for v in a["vigentes"]]
    assert tipos == ["Aviso de huracán", "Vigilancia de tormenta tropical"]
    z = a["vigentes"][0]["zonas"][0]
    assert z["zona"] == "La costa de México de Cabo San Lucas a Santa Fe" and z["mexico"]
    zs = a["vigentes"][1]["zonas"]
    assert zs[0]["zona"] == "Baja California Sur de Punta Abreojos hacia el norte hasta Punta Eugenia"
    assert zs[1]["mexico"] is False                          # Hawái no es México
    textos = [n["texto"] for n in a["notas"]]
    assert "En Sinaloa deben seguir de cerca la evolución de este sistema." in textos
    assert any("esta noche o temprano el sábado" in t for t in textos)


def test_parse_avisos_sin_avisos():
    a = nhc.parse_avisos_tcp("WATCHES AND WARNINGS\n----\nThere are no coastal watches or warnings in effect.\n")
    assert a == {"vigentes": [], "notas": [], "mexico": None}


def test_parse_cono_y_ww():
    kml_cono = "<Polygon><outerBoundaryIs><LinearRing><coordinates>" + " ".join(
        f"{-110 + i * 0.1},{17 + i * 0.05},0" for i in range(10)) + "</coordinates></LinearRing></outerBoundaryIs></Polygon>"
    anillos = nhc.parse_cono(kml_cono)
    assert len(anillos) == 1 and anillos[0][0] == [17.0, -110.0]
    assert anillos[0][-1] == [17.45, -109.1]                  # el último punto no se pierde al diezmar
    ww = nhc.parse_ww("<Placemark><styleUrl>#HWR</styleUrl><LineString><coordinates>-109.9,22.9,0 -110.2,23.4,0"
                      "</coordinates></LineString></Placemark>")
    assert ww == [{"clave": "HWR", "tipo": "Aviso de huracán", "coords": [[22.9, -109.9], [23.4, -110.2]]}]


# ── Bitácora de temporada ────────────────────────────────────────────────────
def _t(**k):
    base = {"id": "ep172026", "nombre": "Polo", "cuenca": "ep", "tipo": "Huracán", "clase": "HU",
            "categoria": 3, "viento_kt": 100, "viento_kmh": 185, "presion_mb": 960, "nivel": "media",
            "toca_tierra": None, "ahora": {"km_costa": 400, "lugar": "Manzanillo, Col.", "sobre_tierra": False},
            "acercamiento": {"km_costa": 300, "lugar": "Manzanillo, Col.", "horas": 48, "hora": "2026-09-27T12:00:00Z"},
            "avisos": {"vigentes": [], "notas": [], "mexico": None}}
    base.update(k)
    return base


def test_registrar_temporada_guarda_maximos(tmp_path):
    d = str(tmp_path)
    nhc.registrar_temporada(d, [_t(viento_kt=100, presion_mb=960, nivel="media")])
    nhc.registrar_temporada(d, [_t(viento_kt=140, categoria=5, presion_mb=920, nivel="alta")])
    nhc.registrar_temporada(d, [_t(viento_kt=90, categoria=2, presion_mb=970, nivel="baja")])
    r = nhc.resumen_temporada(d, 2026)
    e = r["tormentas"][0]
    assert (e["max_kt"], e["max_categoria"], e["min_mb"], e["nivel_max"]) == (140, 5, 920, "alta")
    assert r["pacifico"] == {"total": 1, "tormentas": 1, "huracanes": 1, "mayores": 1}
    assert r["atlantico"]["total"] == 0


# ── Alertas de ciclones (cambios, no estado) ─────────────────────────────────
from app.services import cyclone_alerts  # noqa: E402


def test_alertas_solo_cambios():
    msgs, est = cyclone_alerts.eventos({}, [_t()])
    assert len(msgs) == 1 and "se acerca a México" in msgs[0]
    assert cyclone_alerts.eventos(est, [_t()])[0] == []                     # sin cambios: nada

    msgs, est = cyclone_alerts.eventos(est, [_t(categoria=4, viento_kt=120)])
    assert len(msgs) == 1 and "se intensificó" in msgs[0] and "cat. 4" in msgs[0]

    msgs, est = cyclone_alerts.eventos(est, [_t(categoria=4, viento_kt=120, nivel="alta",
                                                 toca_tierra={"horas": 60, "lugar": "Manzanillo, Col.", "hora": None})])
    assert len(msgs) == 1 and "AMENAZA A MÉXICO" in msgs[0] and "tocar tierra" in msgs[0]

    aviso = {"vigentes": [{"tipo": "Aviso de huracán", "grado": "aviso", "zonas": [
        {"zona": "La costa de México de Manzanillo a Cabo Corrientes", "mexico": True}]}], "notas": [], "mexico": "aviso"}
    msgs, est = cyclone_alerts.eventos(est, [_t(categoria=4, viento_kt=120, nivel="alta", avisos=aviso,
                                                 toca_tierra={"horas": 60, "lugar": "Manzanillo, Col.", "hora": None})])
    assert len(msgs) == 1 and "Aviso de huracán" in msgs[0] and "Cabo Corrientes" in msgs[0]

    msgs, est = cyclone_alerts.eventos(est, [_t(nivel="baja")])
    assert len(msgs) == 1 and msgs[0].startswith("✅") and "ya no amenaza" in msgs[0]


def test_alertas_lejanas_no_molestan():
    lejos = _t(nivel="baja")
    msgs, est = cyclone_alerts.eventos({}, [lejos])
    assert msgs == []
    assert cyclone_alerts.eventos(est, [_t(nivel="baja", categoria=5, viento_kt=150)])[0] == []


def test_alerta_se_disipo():
    _, est = cyclone_alerts.eventos({}, [_t()])
    msgs, est = cyclone_alerts.eventos(est, [])
    assert len(msgs) == 1 and "ya no está activo" in msgs[0]
    assert est == {}


def test_estado_persistente(tmp_path):
    p = str(tmp_path / "ciclones" / "alertas.json")
    assert cyclone_alerts.cargar(p) == {}
    _, est = cyclone_alerts.eventos({}, [_t()])
    cyclone_alerts.guardar(p, est)
    assert cyclone_alerts.eventos(cyclone_alerts.cargar(p), [_t()])[0] == []   # tras reiniciar, no repite


# ── Resumen IA de la discusión técnica (cyclone_summary) ─────────────────────
TCD = """000
WTPZ42 KNHC 260256
TCDEP2

Hurricane Polo Discussion Number  22
NWS National Hurricane Center Miami FL       EP172026

Polo will likely remain a dangerous major hurricane.

$$
Forecaster D. Zelinsky"""


def _cs(tmp_path, monkeypatch, respuesta=None, error=None):
    from app.services import cyclone_summary as cs
    monkeypatch.setattr(cs, "_cache", None)
    monkeypatch.setattr(cs, "_fallos", {})
    llamadas = []

    async def fake(texto, api_key, model):
        llamadas.append(texto)
        if error:
            raise error
        return respuesta
    monkeypatch.setattr(cs, "generar", fake)
    return cs, llamadas


def _tc(sid="ep172026", nivel="alta", num="022"):
    return {"id": sid, "nivel": nivel, "discusion_num": num, "discusion_url": f"https://nhc/{sid}"}


async def _texto_fijo(url):
    return TCD


def test_resumen_solo_cercanas_y_una_vez_por_discusion(tmp_path, monkeypatch):
    cs, llamadas = _cs(tmp_path, monkeypatch, respuesta="Polo sigue siendo huracán mayor.")
    tormentas = [_tc(), _tc("al062026", nivel="baja")]
    n = asyncio.run(cs.actualizar(str(tmp_path), tormentas, _texto_fijo, "k", "m"))
    assert n == 1 and len(llamadas) == 1
    assert "Forecaster" not in cs.limpiar(llamadas[0])   # la firma no va al modelo
    assert cs.numero_discusion(llamadas[0]) == 22
    assert cs.leer(str(tmp_path), "ep172026")["resumen"] == "Polo sigue siendo huracán mayor."
    assert cs.leer(str(tmp_path), "al062026") is None
    # Misma discusión: no se vuelve a llamar. Y persiste en disco (nuevo proceso).
    asyncio.run(cs.actualizar(str(tmp_path), tormentas, _texto_fijo, "k", "m"))
    assert len(llamadas) == 1
    cs._cache = None
    assert cs.leer(str(tmp_path), "ep172026")["discusion_num"] == 22


def test_resumen_espera_si_la_pagina_trae_la_discusion_anterior(tmp_path, monkeypatch):
    cs, llamadas = _cs(tmp_path, monkeypatch, respuesta="x")
    n = asyncio.run(cs.actualizar(str(tmp_path), [_tc(num="023")], _texto_fijo, "k", "m"))
    assert n == 0 and not llamadas


def test_resumen_fallo_no_reintenta_en_cada_vuelta(tmp_path, monkeypatch):
    cs, llamadas = _cs(tmp_path, monkeypatch, error=ValueError("429"))
    for _ in range(3):
        asyncio.run(cs.actualizar(str(tmp_path), [_tc()], _texto_fijo, "k", "m"))
    assert len(llamadas) == 1
    assert cs.leer(str(tmp_path), "ep172026") is None


def test_zona_mexicana_sin_estado_en_el_nombre():
    """Polo, aviso 22: 'Punta Eugenia to Santa Fe' no nombra estado ni país."""
    txt = """WATCHES AND WARNINGS
--------------------
CHANGES WITH THIS ADVISORY:

The government of Mexico has issued a Hurricane Watch from Punta
Eugenia southward to Santa Fe.

SUMMARY OF WATCHES AND WARNINGS IN EFFECT:

A Hurricane Watch is in effect for...
* Punta Eugenia to Santa Fe
"""
    a = nhc.parse_avisos_tcp(txt)
    assert a["vigentes"][0]["zonas"][0]["mexico"] is True
    assert a["mexico"] == "vigilancia"
    # Sin la frase del gobierno (avisos siguientes) también: Punta Eugenia está en la lista.
    a = nhc.parse_avisos_tcp(txt.replace("The government of Mexico has issued a Hurricane Watch from Punta\nEugenia southward to Santa Fe.", "None."))
    assert a["mexico"] == "vigilancia"
    # Respaldo por la frase del gobierno cuando ningún extremo está en la lista.
    t2 = txt.replace("Punta\nEugenia", "Punta\nInventada").replace("* Punta Eugenia", "* Punta Inventada")
    assert nhc.parse_avisos_tcp(t2)["mexico"] == "vigilancia"

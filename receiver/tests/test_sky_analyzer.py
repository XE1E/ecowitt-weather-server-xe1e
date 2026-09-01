"""
Tests de sun_glare_likely() (services/sky_analyzer.py): mitiga el halo/sobreexposición
del sol sin obstrucción en el encuadre de la cámara -- ver
docs/archivo/PLAN-HDR-CAMARA.md (por qué no se resuelve tocando la cámara) y el
comentario junto a _CLEAR_SKY_I0 en sky_analyzer.py (de dónde salen los coeficientes).

Los pares (altura, radiación) de los casos "clear"/"cloudy" son datos REALES medidos
por esta estación el 2026-08-31 -- no inventados -- para que el test sirva de ancla si
algún día se reajusta la curva con más días de calibración.
"""
from app.services import sky_analyzer as sa

# (altitud del sol en grados, radiación medida W/m²) -- mañana confirmada despejada
# (fotos sin una sola nube real hasta la tarde).
_DESPEJADO = [
    (9.00, 58.25),
    (23.06, 210.22),
    (37.19, 440.38),
    (51.21, 641.34),
    (64.78, 667.13),
    (76.32, 652.67),
]

# Misma tarde, ya con cúmulos reales tapando el sol (visto en la foto de esa hora).
_NUBLADO = (77.35, 363.31)


def test_sun_glare_likely_dia_despejado():
    for altitud, radiacion in _DESPEJADO:
        assert sa.sun_glare_likely(altitud, radiacion), (altitud, radiacion)


def test_sun_glare_likely_con_nubes_reales():
    altitud, radiacion = _NUBLADO
    assert not sa.sun_glare_likely(altitud, radiacion)


def test_sun_glare_likely_sin_datos():
    assert not sa.sun_glare_likely(None, 500.0)
    assert not sa.sun_glare_likely(45.0, None)


def test_sun_glare_likely_altura_muy_baja():
    # Cerca del horizonte sin(altura) es muy ruidoso -- no se evalúa, aunque la
    # razón radiación/esperado por sí sola daría "despejado".
    assert not sa.sun_glare_likely(2.0, 10.0)


def test_clear_sky_radiation_bajo_el_horizonte():
    assert sa.clear_sky_radiation(-5.0) == 0.0
    assert sa.clear_sky_radiation(0.0) == 0.0


def test_prompt_incluye_aviso_solo_si_hay_glare():
    con_glare = sa._build_user_prompt({"sun_glare_likely": True, "temperature_outdoor": 20})
    sin_glare = sa._build_user_prompt({"sun_glare_likely": False, "temperature_outdoor": 20})
    sin_datos = sa._build_user_prompt(None)

    assert "AVISO DE SOL DIRECTO" in con_glare
    assert "AVISO DE SOL DIRECTO" not in sin_glare
    assert "AVISO DE SOL DIRECTO" not in sin_datos

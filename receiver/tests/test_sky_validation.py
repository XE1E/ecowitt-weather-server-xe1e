"""Tests para sky_validation.compare_conditions.

La recalibración (2026-09-14) separa dos ejes -- ¿llueve o no? vs. nubosidad
-- en vez de una lista de pares "cercanos" a mano. Motivo verificado contra
el histórico real de producción (1149 comparaciones, 2026-08-29 a
2026-09-13): ~40% del "differ" era solo ruido de nubosidad de 2 escalones
(p. ej. parcialmente nublado vs cubierto), indistinguible en los conteos del
desacuerdo que sí importa (nublado-sin-lluvia vs modelo-dice-lluvia, 347
casos). Los tests anclan ambos comportamientos.
"""
from app.services.sky_validation import compare_conditions, MATCH_EXACT, MATCH_CLOSE, MATCH_DIFFER, MATCH_CONFLICT

# WMO: 0/1 clear, 2 partly_cloudy, 3 overcast, 51 rainy (drizzle), 95 stormy


def test_exact_match():
    assert compare_conditions("overcast", 3)[0] == MATCH_EXACT


def test_night_always_close():
    assert compare_conditions("night", 95)[0] == MATCH_CLOSE


def test_cloudiness_one_step_is_close():
    # mostly_cloudy (rank 2) vs overcast (WMO 3, rank 3) -- un solo escalón.
    assert compare_conditions("mostly_cloudy", 3)[0] == MATCH_CLOSE


def test_cloudiness_two_steps_is_differ_not_conflict():
    # El caso real más frecuente del histórico: parcialmente nublado (rank 1)
    # vs "cubierto" (rank 3, WMO overcast) -- ruido de clasificación, pero no
    # tan cercano como un solo escalón. NO debe ser "conflict".
    match, _ = compare_conditions("partly_cloudy", 3)
    assert match == MATCH_DIFFER


def test_clear_vs_overcast_is_differ_not_conflict():
    # Tres escalones de nubosidad, pero SIGUE sin ser sobre precipitación --
    # se reserva "conflict" para cuando el hecho de si llueve está en duda.
    match, _ = compare_conditions("clear", 3)
    assert match == MATCH_DIFFER


def test_rainy_vs_stormy_is_close():
    # Ambos coinciden en que SÍ hay precipitación, solo difiere la intensidad.
    assert compare_conditions("rainy", 95)[0] == MATCH_CLOSE


def test_cloudy_no_rain_vs_forecast_rain_is_differ():
    # El caso más común en producción (347 de 1149 comparaciones reales,
    # 2026-08-29 a 2026-09-13): cámara ve nublado sin lluvia, modelo predice
    # lluvia. Real, pero no la combinación de máxima confianza -> differ.
    match, _ = compare_conditions("overcast", 51)  # 51 = rainy (llovizna)
    assert match == MATCH_DIFFER


def test_clear_vs_forecast_rain_is_conflict():
    # Cámara ve cielo TOTALMENTE despejado (alta confianza de "no llueve") y
    # el modelo predice lluvia -- ahí sí es un conflicto real.
    match, _ = compare_conditions("clear", 61)  # 61 = rainy (lluvia ligera)
    assert match == MATCH_CONFLICT


def test_partly_cloudy_vs_forecast_storm_is_conflict():
    # Modelo con alta confianza de tormenta, cámara ve algo casi despejado.
    match, _ = compare_conditions("partly_cloudy", 95)
    assert match == MATCH_CONFLICT


def test_partly_cloudy_vs_forecast_light_rain_is_differ_not_conflict():
    # Mismo eje (precipitación vs no) pero SIN el extremo de confianza de
    # ninguno de los dos lados -- differ, no conflict.
    match, _ = compare_conditions("partly_cloudy", 51)
    assert match == MATCH_DIFFER


def test_camera_sees_rain_forecast_says_overcast_is_differ():
    # Dirección inversa: la cámara SÍ ve lluvia y el modelo no la predijo esa
    # hora -- el modelo se quedó corto, pero sin ser el extremo "clear".
    match, _ = compare_conditions("rainy", 3)
    assert match == MATCH_DIFFER


def test_foggy_vs_cloudy_is_differ():
    assert compare_conditions("foggy", 3)[0] == MATCH_DIFFER


def test_foggy_exact_match():
    assert compare_conditions("foggy", 45)[0] == MATCH_EXACT

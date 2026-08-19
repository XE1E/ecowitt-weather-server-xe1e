"""
Tests del histórico diario de análisis del cielo (services/camera.py).

El grueso es la MIGRACIÓN: el histórico se guardaba dentro de la carpeta del día y por
eso lo borraba la poda de fotos a los 7 días; ahora vive en `<camera_dir>/analysis/`.
Mover datos es donde se pierden datos, así que se prueba que funda en vez de pisar, que
no se repita al re-ejecutarse y que la poda de fotos ya no se lo lleve.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import pytest

from app.services.camera import CameraStore


def _store(tmp_path, **kw):
    return CameraStore(base_dir=str(tmp_path), **kw)


def _analisis(ts, coverage=50, condition="partly_cloudy"):
    """Un análisis con la forma que produce sky_analyzer."""
    return {
        "analyzed_at": ts,
        "cloud_coverage_pct": coverage,
        "sky_condition": condition,
        "cloud_type": "cumulus",
        "visibility": "good",
        "development": "stable",
        "precipitation_visible": False,
    }


def _viejo(tmp_path, fecha, entradas):
    """Deja un histórico en el sitio ANTIGUO (dentro de la carpeta del día)."""
    d = tmp_path / fecha
    d.mkdir(parents=True, exist_ok=True)
    (d / "analysis.json").write_text(json.dumps(entradas), encoding="utf-8")
    return d / "analysis.json"


# ---------- dónde se guarda ----------
def test_se_guarda_fuera_de_la_carpeta_del_dia(tmp_path):
    st = _store(tmp_path)
    st.save_analysis(_analisis("2026-08-18T15:00:00+00:00", 80, "overcast"))

    assert os.path.exists(tmp_path / "analysis" / "2026-08-18.json")
    # Y NO donde vivía antes, que es lo que lo condenaba a morir con las fotos.
    assert not os.path.exists(tmp_path / "2026-08-18" / "analysis.json")


def test_la_poda_de_fotos_ya_no_se_lo_lleva(tmp_path):
    """El caso que motivó todo: un día vencido pierde sus fotos pero no su análisis."""
    st = _store(tmp_path, retention_days=7)
    viejo = (datetime.now().astimezone() - timedelta(days=30)).strftime("%Y-%m-%d")
    st.save_analysis(_analisis(f"{viejo}T15:00:00+00:00"))
    # Carpeta de fotos de ese día, que la poda debe borrar entera.
    (tmp_path / viejo).mkdir(exist_ok=True)
    (tmp_path / viejo / "120000.jpg").write_bytes(b"\xff\xd8\xff" + b"x" * 100)

    st._prune()

    assert not os.path.exists(tmp_path / viejo)          # las fotos, fuera
    assert st.get_daily_analysis(viejo) is not None      # el análisis, intacto


def test_fecha_invalida_no_sale_de_la_carpeta(tmp_path):
    """`date` llega de la URL en /api/camera/analysis/history."""
    st = _store(tmp_path)
    assert st.get_daily_analysis("../../etc/passwd") is None
    assert st.get_daily_analysis("hoy") is None
    with pytest.raises(ValueError):
        st._daily_analysis_path("../..")


def test_dias_listados_del_mas_nuevo_al_mas_viejo(tmp_path):
    st = _store(tmp_path)
    for f in ("2026-08-16", "2026-08-18", "2026-08-17"):
        st.save_analysis(_analisis(f"{f}T15:00:00+00:00"))
    assert [d["date"] for d in st.get_analysis_days()] == [
        "2026-08-18", "2026-08-17", "2026-08-16",
    ]
    assert all(d["count"] == 1 for d in st.get_analysis_days())


def test_los_analisis_del_dia_se_acumulan(tmp_path):
    st = _store(tmp_path)
    for h in (10, 11, 12):
        st.save_analysis(_analisis(f"2026-08-18T{h:02d}:00:00+00:00", coverage=h))
    entradas = st.get_daily_analysis("2026-08-18")
    assert len(entradas) == 3
    assert [e["coverage"] for e in entradas] == [10, 11, 12]


def test_un_analisis_con_error_no_se_guarda(tmp_path):
    st = _store(tmp_path)
    st.save_analysis({"error": "429 quota", "analyzed_at": "2026-08-18T15:00:00+00:00"})
    assert st.get_daily_analysis("2026-08-18") is None


# ---------- migración ----------
def test_migracion_sube_lo_que_quedo_en_la_carpeta_del_dia(tmp_path):
    _viejo(tmp_path, "2026-08-17", [{"ts": "2026-08-17T10:00:00+00:00", "coverage": 20}])
    _viejo(tmp_path, "2026-08-18", [{"ts": "2026-08-18T10:00:00+00:00", "coverage": 40}])
    st = _store(tmp_path)

    assert st.migrate_daily_analysis() == 2
    assert len(st.get_daily_analysis("2026-08-17")) == 1
    assert st.get_daily_analysis("2026-08-18")[0]["coverage"] == 40
    # El origen se vacía: es lo que hace la migración idempotente.
    assert not os.path.exists(tmp_path / "2026-08-17" / "analysis.json")


def test_migracion_es_idempotente(tmp_path):
    _viejo(tmp_path, "2026-08-18", [{"ts": "2026-08-18T10:00:00+00:00", "coverage": 40}])
    st = _store(tmp_path)
    assert st.migrate_daily_analysis() == 1
    assert st.migrate_daily_analysis() == 0
    assert len(st.get_daily_analysis("2026-08-18")) == 1


def test_migracion_FUNDE_y_no_pisa(tmp_path):
    """
    Con datos en los dos sitios, ninguno se pierde: perder análisis en la migración que
    los está salvando sería el peor final posible.
    """
    st = _store(tmp_path)
    st.save_analysis(_analisis("2026-08-18T12:00:00+00:00", coverage=99))   # ya en el sitio nuevo
    _viejo(tmp_path, "2026-08-18", [                                        # y en el viejo
        {"ts": "2026-08-18T09:00:00+00:00", "coverage": 11},
        {"ts": "2026-08-18T15:00:00+00:00", "coverage": 33},
    ])

    assert st.migrate_daily_analysis() == 1
    entradas = st.get_daily_analysis("2026-08-18")
    assert len(entradas) == 3
    # Y quedan EN ORDEN, no apiladas por procedencia.
    assert [e["coverage"] for e in entradas] == [11, 99, 33]


def test_migracion_no_duplica_lo_que_ya_estaba(tmp_path):
    st = _store(tmp_path)
    st.save_analysis(_analisis("2026-08-18T12:00:00+00:00", coverage=50))
    entradas = st.get_daily_analysis("2026-08-18")
    _viejo(tmp_path, "2026-08-18", entradas)      # el MISMO contenido en el sitio viejo

    st.migrate_daily_analysis()
    assert len(st.get_daily_analysis("2026-08-18")) == 1


def test_migracion_ignora_basura_y_sigue(tmp_path):
    (tmp_path / "2026-08-18").mkdir()
    (tmp_path / "2026-08-18" / "analysis.json").write_text("{no es json", encoding="utf-8")
    _viejo(tmp_path, "2026-08-17", [{"ts": "2026-08-17T10:00:00+00:00", "coverage": 20}])
    st = _store(tmp_path)

    assert st.migrate_daily_analysis() == 1                  # el bueno sí pasa
    assert st.get_daily_analysis("2026-08-17") is not None
    assert st.get_daily_analysis("2026-08-18") is None


def test_migracion_sin_nada_que_migrar(tmp_path):
    assert _store(tmp_path).migrate_daily_analysis() == 0


# ---------- retención propia ----------
def test_por_omision_no_se_purga_nunca(tmp_path):
    st = _store(tmp_path)                                    # analysis_retention_days=0
    antiguo = (datetime.now().astimezone() - timedelta(days=3000)).strftime("%Y-%m-%d")
    st.save_analysis(_analisis(f"{antiguo}T12:00:00+00:00"))
    assert st.prune_analysis(st.analysis_retention_days) == 0
    assert st.get_daily_analysis(antiguo) is not None


def test_con_retencion_se_purga_lo_vencido(tmp_path):
    st = _store(tmp_path, analysis_retention_days=30)
    hoy = datetime.now().astimezone().date()
    viejo = (hoy - timedelta(days=100)).isoformat()
    nuevo = (hoy - timedelta(days=2)).isoformat()
    for f in (viejo, nuevo):
        st.save_analysis(_analisis(f"{f}T12:00:00+00:00"))

    assert st.prune_analysis(30) == 1
    assert st.get_daily_analysis(viejo) is None
    assert st.get_daily_analysis(nuevo) is not None


def test_guardar_una_foto_dispara_la_purga_del_analisis(tmp_path):
    """La poda va colgada de `save`, al mismo ritmo que la de fotogramas."""
    st = _store(tmp_path, retention_days=7, analysis_retention_days=30)
    viejo = (datetime.now().astimezone().date() - timedelta(days=100)).isoformat()
    st.save_analysis(_analisis(f"{viejo}T12:00:00+00:00"))

    st.save(b"\xff\xd8\xff" + b"x" * 2000, taken_at=datetime.now(timezone.utc))
    assert st.get_daily_analysis(viejo) is None

"""
Tests del archivo permanente de "1 foto por día" (services/camera.py).

Motivo: la efeméride "En este día" del dashboard compara SIEMPRE con años
anteriores, y las capturas completas se podan a los 7 días (R2 refleja la
misma poda -- `rclone sync`, ver scripts/backup-camera-fotos.sh). Sin un
archivo aparte, una comparación de años atrás nunca tiene foto disponible.

Se usan timestamps NAIVE (sin offset) a propósito: `astimezone()` sobre un
datetime naive lo trata como ya-en-hora-local sin correrlo, así que la fecha y
hora esperadas coinciden en cualquier máquina donde corran los tests, sin
depender de la zona horaria del host.
"""
import os
from datetime import datetime, timedelta

from app.services.camera import CameraStore


def _store(tmp_path, **kw):
    return CameraStore(base_dir=str(tmp_path), **kw)


def _analisis(ts_iso, condition="partly_cloudy", visibility="good"):
    return {
        "analyzed_at": ts_iso,
        "cloud_coverage_pct": 40,
        "sky_condition": condition,
        "cloud_type": "cumulus",
        "visibility": visibility,
        "development": "stable",
        "precipitation_visible": False,
    }


def _frame(tmp_path, date_str, hhmmss, content=b"\xff\xd8\xff" + b"x" * 200):
    d = tmp_path / date_str
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{hhmmss}.jpg"
    p.write_bytes(content)
    return p


def test_archive_best_photo_copies_the_frame(tmp_path):
    st = _store(tmp_path)
    st.save_analysis(_analisis("2026-08-18T15:00:00"))
    _frame(tmp_path, "2026-08-18", "150000", content=b"\xff\xd8\xff" + b"FOTO")

    assert st.archive_best_photo("2026-08-18") is True
    dest = tmp_path / "archive" / "2026-08-18.jpg"
    assert dest.exists()
    assert dest.read_bytes() == b"\xff\xd8\xff" + b"FOTO"


def test_archive_best_photo_is_idempotent(tmp_path):
    st = _store(tmp_path)
    st.save_analysis(_analisis("2026-08-18T15:00:00"))
    _frame(tmp_path, "2026-08-18", "150000")

    assert st.archive_best_photo("2026-08-18") is True
    assert st.archive_best_photo("2026-08-18") is False  # ya estaba


def test_archive_best_photo_false_without_analysis(tmp_path):
    st = _store(tmp_path)
    assert st.archive_best_photo("2026-08-18") is False


def test_archive_best_photo_false_without_frame(tmp_path):
    """El análisis existe pero el fotograma ya se podó: no hay nada que copiar."""
    st = _store(tmp_path)
    st.save_analysis(_analisis("2026-08-18T15:00:00"))
    assert st.archive_best_photo("2026-08-18") is False


def test_archive_best_photo_invalid_date(tmp_path):
    st = _store(tmp_path)
    assert st.archive_best_photo("../../etc/passwd") is False


def test_archive_path_none_until_archived(tmp_path):
    st = _store(tmp_path)
    assert st.archive_path("2026-08-18") is None
    st.save_analysis(_analisis("2026-08-18T15:00:00"))
    _frame(tmp_path, "2026-08-18", "150000")
    st.archive_best_photo("2026-08-18")
    assert st.archive_path("2026-08-18") == str(tmp_path / "archive" / "2026-08-18.jpg")


def test_prune_does_not_touch_archive_dir(tmp_path):
    """`archive/` no parsea como fecha: la poda por carpetas de día debe ignorarla."""
    st = _store(tmp_path, retention_days=1)
    st.save_analysis(_analisis("2026-08-18T15:00:00"))
    _frame(tmp_path, "2026-08-18", "150000")
    st.archive_best_photo("2026-08-18")

    st._prune()

    assert (tmp_path / "archive" / "2026-08-18.jpg").exists()


def test_save_archives_yesterdays_best_before_pruning(tmp_path):
    """El disparador real: cada `save()` intenta archivar el día anterior antes de
    podar, así queda a salvo mucho antes de que la retención se lo lleve."""
    st = _store(tmp_path, retention_days=7)
    st.save_analysis(_analisis("2026-08-18T15:00:00"))
    _frame(tmp_path, "2026-08-18", "150000", content=b"\xff\xd8\xff" + b"AYER")

    # Sube una foto al día SIGUIENTE: dispara el intento de archivar "ayer".
    # (mínimo 1024 bytes: `save()` rechaza capturas más chicas por sospechosas)
    st.save(b"\xff\xd8\xff" + b"HOY" * 500, taken_at=datetime(2026, 8, 19, 8, 0))

    dest = tmp_path / "archive" / "2026-08-18.jpg"
    assert dest.exists()
    assert dest.read_bytes() == b"\xff\xd8\xff" + b"AYER"


def test_save_never_archives_todays_own_photo(tmp_path):
    """El día en curso puede seguir cambiando de "mejor": no se archiva a sí mismo."""
    st = _store(tmp_path, retention_days=7)
    st.save_analysis(_analisis("2026-08-18T08:00:00"))
    _frame(tmp_path, "2026-08-18", "080000")

    st.save(b"\xff\xd8\xff" + b"MAS" * 500, taken_at=datetime(2026, 8, 18, 9, 0))

    assert not (tmp_path / "archive" / "2026-08-18.jpg").exists()

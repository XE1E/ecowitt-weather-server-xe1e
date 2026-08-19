"""
Tests del timelapse diario (services/timelapse.py).

Los fotogramas de prueba se sintetizan con el propio ffmpeg en vez de traer un JPEG
incrustado en base64: el test que de verdad importa --que el encode produce un MP4--
necesita ffmpeg de todas formas, así que si está, sirve para las dos cosas, y si no
está, ese test se salta. Así no hay blobs binarios en el repo.
"""
import asyncio
import json
import os
import subprocess
from datetime import datetime, timedelta

import pytest

from app.services.timelapse import TimelapseError, TimelapseService

FFMPEG = TimelapseService.ffmpeg_available()
sin_ffmpeg = pytest.mark.skipif(not FFMPEG, reason="ffmpeg no está instalado")


def _svc(tmp_path, **kw):
    kw.setdefault("min_frames", 3)
    kw.setdefault("width", 160)
    kw.setdefault("fps", 6)
    return TimelapseService(base_dir=str(tmp_path), **kw)


def _frame(path, color="blue"):
    """Un JPEG de verdad, hecho con ffmpeg."""
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", f"color=c={color}:s=64x48", "-frames:v", "1", path],
        check=True,
    )


def _dia(tmp_path, fecha, n, con_analysis=False):
    """Crea la carpeta de un día con `n` fotogramas (y opcionalmente su analysis.json)."""
    d = tmp_path / fecha
    d.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        nombre = f"{6 + i // 60:02d}{i % 60:02d}00.jpg"
        if FFMPEG:
            _frame(str(d / nombre), color="blue" if i % 2 else "red")
        else:
            (d / nombre).write_bytes(b"\xff\xd8\xff" + b"x" * 100)
    if con_analysis:
        (d / "analysis.json").write_text("[]", encoding="utf-8")
    return d


# ---------- validación de la fecha (la que protege las rutas) ----------
@pytest.mark.parametrize("mala", [
    "../../etc/passwd", "20260818", "", "hoy",
    "2026-08-18/../..", "2026-13-01", "2026-02-30",
])
def test_fecha_invalida_no_construye_rutas(tmp_path, mala):
    """
    Sin esto el endpoint sería una lectura arbitraria de disco: `date` viene de la URL
    y se usa para armar la ruta del vídeo.
    """
    svc = _svc(tmp_path)
    with pytest.raises(TimelapseError):
        svc.video_path(mala)
    with pytest.raises(TimelapseError):
        svc.status(mala)


def test_fecha_valida_pasa(tmp_path):
    svc = _svc(tmp_path)
    assert svc.video_path("2026-08-18").endswith("2026-08-18.mp4")


def test_fecha_se_normaliza(tmp_path):
    """`strptime` acepta "2026-8-1" sin ceros; se canoniza para que no aparezcan
    nombres de archivo que no cuadran con las carpetas de día de la cámara."""
    svc = _svc(tmp_path)
    assert svc.video_path("2026-8-1").endswith("2026-08-01.mp4")
    assert svc.status("2026-8-1")["date"] == "2026-08-01"


# ---------- inspección ----------
def test_frames_ignora_analysis_json(tmp_path):
    """`analysis.json` vive en la misma carpeta y no es un fotograma."""
    _dia(tmp_path, "2026-08-18", 4, con_analysis=True)
    svc = _svc(tmp_path)
    frames = svc.frames("2026-08-18")
    assert len(frames) == 4
    assert all(f.endswith(".jpg") for f in frames)


def test_frames_en_orden_cronologico(tmp_path):
    d = tmp_path / "2026-08-18"
    d.mkdir()
    for nombre in ("120000.jpg", "060000.jpg", "180000.jpg"):
        (d / nombre).write_bytes(b"\xff\xd8\xff" + b"x" * 100)
    svc = _svc(tmp_path)
    assert [os.path.basename(f) for f in svc.frames("2026-08-18")] == [
        "060000.jpg", "120000.jpg", "180000.jpg",
    ]


def test_status_sin_nada(tmp_path):
    st = _svc(tmp_path).status("2026-08-18")
    assert st["frames"] == 0
    assert st["video"] is False
    assert st["enough_frames"] is False
    assert st["stale"] is False


def test_status_pocos_fotogramas(tmp_path):
    _dia(tmp_path, "2026-08-18", 2)
    st = _svc(tmp_path, min_frames=3).status("2026-08-18")
    assert st["frames"] == 2
    assert st["enough_frames"] is False


def test_stale_cuando_llegaron_capturas_nuevas(tmp_path):
    """
    El vídeo de HOY se queda corto según entran fotos. `stale` es lo que hace que la
    tarea periódica lo rehaga, y se calcula comparando fotogramas usados vs. presentes
    --no fechas de archivo, que siempre darían el mp4 como más nuevo--.
    """
    _dia(tmp_path, "2026-08-18", 5)
    svc = _svc(tmp_path)
    os.makedirs(svc.out_dir, exist_ok=True)
    with open(svc.video_path("2026-08-18"), "wb") as f:
        f.write(b"mp4 de mentira")
    with open(svc.meta_path("2026-08-18"), "w", encoding="utf-8") as f:
        json.dump({"date": "2026-08-18", "frames": 5}, f)

    assert svc.status("2026-08-18")["stale"] is False

    _frame_extra = tmp_path / "2026-08-18" / "235900.jpg"
    _frame_extra.write_bytes(b"\xff\xd8\xff" + b"x" * 100)
    st = svc.status("2026-08-18")
    assert st["frames"] == 6 and st["frames_used"] == 5
    assert st["stale"] is True


def test_days_junta_dias_con_fotos_y_con_video(tmp_path):
    _dia(tmp_path, "2026-08-17", 3)
    svc = _svc(tmp_path)
    os.makedirs(svc.out_dir, exist_ok=True)
    # Un día cuyos fotogramas ya purgó la cámara pero cuyo vídeo sobrevive: es
    # justo el caso que justifica guardar los vídeos fuera de las carpetas de día.
    with open(svc.video_path("2026-07-01"), "wb") as f:
        f.write(b"mp4 de mentira")
    fechas = [d["date"] for d in svc.days()]
    assert fechas == ["2026-08-17", "2026-07-01"]
    assert svc.days()[1]["frames"] == 0 and svc.days()[1]["video"] is True


def test_days_ignora_carpetas_ajenas(tmp_path):
    _dia(tmp_path, "2026-08-18", 3)
    (tmp_path / "timelapse").mkdir(exist_ok=True)
    (tmp_path / "loquesea").mkdir()
    (tmp_path / "latest.jpg").write_bytes(b"\xff\xd8\xff")
    assert [d["date"] for d in _svc(tmp_path).days()] == ["2026-08-18"]


# ---------- generación ----------
def test_ensure_se_niega_con_pocos_fotogramas(tmp_path):
    _dia(tmp_path, "2026-08-18", 2)
    svc = _svc(tmp_path, min_frames=5)
    with pytest.raises(TimelapseError) as e:
        asyncio.run(svc.ensure("2026-08-18"))
    assert "fotograma" in str(e.value)


@sin_ffmpeg
def test_encode_produce_un_mp4(tmp_path):
    _dia(tmp_path, "2026-08-18", 6)
    svc = _svc(tmp_path)
    st = asyncio.run(svc.ensure("2026-08-18"))
    assert st["video"] is True
    assert st["frames_used"] == 6
    assert st["bytes"] > 0
    assert st["seconds"] == round(6 / svc.fps, 1)
    # Firma de un MP4: 'ftyp' en la caja inicial.
    with open(svc.video_path("2026-08-18"), "rb") as f:
        assert b"ftyp" in f.read(64)
    # Y no deja temporales tirados.
    assert not [n for n in os.listdir(svc.out_dir) if n.endswith(".tmp") or n.endswith(".list")]


@sin_ffmpeg
def test_encode_no_repite_si_ya_esta(tmp_path):
    """Segunda llamada sin fotos nuevas: no vuelve a codificar."""
    _dia(tmp_path, "2026-08-18", 6)
    svc = _svc(tmp_path)
    asyncio.run(svc.ensure("2026-08-18"))
    antes = os.path.getmtime(svc.video_path("2026-08-18"))
    asyncio.run(svc.ensure("2026-08-18"))
    assert os.path.getmtime(svc.video_path("2026-08-18")) == antes


@sin_ffmpeg
def test_refresh_stale_false_no_rehace(tmp_path):
    """
    Lo que usa el endpoint público: con el vídeo presente pero incompleto, servir lo
    que hay en vez de ponerse a codificar en cada visita.
    """
    _dia(tmp_path, "2026-08-18", 6)
    svc = _svc(tmp_path)
    asyncio.run(svc.ensure("2026-08-18"))
    _frame(str(tmp_path / "2026-08-18" / "235900.jpg"))
    assert svc.status("2026-08-18")["stale"] is True

    st = asyncio.run(svc.ensure("2026-08-18", refresh_stale=False))
    assert st["frames_used"] == 6          # sigue el de antes

    st = asyncio.run(svc.ensure("2026-08-18"))
    assert st["frames_used"] == 7          # la tarea periódica sí lo rehace


@sin_ffmpeg
def test_force_rehace_aunque_este_al_dia(tmp_path):
    _dia(tmp_path, "2026-08-18", 6)
    svc = _svc(tmp_path)
    asyncio.run(svc.ensure("2026-08-18"))
    os.remove(svc.video_path("2026-08-18"))
    st = asyncio.run(svc.ensure("2026-08-18", force=True))
    assert st["video"] is True


# ---------- retención ----------
def test_prune_borra_los_viejos_y_deja_los_nuevos(tmp_path):
    svc = _svc(tmp_path, retention_days=30)
    os.makedirs(svc.out_dir, exist_ok=True)
    hoy = datetime.now().astimezone().date()
    viejo = (hoy - timedelta(days=100)).isoformat()
    nuevo = (hoy - timedelta(days=2)).isoformat()
    for f in (viejo, nuevo):
        with open(svc.video_path(f), "wb") as fh:
            fh.write(b"mp4")
        with open(svc.meta_path(f), "w", encoding="utf-8") as fh:
            json.dump({"frames": 1}, fh)

    assert svc.prune() == 2                      # el mp4 y el json del viejo
    assert not os.path.exists(svc.video_path(viejo))
    assert os.path.exists(svc.video_path(nuevo))


def test_prune_desactivado_no_borra(tmp_path):
    svc = _svc(tmp_path, retention_days=0)
    os.makedirs(svc.out_dir, exist_ok=True)
    antiguo = (datetime.now().astimezone().date() - timedelta(days=999)).isoformat()
    with open(svc.video_path(antiguo), "wb") as f:
        f.write(b"mp4")
    assert svc.prune() == 0
    assert os.path.exists(svc.video_path(antiguo))


def test_disk_bytes_solo_cuenta_videos(tmp_path):
    svc = _svc(tmp_path)
    os.makedirs(svc.out_dir, exist_ok=True)
    with open(svc.video_path("2026-08-18"), "wb") as f:
        f.write(b"x" * 500)
    with open(svc.meta_path("2026-08-18"), "w", encoding="utf-8") as f:
        json.dump({"frames": 1}, f)
    assert svc.disk_bytes() == 500

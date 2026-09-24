"""Parser del radar SACMEX: sólo nombres de cuadro válidos, en orden y con su hora."""
from app.services import sacmex_radar as sr

_HTML = """
<img src="/radar/imageRadar/max1/EWR-MAXZ260923_222918r032XMax1.JPG">
<img src="/radar/imageRadar/max1/EWR-MAXZ260923_221929r032XMax1.JPG">
<img src="/radar/imageRadar/max1/EWR-MAXZ260923_222918r032XMax1.JPG">
<img src="/plantilla/img/logoFoot.png">
"""


def test_parse_frames_orders_dedupes_and_converts_cdmx_time_to_utc():
    frames = sr.parse_frames(_HTML)
    assert [f["id"] for f in frames] == [
        "EWR-MAXZ260923_221929r032XMax1.JPG",
        "EWR-MAXZ260923_222918r032XMax1.JPG",
    ]
    # 22:29:18 en CDMX (UTC-6) = 04:29:18 UTC del día siguiente
    assert frames[-1]["time"] == "2026-09-24T04:29:18+00:00"


def test_get_image_rejects_anything_but_a_frame_name():
    sr._images["EWR-MAXZ260923_222918r032XMax1.JPG"] = b"jpg"
    assert sr.get_image("EWR-MAXZ260923_222918r032XMax1.JPG") == b"jpg"
    for bad in ("../../etc/passwd", "EWR-MAXZ260923_222918r032XMax1.JPG?x=1", "", "foo.JPG"):
        assert sr.get_image(bad) is None


def test_archive_saves_each_frame_once_in_its_local_day(tmp_path):
    sr._images.clear()
    sr._images["EWR-MAXZ260923_222918r032XMax1.JPG"] = b"a"
    sr._images["EWR-MAXZ260924_000419r032XMax1.JPG"] = b"b"
    assert sr.archive_new(str(tmp_path)) == 2
    assert (tmp_path / "2026-09-23" / "EWR-MAXZ260923_222918r032XMax1.JPG").read_bytes() == b"a"
    assert (tmp_path / "2026-09-24" / "EWR-MAXZ260924_000419r032XMax1.JPG").read_bytes() == b"b"
    # El radar dejó de publicar: mismos cuadros en memoria, nada nuevo que guardar
    assert sr.archive_new(str(tmp_path)) == 0
    s = sr.archive_summary(str(tmp_path))
    assert s["frames"] == 2 and [d["date"] for d in s["days"]] == ["2026-09-23", "2026-09-24"]


def test_prune_only_removes_old_date_folders(tmp_path):
    for name in ("2026-08-01", "2026-09-10", "2026-09-24", "otra-cosa"):
        (tmp_path / name).mkdir()
    assert sr.prune_archive(str(tmp_path), 30, "2026-09-24") == 1
    assert sorted(p.name for p in tmp_path.iterdir()) == ["2026-09-10", "2026-09-24", "otra-cosa"]
    assert sr.prune_archive(str(tmp_path), 0, "2026-09-24") == 0

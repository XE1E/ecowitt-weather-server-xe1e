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

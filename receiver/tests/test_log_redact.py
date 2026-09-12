"""Tests for log-credential redaction (app.services.log_redact)."""

import logging

from app.services.log_redact import RedactingFilter, redact


def test_redacts_camelcase_key_param():
    # Regresión: "siteAuthenticationKey" (WOW-BE) se filtró en producción
    # porque el patrón viejo exigía un limite de palabra (\b) antes de "key",
    # y el camelCase no lo tiene.
    url = ("http://wow.meteo.be/api/v2/send?siteid=abc-123"
           "&siteAuthenticationKey=xe1voz11&dateutc=now&tempf=70.3")
    out = redact(url)
    assert "xe1voz11" not in out
    assert "siteAuthenticationKey=<redacted>" in out
    # El site id no es secreto y debe quedar visible
    assert "siteid=abc-123" in out


def test_redacts_wu_style_id_and_password():
    url = "https://rtupdate.wunderground.com/weatherstation/updateweatherstation.php?ID=STATIONID&PASSWORD=supersecret&dateutc=now"
    out = redact(url)
    assert "STATIONID" not in out
    assert "supersecret" not in out
    assert "dateutc=now" in out


def test_redacts_bare_token_param():
    out = redact("https://api.waqi.info/feed/here/?token=abcd1234")
    assert "abcd1234" not in out
    assert "token=<redacted>" in out


def test_redacts_awekas_positional_password_hash():
    out = redact("http://data.awekas.at/eingabe_pruefung.php?val=xe1e;deadbeef1234;11.09.2026;12:00;25.0")
    assert "deadbeef1234" not in out
    assert "val=xe1e;<redacted>" in out


def test_does_not_touch_unrelated_params():
    # No debe sobre-redactar parametros normales de clima.
    out = redact("...&tempf=70.3&humidity=55&windgustmph=3.4&winddir=48&solarradiation=400")
    assert out == "...&tempf=70.3&humidity=55&windgustmph=3.4&winddir=48&solarradiation=400"


def test_redacting_filter_rewrites_log_record_message():
    record = logging.LogRecord(
        name="httpx", level=logging.INFO, pathname=__file__, lineno=1,
        msg="HTTP Request: GET http://wow.meteo.be/api/v2/send?siteAuthenticationKey=secretkey123",
        args=(), exc_info=None,
    )
    assert RedactingFilter().filter(record) is True
    assert "secretkey123" not in record.getMessage()

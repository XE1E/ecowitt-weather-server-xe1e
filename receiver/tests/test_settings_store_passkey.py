"""Tests de la derivación de PASSKEY (registro de estaciones)."""
import hashlib

import pytest

from app.services.settings_store import passkey_from_identifier, passkey_from_mac

_MAC = "8C:4F:00:4F:8B:63"
_PK = hashlib.md5(_MAC.encode()).hexdigest().upper()


def test_passkey_from_mac_is_md5_of_colon_uppercase_mac():
    assert passkey_from_mac("8c4f004f8b63") == _PK


@pytest.mark.parametrize("value", [_MAC, "8c-4f-00-4f-8b-63", "8C4F004F8B63", " 8c:4f:00:4f:8b:63 "])
def test_identifier_accepts_mac_in_any_format(value):
    assert passkey_from_identifier(value) == _PK


def test_identifier_accepts_ready_passkey_any_case():
    assert passkey_from_identifier(_PK.lower()) == _PK


@pytest.mark.parametrize("value", ["", "hola", "8C:4F:00", "Z" * 32])
def test_identifier_rejects_garbage(value):
    with pytest.raises(ValueError):
        passkey_from_identifier(value)

#!/usr/bin/env python3
"""F13: secretstorage/D-Bus failure must yield a defined empty fallback, not a crash or garbage key."""
from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cookie_crypto import decrypt_chromium_value, derive_key, linux_keyring_secret  # noqa: E402


def _encrypt_cbc_v10(key: bytes, plaintext: str) -> bytes:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    data = plaintext.encode()
    pad = 16 - (len(data) % 16)
    padded = data + bytes([pad]) * pad
    encryptor = Cipher(algorithms.AES128(key), modes.CBC(b" " * 16)).encryptor()
    return b"v10" + encryptor.update(padded) + encryptor.finalize()


def _fake_secretstorage(dbus_init) -> types.ModuleType:
    """A stub `secretstorage` whose exception hierarchy mirrors the real package.

    secretstorage.dbus_init() wraps every D-Bus/keyring connection failure (missing
    DBUS_SESSION_BUS_ADDRESS, ConnectionError, ValueError) into
    SecretServiceNotAvailableException, a subclass of SecretStorageException — so the
    real package never installed in this env can still be exercised faithfully.
    """
    fake = types.ModuleType("secretstorage")
    exceptions = types.ModuleType("secretstorage.exceptions")

    class SecretStorageException(Exception):
        pass

    class SecretServiceNotAvailableException(SecretStorageException):
        pass

    exceptions.SecretStorageException = SecretStorageException
    exceptions.SecretServiceNotAvailableException = SecretServiceNotAvailableException
    fake.exceptions = exceptions
    fake.dbus_init = dbus_init
    return fake


class SecretStorageFallback(unittest.TestCase):
    def test_secretstorage_dbus_failure_graceful(self) -> None:
        # F13: on a headless host secretstorage.dbus_init() raises
        # SecretServiceNotAvailableException (D-Bus session bus unavailable). The reader
        # must return a DEFINED empty fallback (b"") — never crash, never substitute the
        # b"peanuts" garbage key.
        def _boom(*_a, **_k):
            raise fake.exceptions.SecretServiceNotAvailableException(
                "Failed to connect to the D-Bus session bus"
            )

        fake = _fake_secretstorage(_boom)
        with patch.dict(sys.modules, {"secretstorage": fake, "secretstorage.exceptions": fake.exceptions}):
            secret = linux_keyring_secret("Chrome Safe Storage")

        self.assertEqual(secret, b"")
        self.assertNotEqual(secret, b"peanuts")

    def test_non_dbus_exception_is_not_swallowed(self) -> None:
        # Guardrail: only the secretstorage/D-Bus failure is caught. An unrelated
        # programming error inside the keyring read must still propagate.
        def _bug(*_a, **_k):
            raise KeyError("unrelated bug")

        fake = _fake_secretstorage(_bug)
        with patch.dict(sys.modules, {"secretstorage": fake, "secretstorage.exceptions": fake.exceptions}):
            with self.assertRaises(KeyError):
                linux_keyring_secret("Chrome Safe Storage")


class HappyPathDecryption(unittest.TestCase):
    def test_linux_cbc_roundtrip_unchanged(self) -> None:
        # Regression: a valid linux-derived key still decrypts a v10 CBC blob.
        key = derive_key("linux", b"secret")
        blob = _encrypt_cbc_v10(key, "session-token-123")
        self.assertEqual(decrypt_chromium_value("linux", key, blob), "session-token-123")


class CbcPaddingValidation(unittest.TestCase):
    def test_wrong_key_raises_instead_of_returning_garbage(self) -> None:
        # #6: decrypting a v10 CBC blob with the wrong key must fail loudly. The
        # PKCS7 unpadder rejects the malformed padding produced by the wrong key,
        # so the caller never receives a silently mis-decrypted cookie value.
        right_key = derive_key("linux", b"secret")
        wrong_key = derive_key("linux", b"not-the-real-password")
        blob = _encrypt_cbc_v10(right_key, "session-token-123")
        with self.assertRaises(ValueError):
            decrypt_chromium_value("linux", wrong_key, blob)

    def test_tampered_ciphertext_raises(self) -> None:
        # A modified ciphertext corrupts the final plaintext block, invalidating
        # the PKCS7 padding — decryption must raise, not return garbage.
        key = derive_key("linux", b"secret")
        blob = bytearray(_encrypt_cbc_v10(key, "session-token-123"))
        blob[-1] ^= 0xFF
        with self.assertRaises(ValueError):
            decrypt_chromium_value("linux", key, bytes(blob))


if __name__ == "__main__":
    unittest.main(verbosity=2)

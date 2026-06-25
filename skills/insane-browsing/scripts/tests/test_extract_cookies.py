#!/usr/bin/env python3
"""Synthetic-fixture tests for cross-platform cookie extraction (no live browser)."""
from __future__ import annotations

import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Callable
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cookie_crypto import decrypt_chromium_value, derive_key  # noqa: E402
from cookie_paths import UnsupportedPlatform, resolve_cookie_db  # noqa: E402
from extract_cookies import extract_cookies, inject_cookies, write_cookie_file  # noqa: E402


def _make_chromium_db(path: Path, name: str, encrypted_value: bytes, host: str, samesite: int = 1) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute(
        "CREATE TABLE cookies (name TEXT, encrypted_value BLOB, host_key TEXT, path TEXT, "
        "expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)"
    )
    conn.execute(
        "INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?)",
        (name, encrypted_value, host, "/", 13_300_000_000_000_000, 1, 1, samesite),
    )
    conn.commit()
    conn.close()


def _make_firefox_db(path: Path, name: str, value: str, host: str) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute(
        "CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, "
        "expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER)"
    )
    conn.execute("INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?,?)", (name, value, host, "/", 9999999999, 1, 1, 1))
    conn.commit()
    conn.close()


def _encrypt_cbc_v10(key: bytes, plaintext: str) -> bytes:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    data = plaintext.encode()
    pad = 16 - (len(data) % 16)
    padded = data + bytes([pad]) * pad
    encryptor = Cipher(algorithms.AES128(key), modes.CBC(b" " * 16)).encryptor()
    return b"v10" + encryptor.update(padded) + encryptor.finalize()


def _encrypt_gcm_v10(key: bytes, plaintext: str) -> bytes:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    nonce = b"n" * 12
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    ciphertext = encryptor.update(plaintext.encode()) + encryptor.finalize()
    return b"v10" + nonce + ciphertext + encryptor.tag


class PathResolution(unittest.TestCase):
    def test_macos_chromium_path(self) -> None:
        base = Path(self.tmp())
        target = base / "Google/Chrome/Default/Cookies"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"")
        self.assertEqual(resolve_cookie_db("chrome", "darwin", base_override=base), target)

    def test_linux_chromium_network_path(self) -> None:
        base = Path(self.tmp())
        target = base / "google-chrome/Default/Network/Cookies"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"")
        self.assertEqual(resolve_cookie_db("chrome", "linux", base_override=base), target)

    def test_windows_chromium_path(self) -> None:
        base = Path(self.tmp())
        target = base / "Google/Chrome/User Data/Default/Cookies"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"")
        self.assertEqual(resolve_cookie_db("chrome", "win32", base_override=base), target)

    def test_unsupported_platform_raises(self) -> None:
        with self.assertRaises(UnsupportedPlatform):
            resolve_cookie_db("chrome", "sunos")

    def test_unsupported_browser_raises(self) -> None:
        with self.assertRaises(UnsupportedPlatform):
            resolve_cookie_db("nonexistent", "darwin")

    def tmp(self) -> str:
        import tempfile

        d = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(d, ignore_errors=True))
        return d


class KeyDerivation(unittest.TestCase):
    def test_macos_iters_differ_from_linux(self) -> None:
        secret = b"some-keychain-secret"
        self.assertNotEqual(derive_key("darwin", secret), derive_key("linux", secret))
        self.assertEqual(len(derive_key("darwin", secret)), 16)

    def test_windows_passthrough_32_bytes(self) -> None:
        key = b"k" * 32
        self.assertEqual(derive_key("win32", key), key)

    def test_windows_rejects_wrong_length(self) -> None:
        with self.assertRaises(ValueError):
            derive_key("win32", b"short")

    def test_unsupported_platform_raises(self) -> None:
        with self.assertRaises(UnsupportedPlatform):
            derive_key("sunos", b"x")


class Decryption(unittest.TestCase):
    def test_macos_cbc_roundtrip(self) -> None:
        key = derive_key("darwin", b"secret")
        blob = _encrypt_cbc_v10(key, "session-token-123")
        self.assertEqual(decrypt_chromium_value("darwin", key, blob), "session-token-123")

    def test_windows_gcm_roundtrip(self) -> None:
        key = b"k" * 32
        blob = _encrypt_gcm_v10(key, "win-token-xyz")
        self.assertEqual(decrypt_chromium_value("win32", key, blob), "win-token-xyz")


class EndToEnd(unittest.TestCase):
    def _base_with_db(self, rel: str, make: Callable[[Path], None]) -> Path:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        db = base / rel
        db.parent.mkdir(parents=True)
        make(db)
        return base

    def test_chromium_extract_with_injected_keyring(self) -> None:
        key = derive_key("darwin", b"secret")
        blob = _encrypt_cbc_v10(key, "logged-in")
        base = self._base_with_db(
            "Google/Chrome/Default/Cookies",
            lambda p: _make_chromium_db(p, "SID", blob, ".youtube.com"),
        )
        cookies = extract_cookies(
            "chrome", ["youtube.com"], platform="darwin",
            keyring_reader=lambda _s: b"secret", base_override=base,
        )
        self.assertEqual(len(cookies), 1)
        self.assertEqual(cookies[0]["value"], "logged-in")
        self.assertEqual(cookies[0]["name"], "SID")

    def test_firefox_extract_unencrypted(self) -> None:
        base = self._base_with_db(
            "Firefox/Profiles/abc.default/cookies.sqlite",
            lambda p: _make_firefox_db(p, "auth", "plain-value", ".example.com"),
        )
        cookies = extract_cookies("firefox", ["example.com"], platform="darwin", base_override=base)
        self.assertEqual(len(cookies), 1)
        self.assertEqual(cookies[0]["value"], "plain-value")


class SecretHandling(unittest.TestCase):
    def test_cookie_output_file_is_owner_only(self) -> None:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        output = base / "cookies.json"

        write_cookie_file(output, [{"name": "SID", "value": "secret"}])

        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertIn("secret", output.read_text())

    def test_cookie_output_replaces_existing_file_only_after_private_temp_write(self) -> None:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        output = base / "cookies.json"
        output.write_text("old\n")
        output.chmod(0o644)

        def _dump(_cookies, f, indent: int) -> None:
            self.assertEqual(output.read_text(), "old\n")
            self.assertEqual(output.stat().st_mode & 0o777, 0o644)
            temp_files = list(base.glob(".cookies.json.*.tmp"))
            self.assertEqual(len(temp_files), 1)
            self.assertEqual(temp_files[0].stat().st_mode & 0o777, 0o600)
            f.write('[{"name": "SID", "value": "secret"}]')

        with patch("extract_cookies.json.dump", side_effect=_dump):
            write_cookie_file(output, [{"name": "SID", "value": "secret"}])

        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertIn("secret", output.read_text())

    def test_cookie_output_refuses_symlinks(self) -> None:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        target = base / "target.json"
        target.write_text("{}")
        link = base / "cookies.json"
        link.symlink_to(target)

        with self.assertRaises(ValueError):
            write_cookie_file(link, [{"name": "SID", "value": "secret"}])

    def test_cookie_output_refuses_dangling_symlinks(self) -> None:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        link = base / "cookies.json"
        link.symlink_to(base / "missing.json")

        with self.assertRaises(ValueError):
            write_cookie_file(link, [{"name": "SID", "value": "secret"}])

    def test_inject_cookies_sends_values_over_stdin_not_argv(self) -> None:
        cookie = {
            "name": "SID",
            "value": "secret-token",
            "domain": ".youtube.com",
            "path": "/",
            "expires": 9999999999,
            "secure": True,
            "httpOnly": True,
            "sameSite": "Lax",
        }

        with patch("extract_cookies.subprocess.run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = "1"
            run.return_value.stderr = ""

            inject_cookies([cookie], 9242)

        command = run.call_args.args[0]
        self.assertNotIn("secret-token", command)
        self.assertIn("secret-token", run.call_args.kwargs["input"])


class CookieFieldFixes(unittest.TestCase):
    """F9/F10/F11/F14: SameSite, inject-all, host-only domain, cookie-path order."""

    def _base_with_db(self, rel: str, make: Callable[[Path], None]) -> Path:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        db = base / rel
        db.parent.mkdir(parents=True)
        make(db)
        return base

    @staticmethod
    def _inject_payload(cookies: list) -> list:
        import json

        captured: dict = {}
        with patch("extract_cookies.subprocess.run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = str(len(cookies))
            run.return_value.stderr = ""
            inject_cookies(cookies, 9242)
            captured["input"] = run.call_args.kwargs["input"]
        return json.loads(captured["input"])

    def test_samesite_minus_one_is_lax_not_none(self) -> None:
        # F9: SameSite -1 must map to "Lax" for the export form, never "None".
        key = derive_key("darwin", b"secret")
        blob = _encrypt_cbc_v10(key, "logged-in")
        base = self._base_with_db(
            "Google/Chrome/Default/Cookies",
            lambda p: _make_chromium_db(p, "SID", blob, ".youtube.com", samesite=-1),
        )
        cookies = extract_cookies(
            "chrome", ["youtube.com"], platform="darwin",
            keyring_reader=lambda _s: b"secret", base_override=base,
        )
        self.assertEqual(len(cookies), 1)
        self.assertEqual(cookies[0]["sameSite"], "Lax")
        self.assertNotEqual(cookies[0]["sameSite"], "None")

    def test_inject_includes_non_important_cookies(self) -> None:
        # F10: ALL cookies are injected, not only IMPORTANT-flagged ones.
        cookies = [
            {"name": "SID", "value": "v1", "domain": ".youtube.com", "path": "/",
             "secure": True, "httpOnly": True, "sameSite": "Lax"},
            {"name": "csrf_token", "value": "v2", "domain": ".youtube.com", "path": "/",
             "secure": True, "httpOnly": False, "sameSite": "Lax"},
        ]
        payload = self._inject_payload(cookies)
        names = {c["name"] for c in payload}
        self.assertIn("csrf_token", names)
        self.assertEqual(len(payload), 2)

    def test_host_only_cookie_omits_domain(self) -> None:
        # F11: host-only cookies (no leading dot) omit the domain attribute.
        cookies = [
            {"name": "host_only", "value": "v", "domain": "example.com", "path": "/",
             "secure": True, "httpOnly": False, "sameSite": "Lax"},
            {"name": "wide", "value": "v", "domain": ".example.com", "path": "/",
             "secure": True, "httpOnly": False, "sameSite": "Lax"},
        ]
        payload = self._inject_payload(cookies)
        by_name = {c["name"]: c for c in payload}
        self.assertNotIn("domain", by_name["host_only"])
        self.assertEqual(by_name["wide"]["domain"], ".example.com")

    def test_prefers_network_cookies_over_legacy(self) -> None:
        # F14: prefer Network/Cookies over the legacy Cookies path when both exist.
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        legacy = base / "Google/Chrome/Default/Cookies"
        network = base / "Google/Chrome/Default/Network/Cookies"
        legacy.parent.mkdir(parents=True)
        network.parent.mkdir(parents=True)
        legacy.write_bytes(b"")
        network.write_bytes(b"")
        self.assertEqual(resolve_cookie_db("chrome", "darwin", base_override=base), network)


class CdpTargetSelection(unittest.TestCase):
    """F#4: Network.setCookie must target a page, not the browser target.

    The injection JS runs in a node subprocess against a live CDP endpoint, so
    it cannot be exercised without a browser. These checks pin the structural
    contract that fixes the bug: pick a page target from /json/list rather than
    the browser target from /json/version, and fail loudly if none exists.
    """

    def _script(self) -> str:
        from extract_cookies import _CDP_SET_COOKIES_SCRIPT

        return _CDP_SET_COOKIES_SCRIPT

    def test_connects_via_page_target_list_not_browser_version(self) -> None:
        script = self._script()
        self.assertIn("/json/list", script)
        self.assertNotIn("/json/version", script)

    def test_selects_page_type_target(self) -> None:
        self.assertIn('"page"', self._script())

    def test_errors_when_no_page_target(self) -> None:
        self.assertIn("no page target", self._script().lower())

    def test_still_uses_network_setcookie_payload(self) -> None:
        # Keep the existing payload shape (no Storage.setCookies rewrite).
        self.assertIn("Network.setCookie", self._script())


class KeyringFallback(unittest.TestCase):
    """F#7: an empty keyring secret must be detected, never used silently."""

    def _base_with_db(self, rel: str, make: Callable[[Path], None]) -> Path:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        db = base / rel
        db.parent.mkdir(parents=True)
        make(db)
        return base

    def test_linux_empty_keyring_falls_back_to_peanuts(self) -> None:
        # Chromium on a keyring-less Linux host encrypts with the default
        # password "peanuts"; an empty secret must derive that same key, not garbage.
        key = derive_key("linux", b"peanuts")
        blob = _encrypt_cbc_v10(key, "logged-in")
        base = self._base_with_db(
            "google-chrome/Default/Network/Cookies",
            lambda p: _make_chromium_db(p, "SID", blob, ".youtube.com"),
        )
        cookies = extract_cookies(
            "chrome", ["youtube.com"], platform="linux",
            keyring_reader=lambda _s: b"", base_override=base,
        )
        self.assertEqual(len(cookies), 1)
        self.assertEqual(cookies[0]["value"], "logged-in")

    def test_darwin_empty_keyring_raises(self) -> None:
        # macOS has no defined empty-keyring fallback: an empty secret is
        # unrecoverable and must raise, not silently mis-decrypt.
        base = self._base_with_db(
            "Google/Chrome/Default/Cookies",
            lambda p: _make_chromium_db(p, "SID", b"v10garbage", ".youtube.com"),
        )
        with self.assertRaises(RuntimeError):
            extract_cookies(
                "chrome", ["youtube.com"], platform="darwin",
                keyring_reader=lambda _s: b"", base_override=base,
            )


class InjectionResultHandling(unittest.TestCase):
    """F#5: total rejection must fail loudly, never proceed unauthenticated."""

    @staticmethod
    def _run_inject(cookies: list, stdout: str) -> None:
        with patch("extract_cookies.subprocess.run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = stdout
            run.return_value.stderr = ""
            inject_cookies(cookies, 9242)

    def test_inject_raises_when_all_cookies_rejected(self) -> None:
        # ok=0 with non-empty cookies means the browser rejected every cookie;
        # proceeding would run the session unauthenticated.
        cookie = {"name": "SID", "value": "v", "domain": ".youtube.com", "path": "/",
                  "secure": True, "httpOnly": True, "sameSite": "Lax"}
        with self.assertRaises(RuntimeError):
            self._run_inject([cookie], "0")

    def test_inject_empty_cookie_list_is_noop_not_error(self) -> None:
        # Nothing to inject is a no-op, not a rejection: 0/0 must not raise.
        self._run_inject([], "0")

    def test_inject_partial_success_does_not_raise(self) -> None:
        cookies = [
            {"name": "a", "value": "1", "domain": ".x.com", "path": "/",
             "secure": True, "httpOnly": True, "sameSite": "Lax"},
            {"name": "b", "value": "2", "domain": ".x.com", "path": "/",
             "secure": True, "httpOnly": True, "sameSite": "Lax"},
        ]
        self._run_inject(cookies, "1")


if __name__ == "__main__":
    unittest.main(verbosity=2)

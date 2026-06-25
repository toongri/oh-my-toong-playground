from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.curl_probe import _curl_probe  # noqa: E402


class _Headers(dict):
    """Case-insensitive header mapping, mirroring curl_cffi's Headers."""

    def __init__(self, data: dict) -> None:
        super().__init__({k.lower(): v for k, v in data.items()})

    def get(self, key, default=None):  # type: ignore[override]
        return super().get(key.lower(), default)


class _Resp:
    def __init__(self, status_code: int, *, location: str | None = None,
                 url: str = "https://example.com/", text: str = "<html>ok</html>") -> None:
        self.status_code = status_code
        self.text = text
        self.url = url
        self.headers = _Headers({"Location": location} if location else {})


class _FakeRequestException(Exception):
    pass


class _FakeExceptions:
    RequestException = _FakeRequestException


def _fake_requests(responses):
    """Build a fake curl_cffi.requests whose .get() yields queued responses
    and records every URL it was actually asked to fetch."""
    calls: list[str] = []

    class _Reqs:
        exceptions = _FakeExceptions

        @staticmethod
        def get(url, **kwargs):  # noqa: ARG004
            calls.append(url)
            return responses.pop(0)

    return _Reqs, calls


class CurlProbeRedirectGuard(unittest.TestCase):
    def test_redirect_to_private_or_metadata_blocked(self) -> None:
        """A redirect aimed at cloud-metadata / loopback must be refused
        WITHOUT the probe ever issuing a fetch at the internal target."""
        for target in ("http://169.254.169.254/latest/meta-data/", "http://127.0.0.1/admin"):
            with self.subTest(target=target):
                reqs, calls = _fake_requests([
                    _Resp(302, location=target, url="https://attacker.example/"),
                ])
                with patch.dict("sys.modules", {"curl_cffi": type(sys)("curl_cffi")}):
                    sys.modules["curl_cffi"].requests = reqs  # type: ignore[attr-defined]
                    resp, err = _curl_probe(
                        "https://attacker.example/", impersonate="chrome", referer="",
                    )

                self.assertIsNone(resp, "blocked redirect must not return a response")
                self.assertIsNotNone(err, "blocked redirect must return an error string")
                self.assertEqual(
                    calls, ["https://attacker.example/"],
                    "the internal/metadata target must never be fetched",
                )

    def test_public_redirect_is_followed(self) -> None:
        """A redirect to a public host is followed (no over-block)."""
        final = _Resp(200, url="http://93.184.216.34/landing", text="<html>landed</html>")
        reqs, calls = _fake_requests([
            _Resp(302, location="http://93.184.216.34/landing", url="https://example.com/"),
            final,
        ])
        with patch.dict("sys.modules", {"curl_cffi": type(sys)("curl_cffi")}):
            sys.modules["curl_cffi"].requests = reqs  # type: ignore[attr-defined]
            resp, err = _curl_probe(
                "https://example.com/", impersonate="chrome", referer="",
            )

        self.assertIsNone(err)
        self.assertIs(resp, final, "public redirect target should be fetched and returned")
        self.assertEqual(calls, ["https://example.com/", "http://93.184.216.34/landing"])


if __name__ == "__main__":
    unittest.main()

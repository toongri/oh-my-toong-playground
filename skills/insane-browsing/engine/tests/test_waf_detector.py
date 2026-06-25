"""Regression tests for waf_detector — F22: server_contains case-insensitive match.

The defect: `server_contains` lowercases only the needle (`needle.lower() in server`)
but not the header value, so `Server: CloudFlare` (mixed-case) misses the lowercase
needle `cloudflare`.  Fix: lowercase both sides.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.waf_detector import _score_profile  # noqa: E402


class _Resp:
    """Minimal response stub for waf_detector tests."""

    def __init__(self, server: str = "", text: str = "") -> None:
        # _headers_dict lowercases header KEYS; the VALUE is passed through as-is.
        self.headers = {"Server": server}
        self.text = text
        self.cookies = type("C", (), {"jar": []})()


class WafDetectorServerContains(unittest.TestCase):
    # Minimal profile that fires only on server_contains.
    _PROFILE = {
        "detectors": {"server_contains": ["cloudflare"]},
        "confidence_rules": {"strong": 1, "weak": 1},
    }

    def test_server_contains_case_insensitive(self) -> None:
        """Mixed-case Server header must match a lowercase needle (F22 regression)."""
        resp = _Resp(server="CloudFlare")
        hit = _score_profile("cloudflare_waf", self._PROFILE, resp)
        self.assertIsNotNone(hit, "Expected a DetectionHit for 'CloudFlare' vs needle 'cloudflare'")
        self.assertIn("server:cloudflare", hit.signals)

    def test_server_contains_lowercase_regression(self) -> None:
        """Already-lowercase Server header must still match after the fix."""
        resp = _Resp(server="cloudflare")
        hit = _score_profile("cloudflare_waf", self._PROFILE, resp)
        self.assertIsNotNone(hit, "Expected a DetectionHit for 'cloudflare' vs needle 'cloudflare'")
        self.assertIn("server:cloudflare", hit.signals)


if __name__ == "__main__":
    unittest.main()

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

from engine.waf_detector import _load_profiles, _score_profile  # noqa: E402


class _Resp:
    """Minimal response stub for waf_detector tests."""

    def __init__(self, server: str = "", text: str = "") -> None:
        # _headers_dict lowercases header KEYS; the VALUE is passed through as-is.
        self.headers = {"Server": server}
        self.text = text
        self.cookies = type("C", (), {"jar": []})()


class _RespWithHeaders:
    """Response stub supporting arbitrary headers and named-cookie jar entries."""

    def __init__(
        self,
        headers: dict | None = None,
        cookie_jar: list | None = None,
        text: str = "",
    ) -> None:
        self.headers = headers or {}
        self.text = text
        _Cookie = type("_Cookie", (), {})
        jar = []
        for name, value in (cookie_jar or []):
            c = _Cookie()
            c.name = name
            c.value = value
            jar.append(c)
        self.cookies = type("_Jar", (), {"jar": jar})()


# Loaded once at import time; reflects the live waf_profiles.yaml on disk.
_LIVE_PROFILES = _load_profiles()


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


class AwsWafHeaderDetectorTest(unittest.TestCase):
    """aws_waf detector must fire only on WAF-specific signals (code-review finding #10).

    x-amzn-requestid and x-amzn-errortype appear on every API Gateway / Lambda
    response, so they are general infrastructure headers — not WAF evidence.
    Only x-amzn-waf-* and the aws-waf-token cookie are WAF-vendor artifacts.
    """

    _PROFILE = _LIVE_PROFILES.get("aws_waf", {})

    def test_amzn_requestid_alone_does_not_classify_as_aws_waf(self) -> None:
        """x-amzn-requestid is a general API Gateway/Lambda header and must not classify a response as aws_waf."""
        resp = _RespWithHeaders(headers={"x-amzn-requestid": "abc-123"})
        hit = _score_profile("aws_waf", self._PROFILE, resp)
        self.assertIsNone(
            hit,
            "x-amzn-requestid alone must NOT produce an aws_waf hit — it is a general infra header",
        )

    def test_aws_waf_token_cookie_detected(self) -> None:
        """aws-waf-token cookie is a WAF-specific signal and must still be detected."""
        resp = _RespWithHeaders(cookie_jar=[("aws-waf-token", "some-token")])
        hit = _score_profile("aws_waf", self._PROFILE, resp)
        self.assertIsNotNone(hit, "aws-waf-token cookie must produce an aws_waf hit")
        self.assertIn("cookie:aws-waf-token", hit.signals)

    def test_amzn_waf_wildcard_header_detected(self) -> None:
        """x-amzn-waf-* header is a WAF-specific signal and must still be detected."""
        resp = _RespWithHeaders(headers={"x-amzn-waf-action": "block"})
        hit = _score_profile("aws_waf", self._PROFILE, resp)
        self.assertIsNotNone(hit, "x-amzn-waf-* header must produce an aws_waf hit")
        self.assertIn("header:x-amzn-waf-*", hit.signals)


if __name__ == "__main__":
    unittest.main()

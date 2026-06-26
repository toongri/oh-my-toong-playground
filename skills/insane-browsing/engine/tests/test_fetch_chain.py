from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.fetch_chain import fetch  # noqa: E402
from engine.result_schema import Attempt  # noqa: E402
from engine.validators import Verdict  # noqa: E402


class _Resp:
    def __init__(self, text: str = "<article>ok</article>", url: str = "https://example.com/"):
        self.text = text
        self.url = url


class _Hit:
    profile_id = "cloudflare_turnstile"
    confidence = 1.0
    signals = ["test"]


class FetchChain(unittest.TestCase):
    def test_probe_success_returns_without_grid(self) -> None:
        attempt = Attempt(
            phase="probe",
            executor="curl_cffi",
            url="https://example.com",
            url_transform="original",
            impersonate="safari",
            referer="self_root",
            verdict=Verdict.WEAK_OK.value,
        )

        with patch("engine.fetch_chain._load_profiles", return_value={}), \
                patch("engine.fetch_chain.last_load_error", return_value=None), \
                patch("engine.fetch_chain.run_attempt", return_value=(attempt, _Resp())) as run_attempt:
            result = fetch("https://example.com", enable_playwright=False)

        self.assertTrue(result.ok)
        self.assertEqual(result.verdict, Verdict.WEAK_OK.value)
        self.assertEqual(len(result.trace), 1)
        self.assertEqual(run_attempt.call_count, 1)

    def test_max_attempts_stops_after_probe_before_grid(self) -> None:
        attempt = Attempt(
            phase="probe",
            executor="curl_cffi",
            url="https://example.com",
            url_transform="original",
            impersonate="safari",
            referer="self_root",
            verdict=Verdict.CHALLENGE.value,
        )

        with patch("engine.fetch_chain._load_profiles", return_value={}), \
                patch("engine.fetch_chain.last_load_error", return_value=None), \
                patch("engine.fetch_chain.run_attempt", return_value=(attempt, _Resp("blocked"))), \
                patch("engine.fetch_chain.detect", return_value=[_Hit()]), \
                patch("engine.fetch_chain.load_profile", return_value={
                    "tls_impersonate_candidates": [["chrome"]],
                    "referer_strategies": ["self_root"],
                    "url_transform_order": ["original"],
                }):
            result = fetch("https://example.com", max_attempts=1, enable_playwright=False)

        self.assertFalse(result.ok)
        self.assertEqual(len(result.trace), 1)
        self.assertEqual(result.trace[0].phase, "probe")

    def test_timeout_forwarded_to_playwright(self) -> None:
        """F20: the caller's timeout must reach the Playwright fallback so the
        fallback cannot hang past the caller's budget."""
        probe = Attempt(
            phase="probe",
            executor="curl_cffi",
            url="https://example.com",
            url_transform="original",
            impersonate="safari",
            referer="self_root",
            verdict=Verdict.CHALLENGE.value,
        )
        pw_attempt = Attempt(
            phase="fallback",
            executor="playwright_real_chrome",
            url="https://example.com/landed",
            url_transform="original",
            impersonate=None,
            referer="",
            verdict=Verdict.STRONG_OK.value,
        )
        fallback = MagicMock(return_value=(pw_attempt, "<article>ok</article>"))

        with patch("engine.fetch_chain._load_profiles", return_value={}), \
                patch("engine.fetch_chain.last_load_error", return_value=None), \
                patch("engine.fetch_chain.run_attempt", return_value=(probe, _Resp("blocked"))), \
                patch("engine.fetch_chain.detect", return_value=[_Hit()]), \
                patch("engine.fetch_chain.load_profile", return_value={
                    "fallback_when_challenge": ["playwright_real_chrome"],
                }), \
                patch("engine.executor.run_playwright_fallback", fallback):
            fetch("https://example.com", timeout=7, max_attempts=1)

        self.assertEqual(fallback.call_count, 1)
        self.assertEqual(fallback.call_args.kwargs.get("timeout"), 7)

    def test_final_url_is_post_redirect(self) -> None:
        """F21 (end-to-end): the result's final_url is the post-redirect URL that
        the Playwright fallback envelope provided onto pw_attempt.url (sourced by
        executor.py per TODO 13), not the requested URL."""
        requested = "https://example.com"
        landed = "https://example.com/after-redirect"
        probe = Attempt(
            phase="probe",
            executor="curl_cffi",
            url=requested,
            url_transform="original",
            impersonate="safari",
            referer="self_root",
            verdict=Verdict.CHALLENGE.value,
        )
        pw_attempt = Attempt(
            phase="fallback",
            executor="playwright_real_chrome",
            url=landed,  # executor.py sets att.url from the envelope's final_url
            url_transform="original",
            impersonate=None,
            referer="",
            verdict=Verdict.STRONG_OK.value,
        )
        fallback = MagicMock(return_value=(pw_attempt, "<article>ok</article>"))

        with patch("engine.fetch_chain._load_profiles", return_value={}), \
                patch("engine.fetch_chain.last_load_error", return_value=None), \
                patch("engine.fetch_chain.run_attempt", return_value=(probe, _Resp("blocked"))), \
                patch("engine.fetch_chain.detect", return_value=[_Hit()]), \
                patch("engine.fetch_chain.load_profile", return_value={
                    "fallback_when_challenge": ["playwright_real_chrome"],
                }), \
                patch("engine.executor.run_playwright_fallback", fallback):
            result = fetch(requested, timeout=7, max_attempts=1)

        self.assertTrue(result.ok)
        self.assertEqual(result.final_url, landed)
        self.assertNotEqual(result.final_url, requested)


if __name__ == "__main__":
    unittest.main()

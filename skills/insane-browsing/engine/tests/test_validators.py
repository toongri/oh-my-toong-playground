from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.validators import SMALL_BODY_THRESHOLD, validate  # noqa: E402


class _Resp:
    """Minimal response stand-in.

    `cookies` is a plain dict so validators._extract_cookies hits its
    `dict(resp.cookies)` fallback (no `.jar` attribute).
    """

    def __init__(self, *, text: str, status_code: int = 200, cookies: dict | None = None):
        self.text = text
        self.status_code = status_code
        self.cookies = cookies or {}


class Validators(unittest.TestCase):
    def test_abck_unresolved_no_selectors_not_ok(self) -> None:
        # No success_selectors → the no-selectors fall-through path is exercised.
        # Body >= SMALL_BODY_THRESHOLD so the tiny-body CHALLENGE branch is skipped
        # and execution reaches the cookie-sensor fall-through.
        body = "x" * (SMALL_BODY_THRESHOLD + 10)
        resp = _Resp(text=body, cookies={"_abck": "abc~-1~xyz"})

        result = validate(resp)

        self.assertFalse(result.ok)
        self.assertIn("abck_unresolved", result.reasons)

    def test_body_size_measured_in_bytes(self) -> None:
        # A CJK body whose char-count < threshold but whose UTF-8 byte-count
        # >= threshold. If size is measured in characters it falls under the
        # threshold → tiny_body CHALLENGE; measured in bytes it is over the
        # threshold → the byte branch (weak_ok, body_size in bytes).
        char_count = SMALL_BODY_THRESHOLD - 1  # below threshold by chars
        body = "가" * char_count  # each char = 3 UTF-8 bytes
        self.assertLess(len(body), SMALL_BODY_THRESHOLD)
        self.assertGreaterEqual(len(body.encode("utf-8")), SMALL_BODY_THRESHOLD)

        resp = _Resp(text=body)
        result = validate(resp)

        self.assertEqual(result.body_size, len(body.encode("utf-8")))
        self.assertNotIn(f"tiny_body:{len(body)}", result.reasons)


if __name__ == "__main__":
    unittest.main()

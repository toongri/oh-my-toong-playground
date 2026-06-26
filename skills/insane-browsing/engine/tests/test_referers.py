from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.referers import REFERER_STRATEGIES  # noqa: E402


class RefererStripsUserinfo(unittest.TestCase):
    """F16: _self_root must not leak user:pass@ into the Referer header."""

    def test_referer_strips_userinfo(self) -> None:
        """A URL with basic-auth credentials must not expose them in the Referer."""
        self_root = REFERER_STRATEGIES["self_root"]
        referer = self_root("https://user:pass@example.com/page")
        self.assertNotIn("user", referer, "Referer must not contain username")
        self.assertNotIn("pass", referer, "Referer must not contain password")
        self.assertNotIn("@", referer, "Referer must not contain userinfo separator")
        self.assertTrue(
            referer.startswith("https://example.com"),
            f"Referer should start with https://example.com, got: {referer!r}",
        )

    def test_referer_plain_url_unchanged(self) -> None:
        """A plain URL without userinfo must produce the same Referer as before."""
        self_root = REFERER_STRATEGIES["self_root"]
        referer = self_root("https://example.com/some/path")
        self.assertEqual(referer, "https://example.com/")

    def test_referer_plain_url_with_port_preserves_port(self) -> None:
        """A plain URL with a non-standard port should preserve it in the Referer."""
        self_root = REFERER_STRATEGIES["self_root"]
        referer = self_root("https://example.com:8080/page")
        self.assertEqual(referer, "https://example.com:8080/")

    def test_referer_userinfo_url_with_port_strips_userinfo_preserves_port(self) -> None:
        """Userinfo is stripped but the port is preserved."""
        self_root = REFERER_STRATEGIES["self_root"]
        referer = self_root("https://user:pass@example.com:8080/page")
        self.assertNotIn("user", referer)
        self.assertNotIn("pass", referer)
        self.assertNotIn("@", referer)
        self.assertEqual(referer, "https://example.com:8080/")


if __name__ == "__main__":
    unittest.main()

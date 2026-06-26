from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine import executor  # noqa: E402
from engine.validators import Verdict  # noqa: E402

# Literal public IP (not a hostname) so the executor's final_url SSRF re-check
# classifies it with no live DNS — matching the curl_probe tests' convention.
REQUESTED_URL = "https://93.184.216.34/article"


def _envelope(status: int, final_url: str, html: str) -> str:
    return json.dumps({"status": status, "final_url": final_url, "html": html})


def _run_with_envelope(env_stdout: str):
    """Drive run_playwright_fallback with a stubbed node subprocess.

    Patches the profile load + chrome-channel probe so the local-template
    branch is taken, and replaces the node subprocess with one that emits the
    given envelope on stdout (rc=0).
    """
    with patch.object(executor, "load_profile", return_value={"capabilities_needed": ["needs_real_tls_stack"]}), \
            patch.object(executor, "_chrome_channel_available", return_value=True), \
            patch.object(executor, "_run_node_template", return_value=(0, env_stdout, "")):
        return executor.run_playwright_fallback(
            REQUESTED_URL,
            profile_id="unknown_challenge",
            force_executor="playwright_real_chrome",
        )


class ExecutorEnvelope(unittest.TestCase):
    def test_real_http_status_not_faked_200(self) -> None:
        env = _envelope(403, REQUESTED_URL, "<html><body>forbidden</body></html>")
        att, _content = _run_with_envelope(env)

        self.assertEqual(att.status, 403)
        self.assertNotIn(att.verdict, (Verdict.STRONG_OK.value, Verdict.WEAK_OK.value))

    def test_attempt_final_url_from_envelope(self) -> None:
        final_url = "https://93.184.216.34/final-after-redirect"
        env = _envelope(200, final_url, "<html><article>ok</article></html>")
        att, _content = _run_with_envelope(env)

        self.assertEqual(att.url, final_url)


if __name__ == "__main__":
    unittest.main()

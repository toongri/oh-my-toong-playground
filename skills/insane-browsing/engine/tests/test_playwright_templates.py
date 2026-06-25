from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine import executor  # noqa: E402
from engine.validators import Verdict  # noqa: E402

TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates"
TEMPLATE_NAMES = ("playwright_real_chrome.js", "playwright_mobile_chrome.js")
JsonValue = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]


def _write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")


def _envelope_html(stdout: str) -> str:
    """stdout now carries a JSON envelope {status, final_url, html}."""
    return json.loads(stdout)["html"]


def _install_fake_playwright(node_modules: Path) -> None:
    _write_file(
        node_modules / "playwright" / "index.js",
        """
        let routeHandler = null;

        // When PW_FAKE_DRIVE_ROUTE=1, goto() exercises the registered route
        // interceptor with the navigation URL: abort() makes goto reject (as a
        // real blocked navigation would); leaving a request unhandled would
        // stall in real Playwright, so flag it.
        async function simulateRequest(url) {
          if (process.env.PW_FAKE_DRIVE_ROUTE !== '1' || !routeHandler) return;
          let aborted = false;
          let handled = false;
          const route = {
            request() { return { url() { return url; } }; },
            async abort() { aborted = true; handled = true; },
            async continue() { handled = true; },
            async fallback() { handled = true; },
          };
          await routeHandler(route);
          if (!handled) throw new Error('route left unhandled — request would stall');
          if (aborted) throw new Error('net::ERR_BLOCKED_BY_CLIENT');
        }

        const page = {
          async goto(url) {
            await simulateRequest(url);
            return { status() { return 200; } };
          },
          url() { return 'https://example.com/article'; },
          async waitForTimeout() {},
          async waitForSelector(selector) {
            if (process.env.PW_FAKE_SELECTOR_FAIL === '1') {
              throw new Error(`missing selector ${selector}`);
            }
          },
          async reload() {},
          async content() {
            return '<html><article>ok</article></html>';
          },
        };

        const context = {
          async route(pattern, handler) { routeHandler = handler; },
          async newPage() { return page; },
          async close() {
            if (process.env.PW_FAKE_CLOSE_FAIL === '1') {
              throw new Error('close failed');
            }
          },
        };

        exports.chromium = {
          use() {},
          async launchPersistentContext() { return context; },
        };
        exports.devices = {
          'iPhone 13 Pro': { viewport: { width: 390, height: 844 }, userAgent: 'fake-mobile' },
        };
        """,
    )


def _install_broken_playwright_extra(node_modules: Path) -> None:
    _write_file(
        node_modules / "playwright-extra" / "index.js",
        """
        const error = new Error('stealth init failed');
        error.code = 'EACCES';
        throw error;
        """,
    )
    _write_file(
        node_modules / "puppeteer-extra-plugin-stealth" / "index.js",
        """
        module.exports = function stealth() { return {}; };
        """,
    )


def _install_working_playwright_extra(node_modules: Path) -> None:
    _write_file(
        node_modules / "playwright-extra" / "index.js",
        """
        const playwright = require('playwright');
        exports.chromium = playwright.chromium;
        exports.devices = playwright.devices;
        """,
    )


def _install_playwright_extra_with_internal_missing_dependency(node_modules: Path) -> None:
    _write_file(
        node_modules / "playwright-extra" / "index.js",
        """
        require('transitive-stealth-runtime');
        """,
    )


def _install_self_missing_optional_module(node_modules: Path, module_name: str) -> None:
    _write_file(
        node_modules / module_name / "index.js",
        f"""
        const error = new Error("Cannot find module '{module_name}'");
        error.code = 'MODULE_NOT_FOUND';
        throw error;
        """,
    )


def _run_template(
    template_name: str,
    payload: dict[str, JsonValue],
    *,
    include_broken_extra: bool = False,
    include_working_extra: bool = False,
    include_internal_missing_extra: bool = False,
    include_self_missing_module: str | None = None,
    env_overrides: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory(prefix="insane-browsing-template-test-") as tmp:
        tmp_path = Path(tmp)
        node_modules = tmp_path / "node_modules"
        _install_fake_playwright(node_modules)
        if include_working_extra:
            _install_working_playwright_extra(node_modules)
        if include_broken_extra:
            _install_broken_playwright_extra(node_modules)
        if include_internal_missing_extra:
            _install_playwright_extra_with_internal_missing_dependency(node_modules)
        if include_self_missing_module:
            _install_self_missing_optional_module(node_modules, include_self_missing_module)

        script_path = tmp_path / template_name
        script_path.write_text((TEMPLATES_DIR / template_name).read_text(encoding="utf-8"), encoding="utf-8")

        env = os.environ.copy()
        env.pop("NODE_PATH", None)
        if env_overrides:
            env.update(env_overrides)

        return subprocess.run(
            ["node", str(script_path)],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            timeout=5,
            env=env,
            check=False,
        )


@unittest.skipUnless(shutil.which("node"), "node is required for Playwright template tests")
class PlaywrightTemplateErrorHandling(unittest.TestCase):
    def test_missing_playwright_extra_warns_and_falls_back_to_plain_playwright(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "https://example.com/article",
                        "profileDir": "/tmp/insane-browsing-test-profile",
                        "headless": True,
                    },
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("<article>ok</article>", _envelope_html(result.stdout))
                self.assertIn("best-effort optional module playwright-extra failed:", result.stderr)
                self.assertIn("Cannot find module 'playwright-extra'", result.stderr)

    def test_missing_stealth_plugin_warns_and_falls_back_to_plain_playwright(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "https://example.com/article",
                        "profileDir": "/tmp/insane-browsing-test-profile",
                        "headless": True,
                    },
                    include_working_extra=True,
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("<article>ok</article>", _envelope_html(result.stdout))
                self.assertIn("best-effort optional module puppeteer-extra-plugin-stealth failed:", result.stderr)
                self.assertIn("Cannot find module 'puppeteer-extra-plugin-stealth'", result.stderr)

    def test_non_missing_stealth_dependency_error_is_not_swallowed(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "https://example.com/article",
                        "profileDir": "/tmp/insane-browsing-test-profile",
                        "headless": True,
                    },
                    include_broken_extra=True,
                )

                self.assertNotEqual(result.returncode, 0)
                self.assertIn("stealth init failed", result.stderr)
                self.assertNotIn("best-effort optional module", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_internal_module_resolution_error_is_not_treated_as_optional_missing_dependency(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "https://example.com/article",
                        "profileDir": "/tmp/insane-browsing-test-profile",
                        "headless": True,
                    },
                    include_internal_missing_extra=True,
                )

                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Cannot find module 'transitive-stealth-runtime'", result.stderr)
                self.assertNotIn("best-effort optional module", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_present_optional_module_self_missing_error_is_not_swallowed(self) -> None:
        cases = (("playwright-extra", False), ("puppeteer-extra-plugin-stealth", True))
        for template_name in TEMPLATE_NAMES:
            for module_name, include_working_extra in cases:
                with self.subTest(template_name=template_name, module_name=module_name):
                    result = _run_template(
                        template_name,
                        {
                            "url": "https://example.com/article",
                            "profileDir": "/tmp/insane-browsing-test-profile",
                            "headless": True,
                        },
                        include_working_extra=include_working_extra,
                        include_self_missing_module=module_name,
                    )

                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(f"Cannot find module '{module_name}'", result.stderr)
                    self.assertNotIn("best-effort optional module", result.stderr)
                    self.assertEqual(result.stdout, "")

    def test_selector_failures_are_reported_as_best_effort_warnings(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "https://example.com/article",
                        "profileDir": "/tmp/insane-browsing-test-profile",
                        "headless": True,
                        "waitSelector": "article.ready",
                    },
                    env_overrides={"PW_FAKE_SELECTOR_FAIL": "1"},
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("<article>ok</article>", _envelope_html(result.stdout))
                self.assertIn("best-effort waitSelector failed:", result.stderr)
                self.assertNotIn("waitSelector article.ready", result.stderr)

    def test_context_close_failures_are_reported_after_successful_html_output(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "https://example.com/article",
                        "profileDir": "/tmp/insane-browsing-test-profile",
                        "headless": True,
                    },
                    env_overrides={"PW_FAKE_CLOSE_FAIL": "1"},
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("<article>ok</article>", _envelope_html(result.stdout))
                self.assertIn("best-effort browser context close failed:", result.stderr)


_INTERNAL_HOSTS = [
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "172.16.0.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "localhost",
    "",
]
_PUBLIC_HOSTS = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2001:4860:4860::8888"]


def _run_predicate_driver(template_name: str, hosts: list[str]) -> subprocess.CompletedProcess[str]:
    """Require a template as a module and classify each host via its exported
    isBlockedHost(). Literal IPs are classified without any network I/O."""
    with tempfile.TemporaryDirectory(prefix="insane-browsing-ssrf-pred-") as tmp:
        tmp_path = Path(tmp)
        script_path = tmp_path / template_name
        script_path.write_text(
            (TEMPLATES_DIR / template_name).read_text(encoding="utf-8"), encoding="utf-8"
        )
        driver = tmp_path / "driver.js"
        driver.write_text(
            "const t = require('./%s');\n"
            "(async () => {\n"
            "  const hosts = %s;\n"
            "  const out = {};\n"
            "  for (const h of hosts) { out[h] = await t.isBlockedHost(h); }\n"
            "  process.stdout.write(JSON.stringify(out));\n"
            "})().catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(3); });\n"
            % (template_name, json.dumps(hosts)),
            encoding="utf-8",
        )
        env = os.environ.copy()
        env.pop("NODE_PATH", None)
        return subprocess.run(
            ["node", str(driver)],
            cwd=str(tmp_path),
            capture_output=True,
            text=True,
            timeout=10,
            env=env,
            check=False,
        )


@unittest.skipUnless(shutil.which("node"), "node is required for Playwright template tests")
class PlaywrightSsrfInterceptor(unittest.TestCase):
    def test_is_blocked_host_classifies_internal_and_public(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                proc = _run_predicate_driver(template_name, _INTERNAL_HOSTS + _PUBLIC_HOSTS)
                self.assertEqual(proc.returncode, 0, proc.stderr)
                verdicts = json.loads(proc.stdout)
                for host in _INTERNAL_HOSTS:
                    self.assertTrue(verdicts[host], f"{host!r} must be blocked")
                for host in _PUBLIC_HOSTS:
                    self.assertFalse(verdicts[host], f"{host!r} must be allowed")

    def test_navigation_to_internal_host_is_aborted(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "http://169.254.169.254/latest/meta-data/",
                        "profileDir": "/tmp/insane-browsing-test-profile",
                        "headless": True,
                    },
                    env_overrides={"PW_FAKE_DRIVE_ROUTE": "1"},
                )

                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertIn("169.254.169.254", result.stderr)

    def test_navigation_to_public_host_is_allowed(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "http://93.184.216.34/",
                        "profileDir": "/tmp/insane-browsing-test-profile",
                        "headless": True,
                    },
                    env_overrides={"PW_FAKE_DRIVE_ROUTE": "1"},
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("<article>ok</article>", _envelope_html(result.stdout))


def _run_fallback_with_envelope(env_stdout: str):
    """Drive run_playwright_fallback with a stubbed node subprocess emitting the
    given envelope, so only the executor's final_url SSRF re-check is exercised."""
    with patch.object(
        executor, "load_profile", return_value={"capabilities_needed": ["needs_real_tls_stack"]}
    ), patch.object(executor, "_chrome_channel_available", return_value=True), patch.object(
        executor, "_run_node_template", return_value=(0, env_stdout, "")
    ):
        return executor.run_playwright_fallback(
            "https://example.com/article",
            profile_id="unknown_challenge",
            force_executor="playwright_real_chrome",
        )


class ExecutorFinalUrlSsrfGuard(unittest.TestCase):
    def test_internal_final_url_is_refused(self) -> None:
        env = json.dumps(
            {
                "status": 200,
                "final_url": "http://169.254.169.254/latest/meta-data/",
                "html": "<html><article>secret</article></html>",
            }
        )
        att, content = _run_fallback_with_envelope(env)

        self.assertEqual(content, "")
        self.assertIn("ssrf", (att.error or "").lower())
        self.assertNotIn(att.verdict, (Verdict.STRONG_OK.value, Verdict.WEAK_OK.value))

    def test_public_final_url_passes_through(self) -> None:
        env = json.dumps(
            {
                "status": 200,
                "final_url": "http://93.184.216.34/landing",
                "html": "<html><article>ok</article></html>",
            }
        )
        att, content = _run_fallback_with_envelope(env)

        self.assertIn("<article>ok</article>", content)
        self.assertEqual(att.url, "http://93.184.216.34/landing")


if __name__ == "__main__":
    unittest.main()

# Playwright — Local On-Demand Real Chrome

> The only browser fallback for JS rendering / JS challenge sites. **There is no
> resident browser session** — launch a local Chrome process on demand only when
> the WAF profile's `capabilities_needed` tags indicate the need, and terminate it immediately after receiving HTML.

## Why Local Real Chrome

| Runner | TLS Stack | Suitable WAFs | Limitations |
|--------|----------|----------|------|
| `engine/templates/playwright_real_chrome.js` (local Node + `channel:'chrome'`) | System-installed real Chrome | Covers basic Cloudflare, Akamai Bot Manager, PerimeterX, and hardened DataDome settings through one path | Requires system installations of Node + Chrome |

Automation based on bundled Chromium (BoringSSL) has a different TLS fingerprint
from real Chrome and is **immediately detected** by TLS-aware WAFs such as Akamai
Bot Manager (293-byte Access Denied or immediate 403). Launching the system-installed
Chrome binary with `channel:'chrome'` gives it the same TLS stack as real Chrome,
allowing the same path to pass sites ranging from weak JS challenges to hardened TLS-aware WAFs.

`engine/executor.py` automatically launches this path based on profile tags, so
callers outside the skill do not need to make this choice.

## Dependencies (One-Time Setup)

```bash
# Node (system installation)
node -v   # v18+ recommended

# Playwright + stealth plugin
npm i -g playwright playwright-extra puppeteer-extra-plugin-stealth

# System Chrome binary (not bundled Chromium)
npx playwright install chrome
```

## Invocation (Inside the Engine)

```python
from engine.executor import run_playwright_fallback

attempt, html = run_playwright_fallback(
    "https://example.com/path",
    profile_id="akamai_bot_manager",
    success_selectors=["article"],
    device_class="desktop",   # "desktop" | "mobile" | "auto"
)
```

Internally, Node runs `engine/templates/playwright_real_chrome.js` or `playwright_mobile_chrome.js` and returns HTML. Templates accept **only URL and selector parameters**, with no site-specific branching.

## Desktop Template (`playwright_real_chrome.js`)

```js
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',        // ← Key: real Chrome, not bundled Chromium
  headless: false,          // Akamai detects headless mode. Headful is required.
  viewport: { width: 1366, height: 900 },
});
```

## Mobile Template (`playwright_mobile_chrome.js`)

```js
const { chromium, devices } = require('playwright-extra');
const iPhone = devices['iPhone 13 Pro'];

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',          // TLS uses real Chrome
  ...iPhone,                  // Automatically inject UA/viewport/isMobile/hasTouch
  headless: false,
});
```

**Caution**: Combining `channel:'chrome'` + `devices[...]` keeps the Chrome TLS fingerprint while changing only the HTTP layer (UA/viewport) to mobile. WAFs often treat it more leniently because they recognize real Chrome.

## Selection Rules (Automatic)

The `capabilities_needed` tags in `engine/waf_profiles.yaml` determine the choice:

| Tag Combination | Selected Runner | Representative Case |
|----------|-------------|-------------|
| `needs_real_tls_stack` + `needs_js_exec` | `playwright_real_chrome.js` | Akamai Bot Manager |
| `needs_js_exec` only | `playwright_real_chrome.js` | JS challenges such as Cloudflare Turnstile |
| `needs_real_tls_stack` only | `playwright_real_chrome.js` | Some DataDome configurations |
| Neither | Handled by the curl chain. No Playwright | F5 BIG-IP (only TLS bypass needed) |

When `device_class="mobile"` is specified, swap real_chrome → the mobile variant.

## Shared Validation

Revalidate the final HTML with `engine/validators.py:validate()`. Even if Playwright returns HTML, **a challenge page or empty SPA still receives a CHALLENGE verdict**. This automatically leads to the next combination or a failure report.

## Debugging Tips

- Keeping `profileDir` at a fixed path preserves sessions/cookies for faster retries (`/tmp/.insane_pw_profile`)
- If Akamai retries are frequent, delete `profileDir` to reset to a fresh state
- On failure, the `error` field in `result.trace` includes 200 characters of Node stderr
- When HTML alone is insufficient, such as reconnaissance to discover internal API endpoints, switch to Tier 3 `agent-browser` (an interactive real Chrome session) — see [`../chrome-stealth.md`](../chrome-stealth.md)

## Site Examples (For Reader Understanding, Not Code Branching)

> This section is **explanatory** and is not reflected in `engine/**` code.

- **Basic Cloudflare challenge**: Local real Chrome is sufficient
- **Akamai Bot Manager**: Local real Chrome is required. Matching TLS and UA is key (bundled Chromium is immediately detected)
- **SSR blog platforms**: curl_cffi safari alone returns HTML. Playwright is unnecessary
- **SPAs with JS-rendered search results**: Load with local real Chrome, then parse HTML; switch manually to `agent-browser` if reconnaissance is needed

Profile tags determine actual routing. The examples above are for reference only; do not use them as the basis for code branching.

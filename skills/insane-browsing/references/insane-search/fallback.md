# When Access Fails — Adaptive Scheduler

> Run when the indexed method fails or the site is not in the index.
> Escalate in order: Phase 0 → 1 → 2 → 3. Stop immediately on success in any Phase.

## Principles

1. **Do not rule out any method in advance** — you must try it to know whether it works
2. **Install missing dependencies and try** — do not skip because they are not installed
3. **Transitions between Phases are signal-based** — escalate according to the failure type
4. **Result acceptance criteria**: accuracy/reliability > freshness > completeness > structure > cost

---

## Phase 0: Specialized Endpoints (Index Matching)

If the site is in the index, try its dedicated method **first**.
It takes priority over generic Phase 1 because it offers the best accuracy and cost.

Success → stop / failure → Phase 1

---

## Phase 1: Lightweight Probes (Parallel)

**Try first** (concurrently):
- WebFetch (built into Claude)
- Jina Reader (basic / JSON / SPA modes)
- curl Chrome Desktop UA

**If none have succeeded, also try**:
- curl mobile UA + mobile URL (`m.{domain}`)
- curl Googlebot UA
- Try URL variants: `.json`, `/rss`, `/feed`

**Sidecars** (concurrent with the initial attempts, low-trust):
- Google AMP cache
- archive.today
- Wayback Machine
→ **If any original source succeeds, use sidecars for reference only.** Accept sidecars only when all originals fail (provenance tagging required)

**Also extract metadata from every response**: OGP, JSON-LD — see [metadata.md](metadata.md)

Details: [jina.md](jina.md), [cache-archive.md](cache-archive.md), [rss.md](rss.md)

---

## Escalation Signals

Conditions for transitioning from Phase 1 → Phase 2:

| Signal | Detection Method | Meaning |
|------|-----------|------|
| HTTP 403/430 | Status code | WAF/bot blocking |
| HTTP 429/503 | Status code | Rate limit (try a short jittered retry first; escalate on failure) |
| WAF headers | `cf-ray`, `server: cloudflare`, `x-datadome` | Cloudflare/Akamai/DataDome |
| WAF cookies | `__cf_bm`, `_abck`, `datadome` | WAF session |
| Challenge body | `captcha`, `verify`, `enable javascript`, `check your browser` | JS challenge |
| Empty SPA | No content beyond `<div id="root"></div>`, fewer than 200 characters | JS rendering required |
| Redirect loop | 3 or more 302/307 responses | Challenge redirects |

**When login/paywall is detected**: a concentration of `login`, `sign in`, `로그인`, `subscribe`, `구독` → escalation to Phase 2/3 will not resolve it. **Stop with "인증 필요".**

---

## Phase 2: TLS Impersonation (curl_cffi)

**Condition**: WAF/bot blocking signals detected in Phase 1

**Ensure dependencies**:
```bash
python3 -c "import curl_cffi" 2>/dev/null || pip install curl_cffi -q
```
If installation fails → go immediately to Phase 3.

**Try multiple targets sequentially**: safari → chrome → firefox

```python
from curl_cffi import requests

TARGETS = ["safari", "chrome", "firefox"]
HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Referer": "https://www.google.com/",
}

for target in TARGETS:
    try:
        session = requests.Session(impersonate=target)
        session.headers.update(HEADERS)
        resp = session.get("{URL}", timeout=20)
        if resp.status_code == 200 and len(resp.text) > 300:
            # Success — also extract JSON-LD
            break
    except:
        continue
```

Success → stop / failure or JS challenge → Phase 3

Details: [tls-impersonate.md](tls-impersonate.md)

---

## Phase 3: Local Real Chrome (Browser)

**Condition**: Phase 2 also fails, or a JS challenge/CAPTCHA is detected

Launch local Chrome on demand only when needed, without a resident browser session:

```python
from engine.executor import run_playwright_fallback

attempt, html = run_playwright_fallback(
    "{URL}",
    profile_id="{감지된 WAF 프로파일}",
    success_selectors=["body"],
)
```

Internally, `engine/templates/playwright_real_chrome.js` loads the page with system-installed real Chrome (`channel:'chrome'` + stealth) and returns HTML.

**API discovery**: If you need to find hidden JSON API endpoints, switch to Tier 3 `agent-browser` (an interactive real Chrome session), inspect network requests, then reuse them with curl_cffi — see Tier 3 in [`SKILL.md`](../../SKILL.md).

Details: [playwright.md](playwright.md)

---

## Response Validation

| Verdict | Condition | Result |
|------|------|------|
| **Success** | Length appropriate for the content type + topic-related keywords | Accept |
| **Partial success** | Only OG metadata/JSON-LD (no body) | Supporting source |
| **Failure — authentication** | Login/paywall detected | Stop with "인증 필요" |
| **Failure — challenge** | CAPTCHA/JS challenge | Next Phase |
| **Failure — error** | 4xx/5xx | Next Phase |
| **Failure — empty SPA** | No content | Next Phase |

**Content length guidelines** (flexible):
- Articles/blogs: at least 500 characters
- Product pages: success if JSON-LD exists
- Tweets/short posts: at least 100 characters
- Profiles: success if JSON-LD Person exists

## False-Positive Markers (HTTP 200 but Failure)

| Pattern | Detection Method | Handling |
|------|----------|------|
| X SPA shell (247KB) | 200 OK + `Sign in to X` or `hasResults: false` | Failure — WebSearch+oEmbed fallback |
| CAPTCHA page | 200 OK + `captcha\|recaptcha\|hcaptcha\|cf-turnstile` | Failure — next Phase |
| Soft paywall | 200 OK + `member-only\|subscribe to read\|구독하세요` | Partial success — accept metadata only |
| DDG soft limit | 202 Accepted + body under 15KB | Failure — fall back to another engine |
| Empty JSON | 200 OK + `hasResults.*false\|"entries":\s*\[\]` | Failure — try another method |
| Regional block | 200 OK + `not available in your region\|geo-restricted` | Failure — notify "지역 차단" |
| WAF soft block | 200 OK + `checking your browser\|verify you are human` | Failure — escalate to Phase 2/3 |
| Akamai behavioral | 200 OK + `behavioral-content\|sec-if-cpt` + `_abck` cookie | Failure — JS execution required → go directly to Phase 3 (changing TLS targets is pointless) |
| RSS Content-Type error | RSS expected + `text/html` response | Failure — "RSS 미지원" |
| Error JSON | 200 OK + JSON `"error"` key present | Failure — log error details |

## When All Attempts Fail

1. Record the Phases attempted and each failure signal
2. If sidecar results exist, accept them with provenance tags
3. If no sidecars exist either, report failure to the user and share the attempt results

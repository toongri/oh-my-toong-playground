
# Insane Search

> Part of the **insane-browsing** skill (Tier 1). Routing and tier-escalation live in [../../SKILL.md](../../SKILL.md).
> The engine package it drives is at [../../engine/](../../engine/), invoked from the skill directory as `python3 -m engine "<URL>"`.
> Deep-dives in this folder: TLS impersonation, Playwright routing, fallback, metadata, Jina, cache/archive, RSS, JSON/public APIs, Twitter, Naver, media.


> Automatically select a **site-independent** bypass strategy when URL access is blocked.

## Harness Rules (Instructions Enforced on Claude)

These rules are **guardrails** to keep Claude from going off course with improvised decisions. Violating them reproduces mistakes like those in the previous test.md session: "break on chrome 200 → never try safari → give up because Playwright is not installed".

**R1 — When blocking/403/402 is detected for a general web URL**:
1. **Do not attempt** WebFetch, improvised curl, or manual header combinations
2. Immediately run:
   ```bash
   python3 -m engine "<URL>" [--selector "<CSS>"] [--device auto|desktop|mobile] [--trace]
   ```
3. Decide after receiving exit code 0(ok) or 1(fail). Read the trace first, then decide whether to retry.
4. Only on failure, rerun with `--trace --json` to diagnose the cause, then adjust `--device` or `user_hint`.

**R2 — Do not exit on the first 200**: HTTP 200 is **the condition for starting validation**, not success. Declare success only after passing the four-layer validation in `validate()`. The CLI already enforces this.

**R3 — No bias**: Do not hardcode specific site domains, selectors, or brand names in `engine/**` or `waf_profiles.yaml`. `python3 engine/bias_check.py` is the CI gate. See **No-Site-Name Rule** for detailed rules.

**R4 — Hints are runtime-only**: Pass site-specific information (success selectors, preferred Referer) only through CLI arguments or `user_hint`; do not persist it in the repository.

**R5 — Prioritize official APIs in Phase 0**: For platforms with **official public endpoints**, such as X/Reddit/YouTube/HN/arXiv, check the Phase 0 table first and use the corresponding API. This is an agreed access path, not bias.

**R6 — Declare failure only after exhaustive attempts**: Conclude "뚫을 수 없음" only after trying **every** combination in the grid (URL transformation × TLS impersonate × Referer × Playwright fallback). The CLI's default `max_attempts` of 12 guarantees this.
However, when the R7 condition (early WAF detection) holds, the engine grid continues running while Claude may try the `agent-browser` reconnaissance route **in parallel**. The faster result wins.

**R7 — Parallel API-first branch on early WAF detection** (the branch decision is automatic but visible to the user in the results — specify in result metadata which bypass path succeeded/failed):
Activation conditions (AND):
1. The first 2–3 attempts early in engine execution all have `verdict=challenge`
2. `profile_used` is identified as one of `akamai_bot_manager`, `cloudflare_turnstile`, `datadome_probable`, `perimeterx_human`, `f5_big_ip`, `aws_waf`
3. **The user request intends listing/collection/repetition** (multiple pages, at least N items, "전부", "크롤링", pagination, etc.). A single body lookup does not qualify.

When all three conditions are true, Claude starts a **parallel path**:

**Execution meaning of "parallel"** (clarified because Claude tool calls are sequential):
- Launch the engine in the Bash tool with `run_in_background=true` — the grid keeps running without blocking
- Meanwhile, Claude follows the Tier 3 `agent-browser` reconnaissance route in the foreground (an on-demand real Chrome session — not a resident browser)
- Either the engine or the API discovered through reconnaissance may succeed first. Accept the faster result

**Reconnaissance route** (`agent-browser`, see Tier 3 in [`SKILL.md`](../../SKILL.md)):
1. Open the target page with `agent-browser` and render it in a real Chrome session
2. Identify internal endpoints in network request logs using `/api/`, `/graphql`, and `\.json` filters
3. Call the identified JSON API URL with `python3 -m engine <API_URL>` (a separate invocation from the background engine). Most API layers have lighter WAF protection than page HTML and can be collected directly with curl_cffi
4. Understand the response schema, then combine pagination / query parameters for repeated collection

**Why**: SPA + WAF sites (including many shopping/commerce sites) often invest heavily in WAF protection only for marketing pages (HTML), leaving internal APIs with basic gateway-level defenses. **One reconnaissance pass (5–10 seconds) + an API call (0.5 seconds)** is far more economical and has a higher success rate than wasting exhaustive attempts on the HTML grid (50 × 0.5s + 40s Playwright fallback ≈ 65 seconds).

**When not to use R7**: The engine alone is sufficient for a single lookup that only needs one page's body (one document, one blog post) — activation condition #3 excludes it.

**R7 bias prevention**: Do not hardcode internal API URLs or parameters in `engine/**`. Use detected URLs only in runtime calls; do not persist them in the repository.

---

Core invariants of this skill:

- **Single entry point**: For general web pages, always use `python3 -m engine <URL>` or `from engine import fetch; fetch(...)`.
- **No bias**: Do not hardcode specific sites in `engine/**` or `waf_profiles.yaml`.
- **Runtime-only hints**: Pass site-specific information through the CLI/`user_hint`.

## Intent Classification (Before Entering Phase 0)

| User Input | Route |
|------------|------|
| URL provided (`https://...`) | → Check Phase 0, then Phase 1 (generic fetch chain) if absent |
| Handle provided (`@username`) | → Phase 0 syndication/API |
| Keywords only ("X에서 AI 검색") | → WebSearch(`site:{domain} {keyword}`) first → re-enter after obtaining URLs |

> **Limitation for new Korean content**: Keyword searches for Naver/Daum/Korean communities can only go through WebSearch, and indexing of new content may be delayed.

## Phase 0 — Official Platform API Index

> Include only dedicated APIs/CLIs **officially published** by the platform. This uses agreed endpoints and is not bias.

### Dedicated Social/Community APIs

| Platform | Method | Details |
|--------|------|------|
| X/Twitter | syndication (timeline) + oEmbed (individual tweets) + keyword search: WebSearch → oEmbed | [twitter.md](twitter.md) |
| Reddit | URL + `.json` + Mobile UA | [json-api.md](json-api.md) |
| Bluesky | AT Protocol (`public.api.bsky.app/xrpc/...`) | [public-api.md](public-api.md) |
| Mastodon | Public API per instance | [public-api.md](public-api.md) |
| Hacker News | Firebase API + Algolia Search | [json-api.md](json-api.md) |
| Stack Overflow | SE API v2.3 | [public-api.md](public-api.md) |
| Lobste.rs / V2EX / dev.to | Public JSON API | [json-api.md](json-api.md) |

### Media (CLI Tool Required)

| Platform | Method | Details |
|--------|------|------|
| 1,858 sites including YouTube/Vimeo/Twitch/TikTok/SoundCloud | `yt-dlp --dump-json` | [media.md](media.md) |

### Academic/Registries

| Platform | Method | Details |
|--------|------|------|
| arXiv | Atom API | [public-api.md](public-api.md) |
| CrossRef | REST API | [public-api.md](public-api.md) |
| Wikipedia | REST API | [json-api.md](json-api.md) |
| OpenLibrary | JSON API | [public-api.md](public-api.md) |
| GitHub | gh CLI / REST API | [public-api.md](public-api.md) |
| npm / PyPI | Registry API | [json-api.md](json-api.md) |
| Wayback Machine | CDX API | [public-api.md](public-api.md) |

### Official APIs for Korean Services

| Platform | Method | Details |
|--------|------|------|
| Naver Search | `search.naver.com` (integrated/blog/news tabs) | [naver.md](naver.md) |
| Naver Finance quotes | `api.finance.naver.com/siseJson.naver` (unofficial JSON) | [naver.md](naver.md) |

**Phase 1 (generic fetch chain) automatically handles all other sites.**

## Phase 1 — Generic Fetch Chain

### Single Entry Point

```python
from engine import fetch

result = fetch(
    "https://example.com/path",
    success_selectors=["article", "[class*='product-card']"],  # Positive proof (optional)
    device_class="auto",      # "auto" | "desktop" | "mobile"
    user_hint=None,           # {"referer_strategy": "self_root", "impersonate_first": "safari"}
    timeout=25,
)

if result.ok:
    print(result.verdict)     # strong_ok | weak_ok
    html = result.content
else:
    # Phase 3 fallback failed (local real Chrome) — diagnose via result.trace
    pass
```

### Internal Stages (Exposed for Debugging)

`fetch()` is a single API, but is internally divided into phases. Inspect each attempt in `result.trace`.

```
probe      — first attempt with curl_cffi + safari + self-referer
validate   — four-layer validation (marker / size / cookie / success_selectors)
detect     — detect WAF products ([(profile_id, confidence)] ranking)
plan       — build the profile's tls_candidates × url_transforms × referer grid
execute    — exhaustively try the grid (do not exit on the first 200)
fallback   — capability-tag-based local real Chrome routing (desktop or mobile)
report     — FetchResult(ok, verdict, profile_used, trace, summary)
```

### Validation Principles

- HTTP 200 is **the condition for starting validation**, not success.
- Success requires **all four layers (AND)**:
  1. No challenge markers (`sec-if-cpt-container`, `Access Denied`, `Just a moment...`, `DataDome`)
  2. No abnormal size (< 3KB or WAF fingerprint size)
  3. Normal cookie sensor state (not `_abck=~-1~`)
  4. At least one `success_selectors` match (caller provides selectors → `strong_ok`; none provided → `weak_ok`)

### Grid Axes (Profile Recommends Priority; Grid Is Exhaustive)

| Axis | Values | Notes |
|----|-----|------|
| `url_transforms` | `original`, `mobile_subdomain` (`www.→m.`), `am_prefix`, `drop_www` | No site names, only rules |
| `tls_impersonate` | `safari`, `safari_ios`, `chrome99`, `chrome119`, `chrome131`, `chrome_android`, `firefox`... | Per-profile avoid lists exist |
| `referer_strategy` | `self_root`, `google_search`, `none` | |

**device_class**:
- `"auto"` (default) — follow the profile strategy
- `"desktop"` — desktop TLS only + disable `mobile_subdomain`
- `"mobile"` — mobile TLS only + enable `mobile_subdomain`

### Playwright Fallback (Capability-Matched)

`engine/executor.py` reads the profile's `capabilities_needed` and automatically selects the runner:

| Tag | Runner | When |
|------|--------|------|
| `needs_real_tls_stack` + `needs_js_exec` | `playwright_real_chrome.js` (local Node) | Akamai Bot Manager, etc. — bundled Chromium TLS is detected |
| `needs_js_exec` only | `playwright_real_chrome.js` (local Node) | Basic Cloudflare protection, etc. |
| `needs_mobile_context` (+ real_tls) | `playwright_mobile_chrome.js` | Mobile device emulation required |

Detailed selection criteria: [playwright.md](playwright.md).

### Local Real Chrome Invocation Rules

In the `fetch_chain` Playwright fallback, `run_playwright_fallback()` automatically runs `engine/templates/playwright_real_chrome.js` (or the mobile variant) as a subprocess — Claude does not need to call browser tools directly. If local execution is impossible, for example because Node/Chrome is not installed, `result.summary` includes installation guidance; only in this case, manually switch to Tier 3 `agent-browser` (see Tier 3 in [`SKILL.md`](../../SKILL.md)).

## Phase 2 — Manual Intervention (Optional)

If Phase 1 returns `ok=False`, obtain user hints and retry:

```python
result = fetch(
    url,
    success_selectors=[...],
    user_hint={"impersonate_first": "safari_ios", "referer_strategy": "none"},
)
```

Hints apply **only to the current invocation** and are not saved.

## Automatic Dependency Installation

Automatically install required packages on the first invocation:
```bash
python3 -c "import curl_cffi, bs4, yaml" 2>/dev/null || pip install curl_cffi beautifulsoup4 pyyaml -q
```

Node is required for the local Playwright path:
```bash
npm i -g playwright playwright-extra puppeteer-extra-plugin-stealth
npx playwright install chrome
```

## Quick Reference — Phase 0 Commands

```bash
# General web (Jina Reader — ordinary HTML only, ineffective for WAF sites)
curl -s "https://r.jina.ai/{URL}"

# yt-dlp — media metadata from 1,858 sites
yt-dlp --dump-json "URL"

# Reddit
curl -sL -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" \
  "https://www.reddit.com/r/{sub}/hot.json?limit=10"

# X/Twitter timeline
curl -sL "https://syndication.twitter.com/srv/timeline-profile/screen-name/{handle}"

# Hacker News
curl -sL "https://hacker-news.firebaseio.com/v0/topstories.json?limitToFirst=10&orderBy=%22%24key%22"

# YouTube subtitles
yt-dlp --write-sub --write-auto-sub --sub-lang "en,ko" --skip-download -o "/tmp/%(id)s" "URL"
```

## No-Site-Name Rule

**Do not hardcode a specific site's domain/URL/selectors/brand name** in `engine/**`, `waf_profiles.yaml`, or `engine/templates/**`.

### Prohibited

- Site-specific registry entries such as `"coupang.com": {...}`
- Domain branches such as `if "coupang" in url: ...`
- Embedding specific site names or empirically observed byte sizes in WAF profile `notes`

### Allowed

- Site-name examples in **explanatory text** in `SKILL.md` / `references/*.md` (for reader understanding)
- The `Phase 0` official API index (endpoints officially published by platforms)
- `observations/*.jsonl` logs (append-only observation data — no effect on code paths)
- Caller-provided `success_selectors`, `user_hint` (valid only for the current invocation)

### Criteria for Borderline Cases

> "Would this entry generally be valid for other sites using the same WAF?" → If YES, use `waf_profiles.yaml`; if NO, use a runtime hint.

### When a New Site Cannot Be Accessed

1. First check `result.trace` to see which phase failed
2. Retry once with the user's `user_hint`
3. If a repeated success pattern is observed, log it in `observations/` (not yet automatic — manual)
4. If confirmed 3+ times and **also valid for other sites using the same WAF**, tune `tls_impersonate_candidates` / `url_transform_order` in the relevant `waf_profiles.yaml` profile (never include site names)
5. If it still fails, consider candidates for new WAF profiles (e.g., finer DataDome distinctions, Kasada)

## Related Documents (references/) — What to Read When

This section is a **guide to selecting reference files**. Use it to decide which `references/*.md` to open when a problem arises. Claude should `Read` a file only when needed, rather than proactively reading all of them.

### A. Engine Extension and Diagnosis (Inside the Harness)

| File | When to Read | Coverage |
|------|-------------|-----------------|
| [`tls-impersonate.md`](tls-impersonate.md) | When the entire curl_cffi grid ends in `challenge`/`blocked`, or when adding a new impersonate target to `waf_profiles.yaml` | Replicating Safari/Chrome/Firefox TLS (JA3/JA4) fingerprints with curl_cffi, optimal target combinations by WAF (Akamai/Cloudflare/F5, etc.), impersonation target versions, empirical basis for `tls_impersonate_avoid` |
| [`playwright.md`](playwright.md) | When the engine moves to the Playwright fallback | Local Node + `channel:'chrome'` + stealth on-demand real Chrome (one path covering basic Cloudflare through Akamai Bot Manager), template parameter specifications |
| [`fallback.md`](fallback.md) | When `verdict` is ambiguous or Phase transition timing needs a decision | Engine Phase 0→1→2→3 escalation principles, detailed response success/failure criteria, exit conditions for each Phase |
| [`metadata.md`](metadata.md) | When the full body is unavailable but key details such as title, summary, price, or author are needed | OGP meta tags, JSON-LD (Schema.org), Twitter Card parsing, structured data extraction patterns |

### B. Lightweight Alternatives (When Another Tool Is Better than the Engine)

| File | When to Read | Coverage |
|------|-------------|-----------------|
| [`jina.md`](jina.md) | When clean Markdown extraction is needed from ordinary web pages without WAFs (blogs/news/wikis) | Puppeteer-based JS SPA rendering and Markdown conversion with one `r.jina.ai/URL` line, free 500 RPM, no API key required |
| [`cache-archive.md`](cache-archive.md) | When the original site is blocked but access to a past snapshot would suffice | Wayback Machine CDX API, archive.today, AMP Cache (Google Cache shut down in 2024-07) |
| [`rss.md`](rss.md) | When structured time-series updates from news/blogs/communities are needed | RSS/Atom autodiscovery, feed parsing, no authentication required — the cleanest time-series data source |

### C. Platform-Specific Official/Public APIs (Linked to the Phase 0 Index)

| File | When to Read | Coverage |
|------|-------------|-----------------|
| [`json-api.md`](json-api.md) | Sites such as Reddit/Wikipedia/HN/npm/PyPI that return JSON **just by changing the URL** | Reddit `/json` suffix + Mobile UA, HN Firebase, Algolia Search, Wikipedia REST, npm/PyPI Registry API |
| [`public-api.md`](public-api.md) | When using official Bluesky/Mastodon/arXiv/Stack Overflow/CrossRef/GitHub/OpenLibrary/Wayback APIs | Unauthenticated official public REST/AT/Atom API endpoints, request formats, common parameters |
| [`twitter.md`](twitter.md) | X/Twitter access — profile timelines, specific tweets, keyword searches | `syndication.twitter.com` timelines, oEmbed individual tweets; for search, obtain URLs through WebSearch, then use oEmbed |
| [`naver.md`](naver.md) | Access to Naver Blog/News/Finance/Search | Service-specific bypasses (blogs via `m.blog.naver.com` conversion, finance via unofficial JSON, search via `search.naver.com`), Korean search query patterns |
| [`media.md`](media.md) | When media metadata/subtitles/audio are needed from YouTube/Vimeo/Twitch/TikTok/SoundCloud, etc. | Coverage of 1,858 sites via `yt-dlp --dump-json`, subtitle downloads (`--write-sub`), format selection, live streams/podcasts |

### D. When to Read Engine Code Directly

| File | When to Read |
|------|-------------|
| `engine/fetch_chain.py` | Check chain stage logic and `Attempt`/`FetchResult` schemas |
| `engine/validators.py` | Four-layer validation details (Verdict classification, challenge marker list) |
| `engine/waf_detector.py` | WAF ranking detection algorithm, `_LAST_LOAD_ERROR` handling |
| `engine/waf_profiles.yaml` | Per-profile detectors, tls_candidates, capabilities_needed |
| `engine/url_transforms.py` | When adding URL transformation rules |
| `engine/executor.py` | Profile-tag-based matching logic for local Playwright runners (real_chrome / mobile_chrome) |
| `engine/templates/*.js` | Playwright template tuning (warmup, reload, devices) |
| `engine/bias_check.py` | Bias linter rules — brand denylist, URL_PATTERN, excluded dirs |

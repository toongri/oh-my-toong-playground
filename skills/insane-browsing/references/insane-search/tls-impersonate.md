# TLS Impersonation — curl_cffi

> The core method for bypassing WAFs based on TLS fingerprints (JA3/JA4).
> Ordinary curl/requests are immediately blocked because of their OpenSSL fingerprints,
> while curl_cffi replicates the TLS fingerprints of real browsers (Chrome/Safari/Firefox).

## Dependencies

```bash
python3 -c "import curl_cffi" 2>/dev/null || pip install curl_cffi -q
```

Available after installation. **Do not skip this step because it is not installed.**

## Try Multiple Targets Sequentially

If one impersonate target fails, retry with another.
**Attempt order: safari → chrome → firefox**

```python
from curl_cffi import requests

TARGETS = ["safari", "chrome", "firefox"]
HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.google.com/",
}

def cffi_fetch(url, locale="ko-KR"):
    """Sequential multi-target attempts + impersonation. Return (response, target) on success."""
    from urllib.parse import urlparse
    origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    for target in TARGETS:
        try:
            session = requests.Session(impersonate=target)
            session.headers.update(HEADERS)
            session.headers["Accept-Language"] = f"{locale},{locale.split('-')[0]};q=0.9"
            session.headers["Referer"] = "https://www.google.com/"
            # Impersonation: homepage cookie warm-up → Referer chain
            try:
                session.get(origin, timeout=10)
            except Exception:
                pass  # Attempt the main request even if the homepage fails
            session.headers["Referer"] = origin
            resp = session.get(url, timeout=20)
            # Detect a JS-required site → remaining targets are pointless
            if "behavioral-content" in resp.text or "sec-if-cpt" in resp.text:
                return None, None  # → Phase 3 Playwright
            if resp.status_code == 200 and len(resp.text) > 500:
                return resp, target
        except Exception:
            continue
    return None, None
```

## Impersonation Target List (v0.15.0)

Generic aliases always resolve to the latest version. **Prefer generic aliases: in 2026, WAFs regard old versions such as chrome99 as suspicious.**

| Alias | Resolves To (2026.04) | Use |
|-------|---------------|------|
| `safari` | safari260 | **Best for Korean sites** (Coupang, FM Korea) |
| `chrome` | chrome146 | General (Cloudflare, Akamai) |
| `firefox` | firefox135 | Alternative when chrome/safari fail |
| `chrome_android` | chrome131_android | Mobile API endpoints |
| `safari_ios` | safari260_ios | iOS mobile |

<details>
<summary>All pinned versions (click)</summary>

```
chrome99, chrome100, chrome101, chrome104, chrome107, chrome110,
chrome116, chrome119, chrome120, chrome123, chrome124, chrome131,
chrome133a, chrome136, chrome142, chrome145, chrome146,
chrome131_android, edge99, edge101,
safari15_3, safari15_5, safari17_0, safari17_2_ios,
safari18_0, safari18_0_ios, safari260, safari260_ios,
firefox133, firefox135
```

</details>

## Best Strategy by WAF

| WAF | Best Target | Additional Conditions | Success Rate |
|-----|-----------|-----------|--------|
| F5 BIG-IP (Coupang) | `safari` | `Referer: https://www.coupang.com/` | ~70% |
| Cloudflare (TLS only) | `chrome` | Add Sec-Fetch-* headers | ~80% |
| Akamai | `chrome` | Use with a residential proxy | 80-90% |
| AWS WAF | `chrome` | — | ~80% |
| CloudFront (YojeumIT) | Unnecessary | Ordinary curl + Chrome UA suffices | 100% |

## Sessions and Cookies

```python
from curl_cffi import requests

# Maintain a session (automatic cookie management)
session = requests.Session(impersonate="safari")

# Obtain session cookies on the first request
session.get("https://www.coupang.com/")

# Automatically forward cookies on subsequent requests
resp = session.get("https://www.coupang.com/np/search?q=키보드")
```

## Combination: nodriver/FlareSolverr → curl_cffi

For JS challenge sites, obtain cookies through a browser, then process quickly with curl_cffi:

```python
# 1. Obtain the cf_clearance cookie with nodriver
import nodriver as uc
browser = await uc.start(headless=True)
page = await browser.get("https://cf-protected-site.com")
await page.cf_verify()
cookies = await browser.cookies.get_all()

# 2. Forward cookies to the curl_cffi Session
from curl_cffi import requests
session = requests.Session(impersonate="chrome")
for c in cookies:
    session.cookies.set(c["name"], c["value"])
resp = session.get("https://cf-protected-site.com/api/data")
```

## Asynchronous (async)

```python
import asyncio
from curl_cffi.requests import AsyncSession

async def fetch_many(urls):
    async with AsyncSession(impersonate="chrome") as session:
        tasks = [session.get(url) for url in urls]
        return await asyncio.gather(*tasks)
```

## HTTP/3 (v0.15.0+)

```python
from curl_cffi import requests
from curl_cffi.const import CurlHttpVersion

resp = requests.get(
    "https://www.cloudflare.com/",
    impersonate="chrome",
    http_version=CurlHttpVersion.V3,
)
```

Bypass effectiveness is high because WAF vendors do not yet actively use HTTP/3 fingerprints.

## Alternative Libraries

Alternatives when curl_cffi fails:

| Library | Installation | Characteristics |
|-----------|------|------|
| primp | `pip install primp` | Rust-based, up to Firefox 148, high performance |
| wreq/rnet | `pip install wreq` | Rust-based, 100+ device profiles |
| tls-client2 | `pip install tls-client2` | Go-based fork, synchronous only |

```python
# primp example
import primp
client = primp.Client(impersonate="chrome_146")
resp = client.get("https://example.com")
```

## What curl_cffi Cannot Bypass

| Defense | curl_cffi | Response |
|-----------|-----------|------|
| TLS/JA3 fingerprint | Can bypass | Core feature |
| HTTP/2 SETTINGS fingerprint | Can bypass | Included in impersonate |
| HTTP/3 QUIC fingerprint | Can bypass (v0.15+) | New |
| JS challenges (Turnstile, etc.) | **Cannot bypass** | → nodriver or Playwright |
| CAPTCHA | **Cannot bypass** | → 2captcha/CapSolver |
| IP reputation (datacenter) | **Cannot bypass** | → Proxy/VPN |
| Behavior analysis (mouse/timing) | **Cannot bypass** | → Real browser |

For sites with JS challenges, hand off to → [playwright.md](playwright.md).

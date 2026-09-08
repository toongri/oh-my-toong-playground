# General Web Extraction — Jina Reader

> Convert almost any public URL to Markdown with a single `r.jina.ai/URL` line.
> Real browser rendering powered by Puppeteer — handles JS SPAs as well.
> **No API key required. Free: 500 requests per minute.**

## Basic Usage

```bash
curl -s "https://r.jina.ai/{URL}"
```

## Advanced Features

### Structured JSON Output

```bash
curl -H "Accept: application/json" "https://r.jina.ai/{URL}"
```

Returns: `data.{title, description, url, content, metadata, external, usage}`

**Key point**: `external.alternate` can **automatically discover the site's RSS URL**.

### CSS Selector Targeting

```bash
curl -H "X-Target-Selector: .article-body" "https://r.jina.ai/{URL}"
```

Remove navigation/footers and extract only the body. Especially effective for community forums.

### SPA Streaming Mode

```bash
curl -H "Accept: text/event-stream" "https://r.jina.ai/{URL}"
```

Wait for JS loading to complete. Return the final version with dynamic content fully rendered.

### Screenshots

```bash
curl -H "X-Respond-With: screenshot" "https://r.jina.ai/{URL}"
```

Return a signed GCS URL (valid for 4 hours). Use for visual verification.

### PDF Processing

```bash
curl -s "https://r.jina.ai/https://example.com/file.pdf"
```

Automatically convert PDF → Markdown. Includes page-count metadata.

### Forward Cookies (Authenticated Sites)

```bash
curl -H "X-Set-Cookie: session=abc123" "https://r.jina.ai/{URL}"
```

### Preserve Links

```bash
curl -H "X-With-Links: true" "https://r.jina.ai/{URL}"
```

### Cache Control

```bash
# Bypass the cache (when real-time content is needed)
curl -H "X-No-Cache: true" "https://r.jina.ai/{URL}"

# Set cache TTL (seconds)
curl -H "X-Cache-Tolerance: 600" "https://r.jina.ai/{URL}"
```

### Plain Text / Raw HTML

```bash
# body.innerText only
curl -H "X-Respond-With: text" "https://r.jina.ai/{URL}"

# Raw HTML
curl -H "X-Respond-With: html" "https://r.jina.ai/{URL}"
```

## Verified Successful Sites

| Site | Result | Notes |
|--------|------|------|
| Threads | Success | Profiles + posts |
| Clien | Success | Post lists + bodies |
| Ruliweb | Success | Post lists + bodies |
| Ppomppu | Success | Posts + RSS also available |
| Naver News | Success | Article lists + full bodies |
| Naver Finance | Success | Real-time stock prices |
| GeekNews | Success | Topic lists + bodies |
| 44bits | Success | Article lists |
| Careerly | Success | Extracted via JS rendering |
| Brunch | Success | Full articles |
| Hankyung | Success | News articles |
| Daum News | Success | News articles |
| Medium | Success | Full articles (excluding paywalls) |
| Substack | Success | Full newsletters |
| dev.to | Success | Full articles |
| PDF (any URL) | Success | Automatic conversion |

## Sites That Fail

| Site | Reason |
|--------|------|
| X/Twitter | 402 — use Syndication/oEmbed (see twitter.md) |
| Reddit | Blocked — use JSON API (see json-api.md) |
| DC Inside | Returns an empty body |
| FM Korea | HTTP 430 |
| YojeumIT | CloudFront 403 |
| Naver Shopping | CAPTCHA |
| Coupang | WAF block |


## Automatic RSS Discovery

Jina JSON mode automatically exposes the site's RSS URL in `external.alternate`:

```bash
curl -H "Accept: application/json" "https://r.jina.ai/{URL}" | \
python3 -c "import sys,json; print(json.load(sys.stdin)['data'].get('external',{}))"
```

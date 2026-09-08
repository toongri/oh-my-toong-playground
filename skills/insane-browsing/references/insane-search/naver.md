# Access Strategies for Naver Services

> Access methods differ by Naver service. Use mobile URLs for blogs and Jina Reader for news/finance.

## Naver Blog

WebFetch is blocked. Convert to a mobile URL and access with an iPhone UA.

```bash
# Convert blog.naver.com/{ID}/{NO} → m.blog.naver.com
curl -sL \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" \
  -H "Accept-Language: ko-KR,ko;q=0.9" \
  -H "Referer: https://m.naver.com/" \
  "https://m.blog.naver.com/PostView.naver?blogId={ID}&logNo={NO}"
```

RSS is also available (latest 50 posts, approximately 300 body characters):
```bash
curl -sL "https://rss.blog.naver.com/{BLOG_ID}.xml"
```

## Naver News

Full access is available through Jina Reader.

```bash
# Article list
curl -s "https://r.jina.ai/https://news.naver.com/"

# Individual article
curl -s "https://r.jina.ai/https://n.news.naver.com/article/{press_id}/{article_id}"
```

## Naver Finance

Access real-time stock prices and major news through Jina Reader.

```bash
curl -s "https://r.jina.ai/https://finance.naver.com/item/main.naver?code={종목코드}"
```

## Naver Finance Quotes (Unofficial, Unauthenticated)

No authentication required. Returns stock-price time-series data as JSON.

```bash
# Daily quotes (Samsung Electronics=005930)
curl -sL "https://api.finance.naver.com/siseJson.naver?symbol=005930&requestType=1&startTime=20240101&endTime=20241231&timeframe=day"

# Minute candles
curl -sL "https://api.finance.naver.com/siseJson.naver?symbol=005930&requestType=0&timeframe=minute&count=200"
```

Response: `[[날짜, 시가, 고가, 저가, 종가, 거래량, 외국인거래율], ...]`

## Naver Search (Direct Access via Impersonation)

Use curl_cffi + session cookie warm-up to crawl Naver search results directly. No API key required.

```python
from curl_cffi import requests
from urllib.parse import quote

s = requests.Session(impersonate="chrome124")
s.headers.update({
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": "https://www.google.com/",
})
s.get("https://www.naver.com/", timeout=10)  # Warm up cookies
s.headers["Referer"] = "https://www.naver.com/"

# Integrated search (blogs + news + web combined)
r = s.get(f"https://search.naver.com/search.naver?query={quote('검색어')}")

# Blog tab
r = s.get(f"https://search.naver.com/search.naver?where=post&query={quote('검색어')}")

# News tab
r = s.get(f"https://search.naver.com/search.naver?where=news&query={quote('검색어')}")
```

### Extractable Data

| Tab | URL Pattern | Extraction |
|---|---|---|
| Integrated | `search.naver?query=` | Blog URLs, external links, news |
| Blog | `where=post&query=` | blog.naver.com URLs, titles, snippets |
| News | `where=news&query=` | n.news.naver.com URLs, titles |

### Primary Route for Korean Keyword Searches

WebSearch is slow to index new Korean content, while Naver Search is optimized for Korean.
**Keyword searches on Korean sites → direct Naver Search access is the most accurate and fastest route.**

## Naver Cafe

A double barrier of login + iframe prevents direct access to the body.
Try Phases 1–3 in the fallback chain, but stop with "인증 필요" when login/paywall is detected.

## Naver TV

Access with yt-dlp (see media.md).

```bash
yt-dlp --dump-json "https://tv.naver.com/v/{video_id}"
```

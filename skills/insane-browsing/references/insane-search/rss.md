# RSS/Atom Feeds

> No authentication required. Subscribe directly with just the URL. The cleanest data from news/blogs/communities.

## Dependencies

```bash
python3 -c "import feedparser" 2>/dev/null || pip install feedparser -q
```

## Automatic RSS Discovery

Automatically detect the site's RSS URL with Jina Reader JSON mode:

```bash
curl -sH "Accept: application/json" "https://r.jina.ai/{URL}" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['data'].get('external',{}).get('alternate',[]))"
```

## Discover Feeds via URL Variants

Patterns to try even if the site does not advertise RSS:

```bash
curl -sL "{origin}/rss"
curl -sL "{origin}/feed"
curl -sL "{origin}/atom.xml"
curl -sL "{origin}/rss.xml"
curl -sL "{origin}/index.xml"
```

## Google News RSS (Unauthenticated)

```bash
# Keyword search
curl -sL "https://news.google.com/rss/search?q={검색어}&hl=ko&gl=KR&ceid=KR:ko"

# By topic (TECHNOLOGY, BUSINESS, SCIENCE, SPORTS, HEALTH, WORLD)
curl -sL "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=ko&gl=KR&ceid=KR:ko"

# Time filter: when:1h, when:7d, when:12m, after:YYYY-MM-DD
curl -sL "https://news.google.com/rss/search?q={검색어}+when:7d&hl=ko&gl=KR&ceid=KR:ko"
```

## Korean News Outlet RSS

All unauthenticated. Access directly with curl.

```bash
# SBS News
curl -sL "https://news.sbs.co.kr/news/rss.do"

# Chosun Ilbo
curl -sL "http://www.chosun.com/site/data/rss/rss.xml"

# JoongAng Ilbo
curl -sL "http://rss.joinsmsn.com/joins_news_list.xml"

# Dong-A Ilbo
curl -sL "http://rss.donga.com/total.xml"

# Kyunghyang Shinmun
curl -sL "http://www.khan.co.kr/rss/rssdata/total_news.xml"

# Maeil Business Newspaper
curl -sL "http://file.mk.co.kr/news/rss/rss_30000001.xml"

# MBC News
curl -sL "http://imnews.imbc.com/rss/news/news_00.xml"

# Hankyung
curl -sL "https://www.hankyung.com/feed/all-news"

# Yonhap News
curl -sL "https://www.yonhapnewsagency.com/RSS/headline.xml"
```

## Blog/Platform RSS

```bash
# Naver Blog
curl -sL "https://rss.blog.naver.com/{BLOG_ID}.xml"

# Tistory
curl -sL "https://{blogname}.tistory.com/rss"

# Velog
curl -sL "https://v2.velog.io/rss/@{username}"

# Substack
curl -sL "https://{publication}.substack.com/feed"

# GitHub releases (Atom)
curl -sL "https://github.com/{owner}/{repo}/releases.atom"

# YouTube channel
curl -sL "https://www.youtube.com/feeds/videos.xml?channel_id={id}"

# HN (hnrss.org — unofficial but stable)
curl -sL "https://hnrss.org/frontpage"
```

## Parsing with feedparser

```python
import feedparser

feed = feedparser.parse("FEED_URL")
for e in feed.entries[:10]:
    print(f"{e.title} — {e.link}")
    if hasattr(e, 'summary'):
        print(f"  {e.summary[:200]}")
```

## SearXNG (Unauthenticated Metasearch)

Public instances offer JSON search. JSON support varies by instance.

```bash
# Public instance list: https://searx.space
curl -sL "https://search.mdosch.de/search?q={검색어}&format=json" \
  -H "User-Agent: insane-search/1.0"
```

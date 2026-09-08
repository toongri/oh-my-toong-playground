# Caches & Archives

> Access cached/archived versions when the original site is blocked.
> Google Cache shut down in July 2024 — AMP cache and archive.today are alternatives.

## Dependencies

None (uses only curl).

## 1. Google AMP Cache

Cached versions of AMP-enabled sites. Effective for news/media sites.

```bash
# URL transformation: replace . in the domain with - → cdn.ampproject.org
# Example: www.bbc.com → www-bbc-com.cdn.ampproject.org

python3 -c "
from urllib.parse import urlparse
url = '{URL}'
p = urlparse(url)
domain_sub = p.netloc.replace('.', '-')
print(f'https://{domain_sub}.cdn.ampproject.org/c/s/{p.netloc}{p.path}')
"

# Access the transformed URL
curl -sL "https://{domain-with-dashes}.cdn.ampproject.org/c/s/{netloc}{path}"
```

**Success condition**: The site serves AMP pages (most news/media sites)
**Failure conditions**: Sites without AMP, very recent content (cache delay ~15 seconds)

## 2. archive.today

User-submitted archives. Especially useful for paywalled articles and deleted content.
Multiple domains are available — use another if one is blocked.

```bash
# Look up the latest snapshot
curl -sL "https://archive.ph/newest/{URL}"

# Rotate domains (try another if one is blocked)
for domain in archive.ph archive.is archive.md archive.vn archive.li; do
  resp=$(curl -sL -o /dev/null -w "%{http_code}" "https://$domain/newest/{URL}")
  if [ "$resp" = "200" ] || [ "$resp" = "302" ]; then
    echo "성공: https://$domain/newest/{URL}"
    curl -sL "https://$domain/newest/{URL}"
    break
  fi
done
```

**Success condition**: Someone has previously archived the URL
**Failure condition**: The URL has never been archived

## 3. Wayback Machine (Internet Archive)

```bash
# Check whether a snapshot exists
curl -sL "https://archive.org/wayback/available?url={URL}"

# Access the latest snapshot
curl -sL "https://web.archive.org/web/{URL}"

# CDX API — list snapshots
curl -sL "https://web.archive.org/cdx/search/cdx?url={URL}&output=json&fl=timestamp,statuscode&limit=5"
```

**Success condition**: A public URL that has been crawled
**Failure conditions**: Sites blocked by robots.txt, SPAs (not rendered), iframe-based sites

## 4. Google Cache (Discontinued)

> **Shut down in July 2024.** `webcache.googleusercontent.com` no longer works.
> Use AMP cache or archive.today instead.

## Attempt Order

```
1. AMP cache (news/media sites → high success rate)
2. archive.today (paywalled/deleted content → reliable if archived)
3. Wayback Machine (older content → reliable if a snapshot exists)
```

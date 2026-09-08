# Metadata Extraction — OGP / JSON-LD / Schema.org

> A supporting technique for extracting structured data from received HTML.
> Even without the full body, you can obtain key information such as titles, summaries, prices, and profiles.

## Dependencies

None (curl + python3 standard modules).

## OGP (Open Graph Protocol) Meta Tags

Most sites include these for social sharing. You can extract the title + description + image.

```bash
curl -sL -H "User-Agent: Mozilla/5.0 ..." "{URL}" | \
  python3 -c "
import sys, re
html = sys.stdin.read()
for m in re.findall(r'<meta property=\"og:(\w+)\" content=\"([^\"]*?)\"', html):
    print(f'og:{m[0]} = {m[1]}')
for m in re.findall(r'<meta name=\"description\" content=\"([^\"]*?)\"', html):
    print(f'description = {m}')
"
```

## JSON-LD (Schema.org Structured Data)

**The most valuable extraction target.** Contains structured information about products, articles, profiles, and more as JSON.

```bash
curl -sL "{URL}" | \
  python3 -c "
import sys, re, json
html = sys.stdin.read()
blocks = re.findall(r'<script type=\"application/ld\+json\">(.*?)</script>', html, re.DOTALL)
for b in blocks:
    try:
        data = json.loads(b)
        print(json.dumps(data, ensure_ascii=False, indent=2))
    except:
        pass
"
```

### Real Examples

**Coupang search results** — `CollectionPage` + `ItemList`:
```json
{
  "@type": "CollectionPage",
  "mainEntity": {
    "@type": "ItemList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "item": {
          "@type": "Product",
          "name": "...",
          "offers": { "price": 29900 }
        }
      }
    ]
  }
}
```

**LinkedIn profile** — `Person`:
```json
{
  "@type": "Person",
  "name": "...",
  "jobTitle": "...",
  "alumniOf": [
    { "@type": "Organization", "name": "..." }
  ]
}
```

**News article** — `NewsArticle`:
```json
{
  "@type": "NewsArticle",
  "headline": "...",
  "datePublished": "2026-04-16",
  "author": { "name": "..." },
  "articleBody": "..."
}
```

## Next.js RSC Payloads (YojeumIT, etc.)

Next.js App Router sites include content in `self.__next_f.push()` scripts.

```bash
curl -sL "{URL}" | \
  python3 -c "
import sys, re
html = sys.stdin.read()
chunks = re.findall(r'self\.__next_f\.push\(\[1,\"(.*?)\"\]\)', html)
text = ''.join(chunks)
# Extract Korean text (decode Unicode escapes)
decoded = text.encode().decode('unicode_escape', errors='ignore')
print(decoded[:3000])
"
```

## When to Use

Metadata extraction is **a supporting technique, not a standalone method**.
Run it alongside any Phase that returns HTML:

- Receive HTML via curl in Phase 1 → also extract JSON-LD
- Receive HTML via curl_cffi in Phase 2 → also extract JSON-LD
- Receive the DOM via Playwright in Phase 3 → extract JSON-LD with `browser_evaluate`

Even without the body, JSON-LD may provide **product prices, article summaries, and profile information**.

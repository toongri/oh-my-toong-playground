# URL Normalize — Algorithm Spec

## Overview

Normalizes job posting URLs so that different URLs pointing to the same posting
converge to the same canonical form.
The primary goals are removing tracking parameters and unifying case,
while preserving parameters required to identify a posting (e.g., LinkedIn `currentJobId`).

Implementation: [`scripts/url-normalize.ts`](../scripts/url-normalize.ts)

---

## Step-by-Step Algorithm

| Order | Processing | Notes |
|------|-----------|------|
| 1 | Parse with `new URL(input)` | Invalid URLs throw an exception |
| 2 | Lowercase `protocol` and `hostname` | Normalize case for scheme + host |
| 3 | Remove fragment by setting `hash = ''` | Strips `#section` etc. |
| 4 | Filter query params (see list below) | Includes `utm_*` wildcard |
| 5 | Remove trailing slash | Root path where `pathname === '/'` is kept |

---

## Query Params to Remove

### Exact Match (case-insensitive)

| Parameter | Source |
|----------|------|
| `gclid` | Google Click ID |
| `fbclid` | Facebook Click ID |
| `_ga` | Google Analytics |
| `ref` | Referrer marker (generic) |
| `source` | Traffic source marker (generic) |

### Wildcard (prefix match)

| Pattern | Examples |
|------|------|
| `utm_*` | `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, etc. |

---

## Preserved Parameters Examples

Parameters required for **posting identification** (not tracking) are never removed.

| Parameter | Platform | Role |
|----------|--------|------|
| `currentJobId` | LinkedIn | Unique posting ID |
| `wd_id` | Wanted | Unique posting ID (some URL formats) |
| `jobId` | Other job platforms | Unique posting ID |
| `keep` | Arbitrary platform | Arbitrary parameter marked for preservation |

General rule: **All parameters not on the removal list are kept as-is.**

---

## Fixture Table

| Input URL | Expected Output | Validation Point |
|----------|-----------|-------------|
| `https://wanted.co.kr/wd/12345?utm_source=google&gclid=abc` | `https://wanted.co.kr/wd/12345` | utm_* + gclid removed |
| `https://www.linkedin.com/jobs/view/?currentJobId=999&ref=home` | `https://www.linkedin.com/jobs/view?currentJobId=999` | currentJobId preserved, ref removed, trailing slash removed |
| `https://example.com/a#section` | `https://example.com/a` | Fragment removed |
| `https://example.com/jobs/` | `https://example.com/jobs` | Trailing slash removed (non-root) |
| `https://example.com/` | `https://example.com/` | Trailing slash preserved (root) |
| `HTTPS://Example.COM/Path?utm_medium=x` | `https://example.com/Path` | Host case normalized |
| `https://example.com/j?fbclid=1&_ga=2&keep=y` | `https://example.com/j?keep=y` | fbclid + _ga removed, keep preserved |

---

## Implementation Link and How to Run Tests

**Implementation**

```
scripts/url-normalize.ts
```

**Run Tests**

```bash
# From project root
bun test skills/collect-jd/scripts/url-normalize.test.ts
```

Expected result: `7 pass, 0 fail`

# URL Normalize — Algorithm Spec

## Overview

채용공고 URL을 정규화하여 동일한 공고를 가리키는 서로 다른 URL들이
동일한 정규형(canonical form)으로 수렴하도록 한다.
주요 목적은 추적 파라미터(tracking parameters) 제거와 케이스 통일이며,
공고 식별에 필요한 파라미터(예: LinkedIn `currentJobId`)는 반드시 보존한다.

구현체: [`lib/collect-jd/url-normalize.ts`](../../../lib/collect-jd/url-normalize.ts)

---

## 단계별 알고리즘

| 순서 | 처리 내용 | 비고 |
|------|-----------|------|
| 1 | `new URL(input)` 으로 파싱 | 유효하지 않은 URL은 예외 발생 |
| 2 | `protocol`, `hostname` → lowercase | scheme + host 대소문자 통일 |
| 3 | `hash = ''` 으로 fragment 제거 | `#section` 등 제거 |
| 4 | Query param 필터링 (아래 목록 참고) | utm_* 와일드카드 포함 |
| 5 | Trailing slash 제거 | `pathname === '/'` 인 root path는 유지 |

---

## Query Param 제거 목록

### 완전 일치 (case-insensitive)

| 파라미터 | 출처 |
|----------|------|
| `gclid` | Google Click ID |
| `fbclid` | Facebook Click ID |
| `_ga` | Google Analytics |
| `ref` | 레퍼러 표시 (일반) |
| `source` | 유입 경로 표시 (일반) |

### 와일드카드 (prefix 일치)

| 패턴 | 예시 |
|------|------|
| `utm_*` | `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` 등 |

---

## 보존 파라미터 예시

추적 목적이 아닌 **공고 식별**에 필요한 파라미터는 제거하지 않는다.

| 파라미터 | 플랫폼 | 역할 |
|----------|--------|------|
| `currentJobId` | LinkedIn | 공고 고유 ID |
| `wd_id` | Wanted | 공고 고유 ID (일부 URL 형식) |
| `jobId` | 기타 채용 플랫폼 | 공고 고유 ID |
| `keep` | 임의 플랫폼 | 보존 대상 임의 파라미터 |

일반 원칙: **제거 목록에 없는 모든 파라미터는 원형 그대로 유지.**

---

## Fixture 표

| 입력 URL | 기대 출력 | 검증 포인트 |
|----------|-----------|-------------|
| `https://wanted.co.kr/wd/12345?utm_source=google&gclid=abc` | `https://wanted.co.kr/wd/12345` | utm_* + gclid 제거 |
| `https://www.linkedin.com/jobs/view/?currentJobId=999&ref=home` | `https://www.linkedin.com/jobs/view?currentJobId=999` | currentJobId 보존, ref 제거, trailing slash 제거 |
| `https://example.com/a#section` | `https://example.com/a` | fragment 제거 |
| `https://example.com/jobs/` | `https://example.com/jobs` | trailing slash 제거 (root 아닌 경우) |
| `https://example.com/` | `https://example.com/` | trailing slash 유지 (root) |
| `HTTPS://Example.COM/Path?utm_medium=x` | `https://example.com/Path` | host 대소문자 정규화 |
| `https://example.com/j?fbclid=1&_ga=2&keep=y` | `https://example.com/j?keep=y` | fbclid + _ga 제거, keep 보존 |

---

## 구현 링크 및 테스트 실행 방법

**구현체**

```
lib/collect-jd/url-normalize.ts
```

**테스트 실행**

```bash
# 프로젝트 루트에서
bun test lib/collect-jd/url-normalize.test.ts
```

기대 결과: `7 pass, 0 fail`

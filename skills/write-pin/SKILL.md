---
name: write-pin
description: "Use when emitting a new pin, updating a stale pin, or superseding existing indexing — triggers include 박기, 발견, write pin, supersedes, pin 갱신, 새 pin, 잘못된 indexing 수정. Also use when learning the pin XML emission format before emitting. Do NOT trigger on pin retrieval tasks (use select-pin instead)."
---

# write-pin

AI가 발견 이벤트(또는 갱신 이벤트)에서 `<pin>` XML을 emit하기 위해 invoke하는 형식 학습 스킬이다.
Stop hook(`hooks/pin-up/`)이 응답 transcript를 후처리해 `$OMT_DIR/pins/{slug}.md` 마크다운으로 직렬화한다.

## Identity proposition (SSOT vs wiki)

pin은 indexing이지 wiki가 아니다. 아래 4개 명제는 이 시스템의 핵심 제약이다.

| 슬러그 | 명제 |
|---|---|
| `indexing-not-wiki` | pin은 SSOT를 가리키는 포인터이지 SSOT 자체가 아니다. 원본은 다른 시스템(코드/PR/Slack/Notion/사람)에 있다. |
| `ssot-no-copy` | SSOT 본문을 pin 본문에 복사하지 않는다. URL과 한 줄 요지 + 전후 맥락으로 충분하다. |
| `5-elements-only` | pin이 포함하는 것: ① 위치(source_url) ② 권위(authority) ③ 한 줄 요지 ④ 전후 컨텍스트 ⑤ cross-link. 이 5가지 외에는 쓰지 않는다. |
| `long-body-wrong-ssot` | 본문이 길어진다면 SSOT를 다른 곳에 두지 않고 pin에 직접 쓰는 것이므로 잘못된 사용이다. 본문이 4섹션을 넘어가면 stop하고 재고한다. |

## `<pin>` XML 형식 (v1 동결)

AI 응답 중 발견 이벤트가 발생하면 응답 본문에 다음 형식으로 `<pin>` XML을 emit한다.

```xml
<pin slug="EXAMPLE-kind-topic-slug"
     source_url="https://example.com/or/person:name"
     authority="누가 또는 무엇이 ground truth인가"
     tier="1"
     tags="tag1,tag2"
     sensitivity="private"
     related="slug1,slug2"
     supersedes="old-slug"
     discovery_context="어떤 작업 중 발견했는지 — 한 줄">
### ① 한 줄 요지
X는 Y이다. (≤80자)

### ② SSOT 위치 + 도달 경로
source_url 설명 + 접근 방법 한 줄.

### ③ 전후 컨텍스트
어떤 작업 흐름에서 이 정보가 필요했는지 (Memex associative trail).

### ④ 관련 cross-link
- → slug1: 연관 이유
</pin>
```

### 필수 속성 (6개)

| 속성 | 설명 |
|---|---|
| `slug` | 유일 식별자. 아래 Slug 8 원칙 준수 필수. |
| `source_url` | SSOT 위치. URL 또는 `person:이름` 자유 식별자. |
| `authority` | ground truth 주체 (사람명, 시스템명, 팀명 등). |
| `tier` | 중요도 티어 (1=핵심, 2=참고, 3=일시). |
| `tags` | 쉼표 구분 토픽 태그. |
| `sensitivity` | `private` 또는 `shared` (v1: 정의만, 분기 로직은 v2). |

### 선택 속성 (3개)

| 속성 | 설명 |
|---|---|
| `related` | 관련 pin slug 쉼표 구분 목록. |
| `supersedes` | 이 pin이 대체하는 기존 slug. 잘못된 indexing 수정 시 사용. |
| `discovery_context` | 발견 경위 한 줄 메모 (Memex trail). |

> **참고**: `created_at`은 XML 속성이 아니라 frontmatter에 기록된다 (Stop hook이 자동 설정).
> `source_kind` enum은 폐기됨 — `source_url` 하나로 위치 정보를 충분히 전달한다.

## Frontmatter 스키마 (v1 동결)

Stop hook이 `<pin>` XML을 추출해 아래 frontmatter + 본문 마크다운으로 직렬화한다.

| 필드 | 필수? | 설명 |
|---|---|---|
| `slug` | Y | 유일 식별자 |
| `source_url` | Y | URL 또는 `person:이름` |
| `authority` | Y | ground truth 주체 |
| `tier` | Y | 중요도 티어 (1/2/3) |
| `tags` | Y | 토픽 태그 배열 |
| `sensitivity` | Y | `private` / `shared` |
| `created_at` | Y | ISO8601 (Stop hook이 자동 설정) |
| `related` | N | cross-link slug 배열 |
| `supersedes` | N | 대체하는 slug |
| `discovery_context` | N | 발견 경위 한 줄 |

validator(`hooks/pin-up/validator.ts`)가 6개 필수 필드(slug/source_url/authority/tier/tags/sensitivity) 미존재 시 `.escape.jsonl`로 이탈시킨다. created_at은 Stop hook이 자동 설정한다.

## 본문 4섹션 형식 (AC-18)

`<pin>` XML 본문은 반드시 아래 4개 `### ` 헤더 섹션을 순서대로 포함해야 한다.
validator가 4섹션 헤더를 grep해 누락 시 escape 처리한다.

```
### ① 한 줄 요지
[≤80자. 핵심 1문장. 이것만 읽어도 무엇인지 알아야 한다.]

### ② SSOT 위치 + 도달 경로
[source_url이 가리키는 위치 설명 + 접근 방법.]

### ③ 전후 컨텍스트
[어떤 작업 흐름에서 이 정보가 필요했는지. Memex associative trail.]

### ④ 관련 cross-link
[- → slug: 연관 이유 (없으면 "없음" 한 줄)]
```

4섹션을 넘어가는 내용은 SSOT 본문 복사(`ssot-no-copy` 위반) 징후다. 멈추고 축약하라.

## Slug 8 원칙 (AC-7)

### 원칙 ①
형식: `{YYYY-MM-DD}-{kind}-{topic}-{slug}` 또는 날짜 없이 `{kind}-{topic}-{slug}`.
날짜는 시간제한사가 아닌 발견 이벤트 식별자로 사용할 때만 붙인다.

### 원칙 ②
`kind` ∈ `{jira, linear, slack, notion, code, person, decision, finding, gotcha, unknown}`.
목록에 없는 kind는 `unknown`을 사용한다.

### 원칙 ③
`topic` = 도메인 명사 1단어 (영소문자). 예: `auth`, `billing`, `deploy`, `ratelimit`.

### 원칙 ④
`slug` 부분 = 2~4 영숫자 단어, kebab-case. 예: `jwt-verify`, `token-refresh-flow`.

### 원칙 ⑤
공백 금지. 슬러그 어디에도 공백 문자가 없어야 한다.

### 원칙 ⑥
동사/형용사 금지. 슬러그는 명사형 식별자여야 한다.
나쁜 예: `how-to-fix-auth` (동사), `broken-token` (형용사).

### 원칙 ⑦
시간제한사 금지. `today`, `current`, `latest`, `now` 같은 단어는 쓰지 않는다.
(날짜 접두사 `{YYYY-MM-DD}`는 허용 — 고정값이므로 시간제한사가 아님.)

### 원칙 ⑧
출처 의존 금지. 슬러그는 source_url이 바뀌어도 유효해야 한다.
나쁜 예: `notion-page-12345` (notion URL이 바뀌면 slug가 무의미해짐).

**정규식** (validator 자동 검증 범위: 원칙 ①~⑤):
```
^[a-z0-9]+(-[a-z0-9]+){2,}(-\d{6})?$
```

> 원칙 ⑥~⑧는 자동 검증 불가 — AI가 판단해야 한다.

## 좋은 슬러그 사고 절차

슬러그를 결정하기 전에 아래 순서로 생각한다.

1. **kind 결정**: 이 정보의 원천은 어떤 시스템인가? (`code`, `slack`, `decision`, `person`, …)
2. **topic 결정**: 이 정보가 속하는 도메인 명사 1단어는? (`auth`, `billing`, `deploy`, …)
3. **slug 파트 결정**: 이 pin을 다른 핀들과 구별하는 명사 2~4단어는?
4. **원칙 ⑥~⑧ 자기 점검**: 동사/형용사 있나? 시간제한사 있나? 출처 URL에 의존하나?
5. **정규식 통과 여부 확인**: `^[a-z0-9]+(-[a-z0-9]+){2,}(-\d{6})?$`

## 슬러그 예시

### 좋은 예 ①
`code-auth-jwt-verify` — kind=code, topic=auth, slug=jwt-verify. 명사형, 출처 독립.

### 좋은 예 ②
`decision-billing-plan-limit` — kind=decision, topic=billing, slug=plan-limit. 의사결정 기록.

### 좋은 예 ③
`person-deploy-owner` — kind=person, topic=deploy, slug=owner. 사람 권위 기록.

### 좋은 예 ④
`slack-ratelimit-threshold-config` — kind=slack, topic=ratelimit, slug=threshold-config. Slack 스레드에서 발견한 설정값.

### 나쁜 예 ①
`how-to-fix-auth-bug` — 동사(`fix`) + 형용사(`bug`). 원칙 ⑥ 위반.

### 나쁜 예 ②
`current-deploy-setting` — 시간제한사(`current`). 원칙 ⑦ 위반.

### 나쁜 예 ③
`notion-page-1a2b3c` — URL 식별자 포함. 원칙 ⑧ 위반.

### 나쁜 예 ④
`auth` — 단어 2개 미만 (kind-topic-slug 구조 미준수). 정규식 실패.

## Cross-link 컨벤션

`related` 속성에 나열한 slug들은 validator가 `$OMT_DIR/pins/{slug}.md` 존재 여부를 검증한다.
존재하지 않는 slug를 참조하면 escape 처리된다.

reference 파일 링크 표기 컨벤션:
```
→ Details: [reference/X.md]
```

SSOT 종류별 풍부한 예시는 → Details: [reference/examples-by-ssot-kind.md]
5가지 use case 시나리오는 → Details: [reference/use-cases.md]

## Validation

write-pin 스키마는 `hooks/pin-up/validator.ts`가 강제한다. 위반 시 `.escape.jsonl`로 이탈되며 pin 파일은 생성되지 않는다.

v1 best-effort: validator는 tier/sensitivity 등 enum 값 자체를 강제하지 않는다 — 학습 픽스처(SKILL.md + reference/*)와 schema 정합성에 의존한다.

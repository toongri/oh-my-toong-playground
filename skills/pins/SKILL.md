---
name: pins
description: Use when the user mentions pins, 핀, 박기, pin 조회, pin 박기, 핀 시스템, or when context lookup or knowledge pinning is needed — entry point for the on-discovery pinning system
---

# pins

## What pins are — SSOT vs wiki 핵심 디자인 명제

**pin은 indexing이지 wiki가 아니다.** SSOT(Single Source of Truth)는 다른 시스템에 있고, pin은 그걸 가리키는 **포인터 + 전후 컨텍스트 + cross-link**일 뿐이다.

4개의 핵심 명제:

**`indexing-not-wiki`** — pin은 SSOT를 가리키는 인덱스다. wiki처럼 SSOT 내용을 이 안에 재서술하지 않는다.

**`ssot-no-copy`** — SSOT 본문을 pin 안에 복사하지 않는다. 위치(source_url)와 권위(authority)를 기록하면 충분하다.

**`5-elements-only`** — pin이 박는 것은 정확히 5가지다: ① 위치(source_url 또는 식별자) ② 권위(누가/무엇이 ground truth인가) ③ 한 줄 요지 ④ 전후 컨텍스트(어떤 작업 중 발견했는지 — Memex associative trail) ⑤ cross-link(관련 다른 pin slug, 다른 SSOT URL). 이 5가지 외에 추가하지 않는다.

**`long-body-wrong-ssot`** — pin 본문이 길면 SSOT가 잘못된 곳에 있다는 신호다. pin 본문이 SSOT 본문보다 길어지면 안 된다. 그 경우 SSOT를 올바른 시스템(코드/PR/문서)으로 옮기고 pin은 다시 포인터로 축약한다.

## 횡단 인프라 선언

이 시스템은 prometheus/sisyphus/spec/sisyphus-junior에 책임을 박지 않는 횡단 인프라이다.

## Sub-skill 인덱스

pins 시스템은 두 개의 전문 스킬로 구성된다:

- **`select-pin`** (조회) — 기존 pin 인덱스에서 관련 pin을 찾고 읽는 절차. 컨텍스트가 필요할 때 먼저 invoke한다.
- **`write-pin`** (박기) — `<pin>` XML 형식 학습 + emit 절차. 새 발견·갱신 시 invoke한다.

**pin-session-start hook**이 SessionStart 이벤트에서 `$OMT_DIR/pins/` 인덱스를 자동으로 surface하여 현재 세션에 사용 가능한 pin 목록과 Model 2 안내(select-pin/write-pin invoke 방법)를 컨텍스트로 주입한다.

## Platform matrix

| Platform | skills | hooks | lifecycle 자동 |
|---|---|---|---|
| claude | O | O | O |
| gemini | O | X | X |
| codex | O | X | X |
| opencode | O | X | X |

gemini/codex/opencode는 skills를 통한 수동 invoke는 동작하나, Stop hook 기반 lifecycle 자동화는 지원하지 않는다(M4 advisory 적용 — gemini fixture 실측 불가로 v2 연기).

## Use cases

### 시나리오 A — hit: pin에 있고 정확

컨텍스트가 필요한 작업 중 해당 도메인 pin이 이미 존재한다. `select-pin`으로 조회 → 매칭 pin 발견 → 본문 read → 작업에 적용. 이미 정확한 pin이 있으므로 신규 emit 없음.

### 시나리오 B — stale: pin 있으나 잘못됨

`select-pin` 조회 시 pin이 존재하나 본문이 현재 사실과 다름을 발견. 사용자 인터뷰 또는 최신 문서로 정확한 정보를 확인한 뒤 `write-pin`으로 `supersedes` 갱신 emit.

### 시나리오 C — miss + 직접 발견

관련 pin 없음, 사용자도 정보를 모름. AI가 문서·코드를 뒤져 직접 발견. `write-pin` invoke → 신규 `<pin>` emit.

### 시나리오 D — miss + 사람 정보원

관련 pin 없음. 사용자가 "A에게 있다더라"라고 알려줌. `write-pin` invoke → `source_url: person:A` 형태로 emit하여 사람을 권위 SSOT로 기록.

### 시나리오 E — miss + 미상

아무도 정확한 위치를 모름. `write-pin` invoke → placeholder pin emit. `authority: unknown`. 다음 발견 시 `supersedes`로 갱신한다.

## v1 best-effort 한계

AI emit이 발견 이벤트의 100%를 커버한다고 보장하지 않음. 운영 데이터 수집 후 v2에서 측정/강제 도입 검토.

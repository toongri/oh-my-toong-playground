# QA Feature Map

Feature Map은 QA의 제품 맥락 보조 자료다. 코드의 함수 목록이 아니라 사용자가
기능에 도착하는 경로, 관찰 가능한 상태, 생명주기, 인접 기능을 빠르게 다시 찾는
목적별 지도다. 지도는 기대 계약을 대신하지 않으며, 실행 결과의 증거도 아니다.

## PLAN 조회 순서

QA PLAN에서는 코드/스펙 분석보다 먼저 Feature Map을 조회한다. 반드시
`query`로 후보를 찾고, 일치하는 기능마다 `get`으로 전체 문서를 읽은 뒤 현재
코드/스펙을 다시 확인한다. 이 순서가 arrival path, 상태 변화, lifecycle,
인접 기능 누락을 찾는 출발점이다.

- 사용자는 어떤 화면, HTTP 경계, CLI, 작업 트리거로 도착하는가?
- 어떤 `state_changed_by` 기능과 상태 전이가 이 경로를 바꾸는가?
- 시작/진행 중/완료/실패/재시도 같은 lifecycle 자세가 있는가?
- 같은 결과를 만들거나 방해하는 인접 기능은 무엇인가?

맵이 없거나 조회 결과가 없으면 그 사실을 기록하고 현재 코드/스펙에서 재구성한다.
맵을 기대 계약으로 추측하지 않는다. QA 시나리오는 언제나 실제 actor boundary를
운전하고 관찰한 증거로 판정한다.

## 조회 레시피

배포된 스크립트의 경로를 임의로 조합하지 말고, 경로를 인용해 소스 CLI를 실행한다.
도움말을 먼저 읽고 필요한 명령만 선택한다.

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" help
bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" help query
bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" status --project .
```

`status`/`query`/`get`은 API가 계산하는 고정 manifest
`~/.feature-maps/<project-key>/manifest.yaml`만 사용한다. 디렉터리를 훑어
manifest나 파일 위치를 추측하지 않는다.

1. `status` 또는 `query`/`get` 결과가 `status: "not_found"`,
   `reason: "storage_not_configured"`, `next_action: "ask_user_for_storage"`면
   저장 위치를 사용자에게 먼저 묻는다.
2. 사용자가 위치에 동의한 뒤에만 다음처럼 설정한다. 상대 경로는 manifest
   디렉터리 기준이다.

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" configure \
     --location ./docs/features --project .
   ```

3. 다시 `query` 또는 정확한 ID의 `get`을 실행한다. `query`는 `--text TEXT`,
   `--changed-by ID`를 지원한다.

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" \
     query --text inventory --project .
   bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" \
     get stock.view --project .
   ```

결과의 `path`와 `revision`을 함께 기록하고, 매번 최신 결과에서 다시 읽는다.
`reason: "feature_not_found"`는 저장소가 설정되었지만 그 기능 지도가 없는
상태다. 이때는 현재 코드/스펙에서 맥락을 재구성하고, 지도를 제품 사실인 것처럼
채우지 않는다. 잘못된 manifest, 읽을 수 없는 저장소, 손상된 파일은 별도의
런타임 오류다. 기존 설정을 자동 reset하거나 다른 위치로 fallback하지 않는다.

## 지도 읽기와 시나리오 연결

`query`→matching `get`으로 전체 Markdown을 읽은 뒤, 다음 순서로 현재
코드/스펙과 대조한다.

1. 지도에서 목적, source refs, entrypoints, `state_variants`,
   `state_changed_by`, adjacent features를 뽑는다.
2. 각 entrypoint가 현재 코드와 실제 actor boundary에 존재하는지 확인한다.
   사라진 경로는 지도 사실이 아니라 조사 단서로 표시한다.
3. arrival paths, 상태 변경 주체/전이, lifecycle 자세를 빠뜨리지 않았는지
   다시 찾는다. 지도에 없는 경로도 코드/스펙에서 발견하면 시나리오에 넣는다.
4. 기대 계약(스펙/AC)과 observed implementation(코드가 현재 하는 일)을 별도
   메모로 유지한다. 불일치는 실행 전부터 기대 결과로 덮어쓰지 않는다.
5. 각 시나리오는 actor, boundary, 입력/사전상태, 기대 관찰, 실제 관찰,
   evidence ref를 연결한다. 맵의 함수명만 호출한 것은 boundary 증거가 아니다.

맵이 낡았거나 source ref가 현재 트리와 맞지 않으면 현재 코드/스펙과 실행 증거를
우선한다. `validate`가 성공해도 source 존재·최신성은 보장하지 않으므로 agent가
source ref와 entrypoint를 직접 확인한다.

## 문서 형태와 예시

저장소는 기능별 `<id>.md` 하나씩인 flat Markdown이다. 기본 스키마는
`schema_version: 1`, 안전한 소문자 `id`, 비공백 `title`, 비공백 Markdown 본문을
요구한다. `purpose`, `adjacent_features` 같은 확장 필드는 허용되고 round-trip
보존되지만, 스키마가 그 의미나 source 존재를 검증하지는 않는다.

```markdown
---
schema_version: 1
id: stock.view
title: 재고 조회
purpose: 사용자가 보틀별 남은 재고와 부족 상태를 확인하는 여정
source_refs:
  - docs/product/stock.md#재고-조회
entrypoints:
  - id: home-stock-screen
    kind: mobile-screen
  - id: stock-summary-api
    kind: http-endpoint
state_changed_by:
  - bottle.replace
  - dispense.create
state_variants:
  - loading
  - in-stock
  - low-stock
  - empty
adjacent_features:
  - bottle.replace
  - smart-subscription
---

사용자가 홈의 재고 화면에 도착해 보틀별 수량을 확인한다. 보틀 교체와 토출이
상태를 바꾸며, 부족 상태에서 스마트 구독으로 이어질 수 있다.
```

`state_changed_by`는 이 예시와 함께 저장되는 관련 기능 문서의 ID를 가리킨다.
단일 파일만 저장하는 독립 예시라면 dangling reference가 되지 않도록 이 필드를
생략하거나 실제 존재하는 ID로 바꾼다. 필드는 사람이 읽을 목적과 출처를 담되,
구현 세부 함수 목록으로 만들지 않는다.
없는 출처나 경계를 예시처럼 복사하지 말고 현재 프로젝트에 맞게 확인한다.

## 실행 준비와 기록 연결

Feature Map은 기존 QA 절차에 연결한다. 새 프레임워크나 임의 adapter 명령을
만들지 않는다.

- setup/명령 발견: [stage1-commands.md#step-11-discover-project-commands](stage1-commands.md#step-11-discover-project-commands)
- build/test/lint check: [stage1-commands.md#step-12-run-checks](stage1-commands.md#step-12-run-checks)
- application start/reset/verify/stop: [stage3-handson.md#step-32-server--application-lifecycle](stage3-handson.md#step-32-server--application-lifecycle), 특히 [stage3-handson.md#start](stage3-handson.md#start), [stage3-handson.md#stop](stage3-handson.md#stop)
- scenario reset/re-run: [SKILL.md#the-cycle](SKILL.md#the-cycle)와 프로젝트가 문서화한 setup/seed 명령
- actor-boundary evidence: [SKILL.md#evidence-saving-protocol](SKILL.md#evidence-saving-protocol) 및 [stage3-handson.md#adversarial-scenario-matrix](stage3-handson.md#adversarial-scenario-matrix)
- cycle stop/cleanup: [SKILL.md#cleanup](SKILL.md#cleanup) 및 stage3-handson의 lifecycle failure/stop 지침

story를 생성한 뒤, story baseline과 cell 결과를 기록하기 전에 Feature Map
provenance를 기록한다. `get`/`query` 직후의 최신 revision을 사용하고, 반환된
revision은 도구가 현재 값인지 검증한다.

```bash
  bun "${CLAUDE_SKILL_DIR}/scripts/qa-state.ts" record-story-provenance \
  --story STORY_ID \
  --json '{"features":[{"id":"stock.view","revision":"<revision-returned-by-get>","entrypoints":["push"],"states":["new-user"]}],"code_ref":"<commit-or-build-id; include dirty-diff evidence when dirty>"}'
```

이 기록은 QA coverage/current-code discovery를 설명하며 Feature Map metadata의
membership을 선언하지 않는다. 새로 발견한 path도 기록할 수 있다. baseline/cells
이전에 실행하고, 결과가 나온 뒤에는 rebind하지 않는다. 새 fix cycle이면 새
provenance를 다시 기록한다. 맵을 사용할 수 없는 legacy/no-map 실행에서는
feature ID를 꾸며내지 말고 일반 QA evidence에 discovery와 code-ref를 남긴다.

맵의 각 entrypoint/state 기록에는 다음 슬롯을 채운다: `setup`, `start`, `check`,
`reset`, `evidence`, `stop`에 프로젝트가 이미 문서화한 명령 또는
`project-file#section`을 재사용해 연결하고, 관찰한 source ref와 확인한
`code_ref`(commit/build 또는 dirty-diff evidence)를 함께 남긴다. 확인하지 못한
슬롯은 `unknown`으로 남기며 명령을 발명하지 않는다.

## 검증과 선택적 기록

기존 지도를 읽거나 직접 편집한 뒤에는 제공된 검증 명령을 실행한다.

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" \
  validate --project .
```

검증은 front matter, 필수 필드, 본문, 파일명/ID, 중복 ID,
`state_changed_by` dangling reference를 확인한다. source ref의 파일 존재,
URL 유효성, 최신성은 확인하지 않는다.

QA 실행 후 저장은 실제로 확인한 사실만 대상으로 한다. product behavior가
실패했으면 그 실패를 기대 결과로 변환하지 말고, expected와 actual을 별도 기록한다.
증거에는 관찰 위치와 코드/스펙/source 경로를 함께 남긴다.

새 지도를 저장할 때는 먼저 임시 Markdown을 만들고 `--expect new`를 쓴다. 기존
지도를 갱신할 때는 방금 받은 `get`/`query`의 64자리 `revision`을 그대로 쓴다.

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" \
  save --file ./stock.view.md --expect new --project .
bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" \
  save --file ./stock.view.md --expect <revision-from-get> --project .
```

`conflict`면 재시도하지 말고 현재 문서를 다시 `get`해 변경을 reconcile하고,
검증한 뒤 새 revision으로 한 번 저장한다. 절대 blind overwrite하지 않는다.
직접 편집도 가능하지만 편집 후 `validate`를 실행하고, 다음 조회에서는 반환된
절대 경로를 사용한다. 이전 실행에서 외운 경로·revision을 재사용하지 않는다.

Regression recipe는 preconditions, steps, expected, actual, fix/retest evidence,
`code_ref`를 각각 보존한다. 실패한 product behavior를 expected/success로
정상화하거나 숨기지 않는다. known bug 분류는 허용하되 actual, regression,
evidence에 실패 사실을 남기고 기대 계약과 관찰 결과를 분리한다.

## 중단 조건

- 사용자가 저장 위치에 동의하지 않으면 `configure`와 저장을 보류한다.
- storage가 corrupt/unavailable이면 reset·fallback하지 않고 오류와 다음 조사
  단계를 증거에 남긴다.
- 맵이 없거나 stale해도 현재 코드/스펙과 실제 boundary 운전으로 QA를 계속한다.
- 기대 계약과 관찰 결과가 다르면 차이를 기록하고 QA 판정을 그 증거로 결정한다.

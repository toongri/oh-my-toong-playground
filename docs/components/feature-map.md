# Feature Map 컴포넌트 가이드

Feature Map은 기능 하나의 설명과 메타데이터를 평면 Markdown 파일로 저장하고,
CLI와 라이브러리에서 같은 규칙으로 조회·검증·저장하는 작은 저장소다. 정상
파이프라인은 이미 존재하는 맵을 찾고 반환한다. 제품 기능 지도의 자동 작성,
자동 채움, QA 게이트 변경은 이 컴포넌트의 범위가 아니다.

## 배포와 진입점

- CLI 소스는 `scripts/feature-map/feature-map.ts`이며 Claude와 Codex에서 각각
  `$HOME/.claude/scripts/feature-map/feature-map.ts`,
  `$HOME/.codex/scripts/feature-map/feature-map.ts`로 실행된다.
- 공용 라이브러리는 `lib/feature-map` 모듈을 사용한다. 주요 함수는
  `queryFeatureMap`, `getFeature`, `saveFeature`, `validateFeatureMap`,
  `getFeatureMapStatus`, `configureFeatureMap`이다.
- 문서 예시의 `$HOME`은 사용자의 홈 디렉터리다. 소스 코드 경로와 배포 후
  실행 경로를 혼동하지 않는다.

## 프로젝트 키와 manifest

모든 일반 명령은 `--project <directory>`를 받을 수 있다. 프로젝트 키는 공통
Git 디렉터리 정체성을 기준으로 만들며, 형제 worktree는 slug와 hash를 공유하고
별도 clone은 서로 다른 키를 가진다.

상태 탐색과 맵 조회는 API를 통해서만 manifest 위치를 찾는다. 에이전트가
디렉터리를 수동으로 훑어 위치를 추측하거나 직접 manifest를 찾지 않는다.

고정된 manifest 위치는 다음과 같다.

```text
$HOME/.feature-maps/<project-key>/manifest.yaml
```

파일이 없으면 API가 manifest를 자동 생성하고 bootstrap 결과를 반환한다.
bootstrap manifest의 최소 형태는 다음과 같다.

```yaml
version: 1
project: <project-key>
storage: null
```

이 상태는 오류가 아니다. 결과는 `not_found`, `reason:
storage_not_configured`, `next_action: ask_user_for_storage`를 포함해 사용자에게
저장 위치를 먼저 확인하도록 한다. 사용자가 위치를 동의한 뒤에만
`configure --location PATH`를 사용한다. 상대 경로는 manifest 디렉터리를
기준으로 해석한다.

구성된 위치의 YAML이 손상되었거나 위치를 읽을 수 없으면 오류로 보고한다.
기존 상태를 조용히 bootstrap으로 덮어쓰거나 초기화하지 않는다.

## 저장소 형태와 Feature Map 스키마

저장 위치에는 기능별 Markdown 파일이 하나씩 있는 flat 디렉터리를 사용한다.
수동으로 관리하는 별도 인덱스는 만들지 않는다. 숨김 파일은 무시하고,
심볼릭 링크는 거부한다. Feature Map ID는 소문자 ASCII 영숫자 세그먼트를
점(`.`) 또는 하이픈(`-`)으로 연결하며, 파일명은 항상 `<id>.md`다.
파일의 front matter와 본문은 다음 계약을 따른다.

필수 필드:

- `schema_version: 1`
- `id`
- `title`
- 비공백 Markdown 본문

선택 필드:

- `aliases`
- `entrypoints`: `{id, kind}` 객체 목록
- `state_changed_by` (문자열 목록)
- `state_variants`
- `source_refs`

위 목록에 없는 확장 필드는 보존한다. 검증이나 저장 과정에서 알 수 없는
필드를 삭제하거나 재정렬해 의미를 잃게 하지 않는다. `id`와 `title`은 비어
있지 않아야 하고, 본문은 공백만으로 구성될 수 없다. 세부 형식 오류는
`validate`와 저장 전 검증에서 보고한다.

예시:

```markdown
---
schema_version: 1
id: stock.view
title: 재고 조회
aliases: [inventory]
entrypoints:
  - id: web-stock
    kind: route
state_changed_by: [product]
state_variants: [guest, member]
source_refs: [spec-123]
x-team-extension: preserved
---

사용자가 현재 재고를 확인하는 기능이다.
```

## CLI 명령 계약

도움말은 부작용이 없어야 한다. `help`, `--help`, `help <command>`, 인자 없는
실행은 파일 생성·수정·lock 획득·저장 위치 변경을 하지 않는다. 도움말에는
명령 목록, 예시, 출력 형식과 종료 코드를 설명한다.

실행 가능한 도움말 예시는 다음과 같다. 설치된 별도 `feature-map` binary를
가정하지 않고, 배포본 또는 레포 소스를 `bun`으로 직접 실행한다.

```text
bun "$HOME/.codex/scripts/feature-map/feature-map.ts" help
bun scripts/feature-map/feature-map.ts help
```

아래는 명령 usage 표기다. 실제 실행 시에도 같은 인자 규칙을 사용한다.

```text
feature-map help
feature-map --help
feature-map help query
feature-map status [--project <directory>]
feature-map query [--text TEXT] [--changed-by ID] [--project <directory>]
feature-map get <id> [--project <directory>]
feature-map configure --location PATH [--project <directory>]
feature-map save --file <markdown> --expect <new|sha256> [--project <directory>]
feature-map validate [--project <directory>]
```

`status`, `query`, `get`은 먼저 고정된 manifest를 통해 저장소 설정 상태를
확인한다. 저장소가 미설정이면 앞의 bootstrap 결과를 사용한다. 설정된
저장소에서 `query`가 일치 항목을 찾지 못하거나 `get <id>`의 ID가 없으면
`not_found` 및 `reason: feature_not_found`를 반환한다. 두 경우를 서로
바꾸지 않는다.

`query`는 선택한 text와 `changed-by` 조건으로 요약 목록을 반환한다.
`get <id>`는 해당 파일의 전체 Markdown 메타데이터와 본문을 반환한다. query
요약과 get 결과에는 절대 source path와 현재 revision을 포함한다.

`save`는 파일을 읽어 저장하되, API 호출자가 예상 revision을 반드시 제공해야
한다. 새 파일은 `--expect new`, 기존 파일은 해당 revision의 `sha256`을
사용한다. revision이 맞지 않으면 conflict로 실패하며 기존 파일을 덮어쓰지
않는다. lock과 revision 검사는 CLI/API 저장 경로에만 적용된다. 외부 편집기가
직접 파일을 편집할 때 lock을 획득한다고 가정하지 않는다.

`validate`는 schema, 본문, 파일명과 ID의 일치, 중복 ID,
`state_changed_by` 참조를 검사한다. 확장 필드는 별도 검사의 대상이 아니라
검증·저장 과정에서 보존해야 하는 데이터다. 직접 파일을 읽거나 편집한
뒤에도 사용자가 `validate`로 확인할 수 있다.

## 출력과 종료 코드

기계가 읽을 수 있는 결과는 안정적인 필드명과 명시적인 `status`/`reason`을
사용한다. 사람이 읽는 도움말과 오류는 명령의 목적, 문제, 다음 행동을
구분한다.

- `0`: 성공 또는 예상된 not-found 결과
- `1`: 런타임 오류, 유효성 검증 실패, revision conflict
- `2`: 사용법 오류(필수 인자 누락, 알 수 없는 옵션·명령)

오류에서 configured storage를 무시하고 다른 위치를 시도하거나, 손상된
manifest를 새 manifest로 바꾸지 않는다. `next_action`은 사용자가 동의해야
하는 설정 절차처럼 실제로 가능한 다음 행동만 가리킨다.

## 라이브러리 사용 원칙

애플리케이션은 manifest 탐색과 project-key 계산을 직접 복제하지 않고
`getFeatureMapStatus` 및 관련 API를 호출한다. 조회는
`queryFeatureMap`/`getFeature`, 검증은 `validateFeatureMap`, 변경은
`configureFeatureMap`/`saveFeature`를 사용해 CLI와 동일한 오류·revision 계약을
공유한다.

라이브러리도 CLI와 마찬가지로 저장 위치를 자동 발견하거나 새 Feature Map을
자동 생성하지 않는다. 확장 필드는 round-trip으로 보존하고, not-found와
storage-not-configured를 구별해 호출자가 사용자 안내를 선택할 수 있게 한다.

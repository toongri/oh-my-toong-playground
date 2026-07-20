한국어 | [English](knowledge-graph-pins.en.md)

---

# Pins — 공유 지식 그래프 레이어

> oh-my-toong의 지식 계층. 세션마다 발견한 사실을 영구 엔티티로 저장하고, 다음 세션에서 즉시 조회한다.

---

## 개요

코드베이스를 탐색하고 결정을 내리는 과정에서 유용한 사실들이 세션 컨텍스트 안에만 존재하다 사라진다. "이 API의 정식 문서는 어디였더라?", "누가 이 도메인의 권한자였지?" 같은 질문을 다음 세션에서 다시 풀어야 한다.

Pins는 이 문제를 해결하는 **공유 인프라 스킬 패밀리**다. 발견 즉시 엔티티를 기록하고(`pin-record`), 세션 말미에 전체를 회고하여 가치 있는 것만 골라 저장하고(`pin-wrap-up`), 다음 세션에서 조회하고(`pin-query`), 주기적으로 그래프 상태를 점검한다(`pin-audit`). 최초 프로젝트 초기화는 `pin-setup`이 담당한다.

다섯 스킬은 독립적으로도 작동하지만, 함께 사용할 때 단일 지식 그래프 라이프사이클을 이룬다.

---

## 지식 그래프란 무엇인가

Pins의 지식 그래프는 **LLM-위키 스타일 인덱스**다. 정보를 복사하거나 요약하지 않는다. 대신 다음 두 가지를 저장한다.

- **엔티티(Entity)**: 코드 위치, 외부 문서, 결정, 사람, 개념 같은 단일 사실의 서명
- **관계(Relation)**: 엔티티 간 방향 있는 연결 (`{target, type}` 쌍)

각 엔티티는 독립적인 마크다운 파일 `<id>.md`로 저장된다. 엔티티 본문은 원본을 재현하는 게 아니라 원본이 어디 있는지, 왜 기록했는지를 가리키는 **signpost(이정표)**다.

### 설계 철학

| 원칙 | 의미 |
|------|------|
| **인덱싱, 위키 금지** | 핀은 SSOT를 가리킬 뿐, 내용을 복사하지 않는다 |
| **SSOT 복제 금지** | 문서·코드·외부 시스템에 있는 정보는 핀에 넣지 않는다 |
| **본문 간결성** | 섹션당 3-4줄을 넘기면 잘못된 SSOT를 인용하는 신호다 |
| **품질 우선** | 저가치 핀 10개보다 고가치 핀 2개가 낫다 |

---

## 저장 구조

### pins.yaml — 스토리지 매니페스트

프로젝트 루트의 `pins.yaml`은 지식 그래프의 위치와 범위를 선언한다.

```yaml
# pins.yaml — knowledge graph storage manifest
location: ~/.omt/<project>/pins/   # 핀 파일을 저장할 절대 경로
scope: private                     # private | shared
git: true                          # 핀 파일을 git으로 관리할지 여부
```

- `location`: 핀 `.md` 파일들이 실제로 저장될 디렉토리
- `scope`: 매니페스트 수준 기본값. 개별 핀이 `sensitivity` 필드로 재정의 가능
- `git: true`이면 `pin-record`와 `pin-wrap-up`이 기록 후 커밋을 유도한다

모든 pins API(`record`, `query`, `audit` 등)는 `pins.yaml`을 매번 다시 읽지 않는다. `resolveManifest()`로 파싱한 `manifest.location`을 받아 호출된다.

### 엔티티 파일 — `<id>.md`

각 엔티티는 YAML 프론트매터 + 4개 섹션으로 구성된 마크다운 파일이다.

**프론트매터 핵심 필드**

| 필드 | 역할 |
|------|------|
| `id` | `{type}-{topic}-{slug}` 케밥 패턴. 불변 식별자 |
| `type` | 엔티티 종류: `code`, `doc`, `concept`, `reference`, `person`, `decision` |
| `source` | 출처 시스템: `jira`, `linear`, `slack`, `github`, `notion`, `code`, `person`, `url` |
| `authority` | 이 정보의 실질적 권한자 (사람 또는 시스템) |
| `source_url` | 정식 위치 — URL 또는 파일 경로 |
| `tier` | 중요도: `1`(핵심), `2`(참고), `3`(임시) |
| `tags` | CSV 스칼라 (예: `"auth,backend,api"`) |
| `sensitivity` | `private` 또는 `shared` |
| `status` | 라이프사이클 상태: `active`, `superseded`, `stale` |
| `relations` | `[{target, type}]` 배열 — 기본값 `[]` |
| `checked_at` | `reference` 타입의 스테일 감지 기준 타임스탬프 |

**본문 구조 (4개 섹션, 순서 고정)**

```markdown
## 한 줄 요지
(≤80자 요약)

## SSOT 위치
(URL, 파일 경로, 또는 person:name)

## 전후 컨텍스트
(어떤 워크플로우 또는 작업에서 이 사실이 나왔는지)

## 관련 cross-link
(연관 핀 ID 및 관계 이유; 없으면 "없음")
```

---

## 라이프사이클 흐름

```
[최초 설정]     pin-setup    →  pins.yaml 생성
[작업 중]       pin-record   →  발견 즉시 단일 엔티티 기록
[세션 말미]     pin-wrap-up  →  전체 회고 후 가치 있는 것만 기록
[조회]          pin-query    →  type / tags / source 기준 검색
[건강 점검]     pin-audit    →  댕글링 관계, 중복, 스테일 엔티티 탐지
```

SessionStart 훅은 세션 시작 시 기존 핀을 surfacing하여, 이전 세션에서 기록한 맥락이 새 세션에도 이어지게 한다.

---

## 스킬 상세

### pin-setup — 초기화

**언제**: 프로젝트에서 최초로 pins를 사용할 때.

`pins.yaml`을 만들기 위한 3단계 인터뷰를 진행한다.

1. **스토리지 위치**: `~/.omt/<project>/pins/`(홈 디렉토리), `.pins/`(리포 내부), 또는 커스텀 절대 경로 중 선택
2. **범위(scope)**: `private`(개인 전용) 또는 `shared`(팀 공유)
3. **Git 관리 여부**: 위치와 독립적인 설정. `git: true`이면 기록 후 자동 커밋 유도

레거시 핀 파일(`slug` 필드 사용, `type` 없음)이 있다면 `migrate()`를 실행한다. 멱등 연산이므로 재실행은 안전하다.

---

### pin-record — 단일 엔티티 기록

**언제**: 작업 중 지식 그래프에 남길 만한 사실을 발견했을 때.

`lib/pins/record.ts`의 `record(entity, { location })`을 통해 검증 후 `.md` 파일을 쓴다.

**기록 판단 기준 (무엇이 핀 가치가 있는가)**

| 기록 가치 있음 | 기록 불필요 |
|----------------|------------|
| 외부 SSOT 위치 확인 (URL, 파일, 담당자) | 일시적 디버그 출력 |
| 코드에서 ground truth 확인 (file:line) | 코드를 읽으면 자명한 사실 |
| 향후 작업을 제약하는 결정 | 반증된 중간 가설 |
| 특정 도메인 권한자로 지명된 사람 | 수 시간 내 스테일해질 정보 |

**쓰기 동작**

- 유효성 검사 실패 시 `.escape.jsonl`에 추가(`.md` 미작성)
- 신규 기록: `O_EXCL`(`wx`) 플래그로 원자 생성, `status='active'`
- 업데이트(ID가 이미 존재): temp 파일 + `rename`으로 원자 교체. `created_at`은 디스크의 원본값 보존. `updated_at`은 호출자가 명시하지 않으면 자동 갱신되지 않는다.
- `git: true`이면 기록 후 해당 파일 스테이징 및 커밋 유도

**상태 라이프사이클**

엔티티의 `status` 필드는 세 값으로 닫혀 있다.

- `active`: 유효한 상태. 신규 기록의 기본값
- `superseded`: 더 새로운 엔티티로 대체됨. `lib/pins/lifecycle.ts#supersede(oldId, newId, dir)`로 전환
- `stale`: 검증 불가 상태로 기간 초과 판정. `audit`이 탐지, 명확한 후계 없이 처리

---

### pin-query — 조회

**언제**: 기존 핀을 type, tags, source 기준으로 찾을 때.

`lib/pins/query.ts`의 `query(pinsDir, criteria)`를 호출한다. 인덱스 캐시(`index.json`) 없이 매 호출마다 디렉토리를 전량 스캔하여 결과를 생성한다. 아웃고잉 관계가 없는 고아 핀도 검색 결과에 포함된다.

```ts
const results = query(pinsDir, { type: 'code', tags: ['auth'] });
// QueryResult[]: { id, frontmatter }
```

기준을 생략하면 해당 필드는 무제한. 결과는 `id`, `source_url`, 한 줄 요약을 반환한다. 일치 없으면 "no match"를 보고한다.

---

### pin-audit — 그래프 건강 점검

**언제**: 그래프가 일관성을 유지하는지 주기적으로 확인할 때.

`lib/pins/audit.ts`의 `audit(location, { now: new Date() })`를 실행한다. **읽기 전용**. 파일을 쓰거나 수정하지 않는다.

**감지 항목 (우선순위 순)**

| 순위 | 유형 | 심각도 | 의미 |
|------|------|--------|------|
| 1 | `dangling` | error | 관계의 `target` ID가 그래프에 존재하지 않음. 가장 먼저 수정해야 할 구조적 결함 |
| 2 | `duplicate` | error | 두 엔티티의 `source_url`이 동일 |
| 3 | `invalid` | error | 엔티티가 스키마 검사(`validate()`) 실패 |
| 4 | `stale` | error | 티어별 기간 초과: tier1=180일, tier2=90일, tier3=30일. `reference` 타입은 `checked_at`(없으면 `created_at`) 기준 |
| 5 | `orphan` | warning | 아웃고잉 관계 없음. 위반이 아닌 소프트 경고 |

`{ now }` 옵션 생략 시 스테일 감지가 비활성화된다. 스테일 검사를 원한다면 반드시 `{ now: new Date() }`를 전달해야 한다.

보고 방식: error를 먼저, 그 안에서 위 순위대로, orphan은 마지막에 배치한다. `findings`가 비어 있으면 "audit clean"을 보고한다.

---

### pin-wrap-up — 세션 마무리 회고

**언제**: 작업 세션이 마무리될 때, 컨텍스트가 사라지기 전에.

자동 실행이 아닌 **의도적 수동 스윕**이다. 전체 세션을 되돌아보고 기록 가치가 있는 엔티티를 선별한다.

**4단계 프로세스**

1. **스윕**: 세션에서 나온 모든 발견, 결정, 외부 참조, 코드 위치, 지명된 사람, 아키텍처 사실을 훑는다. "미래의 나 또는 동료가 10초 안에 찾을 수 있어야 하는가?"를 기준으로 판단한다
2. **후보 수집**: 기록할 엔티티 목록과 각 이유를 작성하여 사용자에게 제시. 확인 또는 삭제 후 기록 시작
3. **검증 후 기록**: 각 후보를 `validate()`로 먼저 검증. 실패 시 이유를 보고하고 `record()`는 호출하지 않는다. 통과 시 `record()`로 저장
4. **결과 보고**: 기록된 수, ID 목록, 검증 실패 항목과 이유를 보고. `git: true`이면 기록된 파일 커밋 유도

---

## 온-디스커버리 캡처 흐름

Pins의 권장 운용 패턴은 세 단계로 나뉜다.

```
세션 시작  →  SessionStart 훅이 기존 핀을 surfacing
작업 중    →  발견 즉시 pin-record로 단일 엔티티 기록
세션 종료  →  pin-wrap-up으로 전체 회고 후 정제된 엔티티 기록
```

**작업 중 pin-record**와 **세션 말 pin-wrap-up**은 상호 보완적이다. 발견 직후 기록하면 세부 컨텍스트(`전후 컨텍스트` 섹션)가 정확하고, 세션 말 회고는 저가치 항목을 걸러내는 필터 역할을 한다.

---

## 참고 자료

- [README](../../README.md) — 프로젝트 전체 개요
- [핵심 파이프라인 스킬](./core-pipeline.md) — deep-interview / prometheus / sisyphus
- [리뷰 품질 스킬](./review-quality.md) — code-review / design-review
- [리서치 스킬](./research.md) — ultraresearch / insane-browsing
- [저작 스킬](./authoring.md) — technical-writing / humanizer
- [개인 유틸리티 스킬](./utilities-personal.md) — hud / mock-interview

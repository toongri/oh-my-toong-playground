한국어 | [English](review-quality.en.md)

---

# 리뷰 & 품질 스킬

oh-my-toong의 리뷰 & 품질 스킬은 코드·설계·슬라이드에 걸쳐 작업물의 완결성을 체계적으로 검증합니다. 각 스킬은 명확한 검토 대상과 역할 경계를 갖고 있으며, 서로를 호출하거나 조합하여 사용할 수 있습니다.

---

## 핵심 요약

| 스킬 | 역할 한 줄 요약 | 주요 입력 | 언제 사용하나 |
|------|----------------|-----------|---------------|
| `code-review` | PR·diff의 정확성 버그 리뷰 | PR 번호, 브랜치 이름, 또는 현재 브랜치 | 코드 변경 사항을 병합 전에 검토할 때 |
| `orchestrate-review` | 다중 AI 각도-파인더 오케스트레이션 | chunk 프롬프트 (code-review 내부에서 호출) | code-review가 내부적으로 호출 — 직접 호출 거의 없음 |
| `design-review` | 설계·계획의 트레이드오프 긴장 분석 | 설계 질문, 플랜 문서, 아키텍처 고려사항 | 아키텍처 결정 또는 구현 계획을 검토할 때 |
| `slides-review` | HTML 슬라이드 시각 디자인 리뷰 | HTML 파일 경로 | create-slides 후처리 또는 직접 HTML 슬라이드 개선 시 |
| `qa` | 구현 정확성 검증 가디언 | QA REQUEST (Spec + Scope + 검증 방법) | 구현 완료 후 품질을 보증받을 때 |
| `explain-diff` | diff를 교재로 바꾸고 독자 이해를 퀴즈로 측정 | git range (예: `main..HEAD`) | 낯선 PR을 이해해야 하거나, 큰 AI 작성 diff를 사람에게 넘길 때 |

---

## 스킬 상세

### code-review

**목적**: 코드 변경 사항을 병합 전에 정확성 버그 위주로 검토합니다. 단순히 diff를 훑는 것이 아니라, diff가 만들어내는 *시스템 전체*를 리뷰 단위로 삼습니다.

**검토하는 것**:
- 정확성 버그 — 변경된 코드가 주변 시스템과 맞물려 올바르게 동작하는지
- 의존성·호출자·인터페이스·설정·런타임 컨텍스트를 파일 경계를 넘어 추적
- 리뷰 candidate를 CONFIRMED / PLAUSIBLE / REFUTED 세 등급으로 판정
- 검증을 통과한 finding에 orchestrator가 class(`correctness`/`regression`/`cleanup`/`requirement-gap`, 앵글과 1:1)와 impact(`HIGH`/`MEDIUM`/`LOW`, 케이스 목록 + 앵글 기본값)를 배정 — verdict는 신뢰도, impact는 해악을 잼
- 카드 전문(7필드)을 `$OMT_DIR/code-review/<sid>/findings.md`로 영속 — 사후 재판정의 근거
- effort 수준에 따라 단순화·재사용·효율화 항목도 포함 가능

**핵심 원칙** — 두 가지는 협상 불가:
1. **작업 디렉터리 = 변경 후 상태**: 파일 시스템을 읽어 의존성을 추적할 수 있습니다.
2. **diff-only 리뷰 금지**: diff는 변화의 기록, 리뷰 대상은 그 결과물인 시스템입니다.

**호출 방법**:
```
/code-review                      # 현재 브랜치 vs origin/main 자동 감지
/code-review pr 123               # PR 번호
/code-review main feature/auth    # 브랜치 비교
```

**플래그**:
- `--comment` — 발견 사항을 PR 인라인 코멘트로 게시
- `--fix` — 발견 사항을 워킹 트리에 직접 적용

**언제 사용하나**: 코드 변경 사항을 병합 전에 검토할 때. PR이 없는 경우에도 브랜치 비교나 자동 감지 모드로 사용할 수 있습니다.

---

### orchestrate-review

**목적**: `code-review` 내부에서 호출되는 다중 AI 리뷰 오케스트레이터입니다. 각기 다른 검토 렌즈(angle)를 가진 AI 파인더들을 병렬로 fan-out하고, 각자의 candidate 발견 목록을 받아 하나의 중복 제거된 후보 목록으로 합칩니다.

**검토하는 것**:
- 4개 앵글로 분담 — `correctness`(정확성·공격 가능성, 구 line-scan·cross-file·security 흡수) · `regression`(회귀) · `cleanup`(정리와 가벼운 Test value 관점) · `requirement`(AC 매핑 또는 의도 추론, 구 coverage 흡수)
- 각 파인더가 독립적으로 발견한 candidate를 각도별로 수집
- 중복 제거 및 집계 — 판정(CONFIRMED/PLAUSIBLE/REFUTED)은 하지 않음
- 상위 `code-review`에 판정 대상 후보 목록 반환

**정적 검토 전용**:
- 멤버, 컨덕터, 그리고 in-session fallback은 모두 정적 검토만 합니다. 테스트·빌드·린터·설치·프로젝트 코드를 실행하지 않습니다.
- 후보는 diff, 소스 읽기, 검색으로 뒷받침합니다. 정적으로 판단할 수 없는 부분은 실행으로 해소하지 않고 불확실성 또는 커버리지 한계로 드러냅니다.
- 컨덕터의 orchestration lifecycle 명령(`job.ts`의 `start`·`collect`·`resume-member`·`results`·`stop`·`clean`, `usage-summary.ts`)은 계속 사용할 수 있습니다. fallback에도 정적 검토 제한은 그대로 적용됩니다.

**역할 경계**:
- "컨덕터이지 리뷰어가 아닙니다" — 코드를 직접 읽거나, 심각도를 부여하거나, 병합 여부를 판단하지 않습니다.
- 파인더가 모두 불가능한 경우(설정 없음·CLI 미설치·타임아웃) in-session fallback으로 직접 파인더 역할을 수행합니다.
- `requirement`는 제공된 AC를 매핑하고, AC가 없으면 diff에서 의도를 추론하는 역할만 맡습니다.
- `cleanup`은 Test value를 가볍게 살핍니다. 거짓 신뢰·가짜 커버리지, 검증 가치 대비 피드백 루프 비용, 구현 결합적이거나 불안정한 테스트를 다루며, 점수화 기준은 아닙니다.

**실행 제한 적용**:
- 프롬프트 계약과 전용 Claude/Codex PreToolUse 가드 쌍(`review-exec-guard.sh` / `codex-review-exec-guard.sh`)이 함께 적용합니다. 두 가드는 공유 shell 불변식으로 같은 고비용 명령을 판정합니다.
- JVM 경계에서는 basename이 `gradle`, `gradlew`, `mvn`, `mvnw`인 호출만 대상으로 하며, 열거된 고비용 Gradle task와 Maven phase만 차단합니다. Gradle은 `test`(qualified/suffixed 포함), `build`, `check`, `assemble*`, `compile*`, `classes`, `lint*`, `ktlint*`, `detekt*`를, Maven은 `compile`, `test-compile`, `test`, `integration-test`, `package`, `verify`, `install`, `ktlint:check`, `detekt:check`를 차단합니다.
- `ktlint`, `detekt`, `kotlinc`, `javac`의 직접 lint/컴파일 실행과 `java`, `kotlin`의 프로젝트 코드 런타임 실행도 차단합니다. 반대로 열거되지 않은 Gradle/Maven 호출은 기본적으로 허용하며, 순수한 help/metadata 조회와 version 조회만 특별히 조회 예외로 취급합니다. 조회와 실행을 섞은 호출은 예외가 아닙니다.
- 이 조회 예외는 무비용 또는 순수 정적 작업이라는 뜻이 아닙니다. Gradle/Maven 조회도 프로젝트를 설정하거나 플러그인·의존성을 해석하고 접근할 수 있으므로, 정적 검토에서 의도적으로 남겨 둔 좁은 사용성 예외입니다.
- 워커는 `OMT_REVIEW_ROLE=member`를 받아 멤버 검토 컨텍스트를 표시합니다. 컨덕터는 job 메타데이터의 `conductorSessionId`와 살아 있는 job 디렉터리로 검토 컨텍스트가 확인될 때만 적용 대상이 됩니다.
- 따라서 이 제한은 검토 컨텍스트에서만 활성화됩니다. 같은 고비용 명령도 일반 개발 세션에서는 이 가드에 의해 차단되지 않습니다.

**프로세스 정리**: 각 파인더는 별도 워커 프로세스로 실행되며, 워커 자신의 종료 경로·job 정리(`clean`)·새 세션 시작 시 회수라는 세 가지 경로로 그 프로세스를 거둡니다. 다만 뒤의 두 경로는 그 프로세스 그룹이 이 job의 것임을 확인할 수 있을 때만 신호를 보내므로, 컨덕터가 정리 단계에 도달하지 못해도 나머지 경로가 항상 뒤를 받쳐주는 것은 아닙니다. 워커가 기동할 수 있는 MCP 서버도 설정 파일의 화이트리스트(`mcps.allow`)로 제한되며, 화이트리스트를 지정하지 않으면 이 엔진이 열거하는 서버가 모두 차단됩니다(opt-in, fail-closed). 같은 `settings:` 블록의 형제 설정인 `deny.skills`(리뷰 워커가 호출할 수 없는 스킬을 지정하는 설정)는 기본값 방향이 정반대여서, 지정하지 않으면 아무것도 차단하지 않습니다(no-op). 워커가 서브에이전트를 스폰하는 능력은 같은 블록의 `deny.subagents: true`가 끕니다 — job을 dispatch하는 스킬 4종(orchestrate-review·design-review·diagnose·agent-council)이 모두 켜 두었으며, 멤버 CLI별로 번역됩니다(codex는 `agents.enabled=false`, claude는 스폰 툴 permission deny, opencode는 `permission.task: deny`). 두 축 중 하나라도 선언한 채 집행 레버가 없는 CLI(gemini·미인식)를 멤버로 두면 `start`가 job 디렉터리를 만들기 전에 exit 1로 막습니다.

**언제 사용하나**: 대부분의 경우 `code-review`가 내부적으로 호출하므로 직접 호출할 일은 거의 없습니다. 커스텀 멀티-AI 리뷰 파이프라인을 설계할 때는 직접 연결할 수 있습니다.

---

### design-review

**목적**: 설계안·계획서·아키텍처 결정에 대한 자문 역할을 합니다. 강점을 인정하면서도 가장 강력한 반론(steelman antithesis)을 세워 트레이드오프 긴장을 드러냅니다. 판정 게이트가 아닌 *자문 채널*입니다.

**검토하는 것**:
- 트레이드오프 긴장 및 숨겨진 비용
- 설계가 간과한 대안적 접근
- 아키텍처적 고려사항 — 경계, 의존성, 확장성
- 반론을 최대한 강하게 세운 뒤 그에 대한 카운터도 제시

**워크플로우**: 기본적으로 Codex `gpt-5.6-sol`(`high` reasoning) 멤버에게 job을 dispatch하여 분석을 받습니다. `generic-job`은 멤버 실행 시 `settings.deny`와 `settings.mcps.allow`를 함께 집행합니다. MCP allowlist는 opt-in·fail-closed이며, 현재 `design-review.config.yaml`은 `codegraph`만 허용합니다. 멤버를 사용할 수 없는 경우(`missing_cli`, 타임아웃, 설정 없음) in-session fallback으로 직접 분석합니다.

**언제 사용하나**: 아키텍처 결정, 구현 계획 검토, 트레이드오프 분석이 필요할 때. 트리거 키워드: "design review", "plan review", "설계 검토", "플랜 리뷰", "아키텍처 건전성", "트레이드오프 분석".

---

### slides-review

**목적**: HTML 슬라이드 파일의 시각 디자인 품질을 Gemini CLI로 검토하고, 반환된 개선 지침을 메인 세션(Claude)이 직접 CSS/HTML에 적용합니다.

**검토하는 것**:
- 시각 디자인 완성도 — 레이아웃, 타이포그래피, 컬러, 여백
- 디자인 경로(frontend-design 등)에 맞는 방향성 유지
- 호출자가 지정한 보호 규칙(수정 금지 항목) 준수 여부

**호출 패턴**:
- **다른 스킬에서 호출**: `create-slides` 등의 후처리 단계로 자동 연결
- **사용자 직접 호출**: HTML 파일 경로를 제공하면 즉시 리뷰 시작

**언제 사용하나**: HTML 슬라이드를 생성한 후 시각적 완성도를 높이고 싶을 때. Gemini CLI가 없거나 실패해도 in-session fallback으로 리뷰를 제공합니다. 트리거 키워드: "디자인 리뷰", "slides review", "슬라이드 리뷰", "gemini review".

---

### qa

**목적**: 구현 정확성을 검증하는 품질 보증 가디언입니다. 이 스킬은 "아무것도 증명 없이 출시되지 않는다"는 원칙 아래 동작합니다.

**사이클**: PRE-FLIGHT(계약 게이트) → PLAN(액터 로스터 + 시나리오 도출) → BASELINE(빌드·테스트·린트) → ADVERSARIAL E2E(실제 구동 + 6개 커버리지 축) → CHECK → 실패 시 DIAGNOSIS→FIX→RE-VERIFY 루프(최대 5회) → EXIT → CLEANUP → ROLLBACK → STATE. 한 번의 호출이 탐지부터 수정·재검증까지 전부 소유하며, 수정자(`sisyphus-junior`)는 자기 수정을 인증하지 못합니다. 7–9번은 stale-state·dirty-worktree·flaky-rerun **실행 단위 점검**으로 별도 기록합니다.

**강제되는 기록 사슬**: PLAN에서 액터 로스터를 고정한 뒤 액터마다 스토리를 만들고, 각 스토리에서 6개 커버리지 축과 `hang-timeout`(1번 축), `flaky-green`(5번 축) 하위 셀을 파생합니다. 셀의 공격 지점·우선순위와 baseline·셀·실행 단위 결과를 상태 CLI에 기록해야 다음 단계로 진행할 수 있습니다. 이 사슬의 완결성·참조 무결성·현재 사이클 증거는 phase funnel과 Claude/Codex Stop 게이트가 검사하며, 로스터가 없거나 BASELINE 이후 기록이 비어 있으면 드라이버도 차단합니다(PLAN 도달성 탐색은 허용).

**종료와 예외**: `APPROVE`/`COMMENT`는 모든 필수 기록과 증거가 predicate를 통과해야 하며, `REQUEST_CHANGES`는 정직한 실패 기록 또는 실제 실행 전 fail-fast에 열려 있습니다. 셀 waive는 사유가 필요한 사용자 전용 명령이고 AI 경로에서 거부됩니다. `qa-state-*.json` 직접 쓰기도 차단되며, `set-verdict` → HTML report → `complete` 순서로 상태를 닫은 뒤에만 결과를 보고합니다. Codex는 자체 시드 훅으로 같은 상태 파일과 런타임 게이트를 확보합니다.

**액터 경계 원칙**: 시나리오를 쓰기 전에 먼저 **Actor Roster**를 고정합니다 — 액터 · 그 액터가 실제로 손대는 경계(화면·엔드포인트·CLI 명령) · 그 경계에 닿는 드라이버 · 도달 가능 여부. 함수·클래스·내부 모듈은 경계가 아닙니다. **직접 작성한(self-authored)** 시나리오는 모두 액터의 경계에서 진입해 실행하고, 경계에 도달할 수 없으면 **닿지 않는 마지막 홉만 fake로 대체**해 그 위 계층은 전부 실행합니다. 그것마저 불가능하면 PASS가 아니라 `NOT-RUN`이며, `H` 우선순위 시나리오가 `NOT-RUN`으로 남으면 APPROVE가 막힙니다. **호출자가 준(caller-provided)** 시나리오는 이 재배치에서 면제되어 호출자가 고른 계층 그대로 verbatim 실행하지만, 공개 의무까지 면제되지는 않습니다 — 실제 진입한 계층을 `driven-at`에 기록하고 그 위 계층에 대해서는 아무것도 주장하지 않습니다.

**제품 유스케이스 폭**: 시나리오는 위험 축만으로 파생되지 않습니다. 변경된 화면 주변 코드(네비게이션·딥링크/푸시 핸들러·그 화면 데이터의 작성자)를 읽어 제품-맥락 지도를 스스로 구축한 뒤, 세 축 — 도착 경로(딥링크·푸시 진입 포함), 인접 상태 전이(토출이 재고를 차감하듯 다른 기능이 이 화면의 데이터를 바꾸는 흐름), 라이프사이클(온보딩 직후·일상 사용·정비 직후) — 을 걸어 실사용을 닮은 멀티스텝 시나리오를 파생하고, coverage delta에 세 축의 커버 여부를 명시합니다.

**전제조건 부트스트랩**: 경계를 "도달 불가"로 선언하는 것은 부트스트랩 사다리를 소진한 뒤에만 가능합니다 — 배포 안 된 환경은 로컬 풀스택 기동으로, 없는 데이터는 시드 생성으로, 없는 계정은 회원가입 실행이나 테스트 토큰 주입으로, 다른 플랫폼에서만 채울 수 있는 선행조건은 그 플랫폼도 함께 띄워 실제로 채우는 것으로 해결합니다. 통제 밖의 진짜 외부 의존성만이 fake 대체의 대상입니다. 단, QA 대상이 배포 자체(릴리스·배포 설정·라우팅·마이그레이션·패키징 아티팩트)인 경우에는 배포 환경이 곧 경계이므로, 그곳의 404는 우회할 전제조건이 아니라 검증 대상의 실패로 처리하며 로컬 스택은 배포 아티팩트에 대해 아무것도 증명하지 않습니다. 변경이 발생한 플랫폼만 QA하지 않습니다 — 액터가 변경을 관찰하는 모든 플랫폼과 선행조건을 쥔 플랫폼이 전부 로스터에 오릅니다.

**증거**: 실행된 시나리오마다 액터 관점의 `before` / `action` / `after` 증거를 남깁니다 — 액터가 실제로 관찰하는 상태여야 하며, 앱 기동·스플래시·랜딩 화면 캡처는 시나리오 증거가 아닙니다. 서버 로그·DB 행 같은 내부 신호는 보조 증거일 뿐 대체물이 아닙니다.

**HTML 리포트 사실성**: STATE 리포트는 `qa-state` 기록을 그대로 렌더합니다. 보조 `before`·`action`·`after` 슬롯이 없는 하위 호환 레코드는 필수 `evidence.path`를 Scenario Evidence의 기록 증거 슬롯으로 표시하며, 새 `start`는 `acceptance_criteria`를 비워 이전 사이클 기준을 상속하지 않습니다. `Failures & Mismatches`에는 FAIL 셀뿐 아니라 실패한 baseline과 stale-state·dirty-worktree·flaky-rerun 실행 단위 점검도 기록된 note와 함께 표시하며, waiver 대상은 `story/cls/sub`까지 식별합니다. 브라우저 도구 설치는 checked worktree 밖 ephemeral 디렉터리를 우선 사용하고, 대상 manifest·lockfile·`node_modules`를 CHECK 전에 복구·재검증합니다.

**핵심 구분**: 자동화 테스트와 hands-on QA는 대체 관계가 아닙니다. 자동화는 "코드가 의도대로 동작하는가"를, hands-on은 "액터의 경로가 프로덕션처럼 동작하는가"를 각각 검증합니다. 서로 다른 깊이에서 모은 증거는 합쳐도 더 깊은 주장이 되지 않습니다.

**호출 방식**: `sisyphus`가 조율하는 파이프라인에서 구현 완료 후 QA REQUEST를 전달하여 호출하거나, 사용자가 직접 검증을 요청할 때 사용합니다.

**언제 사용하나**: 구현이 끝났고, 그 결과물이 명세를 충족하는지 독립적으로 검증받고 싶을 때.

---

### explain-diff

**목적**: 코드 변경을 **이해시키는** 스킬입니다. code-review가 "이 diff에 버그가 있는가"를 묻는다면, explain-diff는 "이 diff를 읽는 사람이 실제로 이해했는가"를 묻습니다. 완료 조건이 문서가 아니라 사람이라는 점이 이 스킬의 전부입니다 — 설명 문서를 다 썼다고 끝나지 않고, 독자가 서술형 퀴즈를 통과해야 끝납니다.

**여덟 스텝**: `evidence`(변경 파일을 signal/noise로 분류) → `background`(깊은 배경 + 좁은 배경 2단, 이미 아는 독자를 위한 건너뛰기 마커 포함) → `architecture`(시스템·컴포넌트·도메인 3레벨 구조를 mermaid로 — 각 레벨은 다이어그램 또는 사유 있는 생략 마커). 다이어그램이 하나도 없고 세 레벨 모두 사유 있는 생략 마커면 R12를 충족할 수 있지만, 심사자 인용에 세 waiver 문장이 모두 있어야 하며, 다이어그램이 하나라도 있으면 식별자와 변경 표시 근거가 필요합니다 → `intuition`(toy 값 예시 + 승인된 컴포넌트로 감 잡기) → `commits`(커밋이 쌓인 순서의 서사 — 모든 해시가 Commit Journey 헤딩과 대조됨) → `code`(Change Group 단위 코드 해설) → `render`(현재 Markdown으로 다시 생성된 mermaid 인라인 SVG 자기완결 HTML + technical-writing 후 최종 HTML의 visual-qa 검증 리포트) → `quiz`(서술형 출제·채점). 문서의 시각 언어는 템플릿(`references/markdown-template.md`)과 render.ts가 소유하며, 실제 문서의 `<style>`·인라인 `style=`·미승인 class는 구조 검사(R11)가 거부하지만 코드 펜스와 인라인 코드 예시는 제외합니다.

**문서 형식 계약**: 각 스텝은 그 스텝이 채워야 할 슬롯만 검사받습니다 — `evidence`는 signal 파일이 문서 어딘가에 전부 등장하는지, `background`는 깊은/좁은 배경 2단과 건너뛰기 마커, `goal`은 `## 목표` 섹션의 `### 무엇을·왜`·`### 핵심` 두 슬롯(코드 전에 목적·핵심 한 줄을 먼저 전달, R16), `code`는 Change Group의 제목·예고·순서 근거 3슬롯 + 모든 "왜 필요한가"의 출처 표시(`[근거: "…"]` / `[추론: …]` / `Unknown / not supplied`) + 파일별 `base:`/`head:` 양쪽 위치 + signal 파일이 Change Group에 정확히 한 번씩 들어갔는지(evidence에서는 "등장"만 보지만 code에서는 "정확히 한 번"까지 봅니다)를 스크립트가 판정합니다(`lib/explain-diff-structure.ts`). 심사자는 `architecture` 스텝의 R12, `intuition` 스텝의 구체 예시(R6), `code` 스텝의 Change Group 순서 정합(R7) 세 항목만 보고, 나머지 여섯 스텝은 필수 심사 항목이 없어 빈 배열로 통과합니다. R12는 다이어그램이 있으면 식별자 실재성과 변경 표시 근거를(시스템 레벨은 인-프로세스 콜체인이 아닌 실제 프로세스·서비스 경계여야 하며, 맥락 노드는 허용), 다이어그램이 없으면 세 레벨의 사유 있는 waiver를 모두 요구하며, 해당 근거를 담은 심사자 인용이 필수입니다. 심사자가 "통과"라고 하면서 인용을 붙이지 않거나, 붙인 인용이 문서에 문자열로 존재하지 않으면 자동 실패입니다. `render` 스텝은 이 구조 검사 대신 산출물 검사를 받습니다 — HTML의 존재·비어있지 않음, 현재 Markdown으로 다시 생성된 HTML인지, mermaid 펜스가 전부 인라인 SVG로 렌더됐는지(mmdc 사전 렌더), technical-writing 뒤 최종 HTML의 visual-qa 리포트(`VERDICT: PASS`)와 technical-writing 리포트(`REVIEW: APPLIED`) 2종이 각각 마지막 비공백 줄로 끝나는지입니다. 이전 Markdown에서 만든 stale HTML과 과거 통과 표식 뒤에 미해결 항목이 붙은 리포트는 거부됩니다.

**3층 강제 게이팅**: (1) 상태 CLI(`explain-diff-state.ts`)가 상태 파일의 유일한 writer이고, (2) PreToolUse 아티팩트 가드가 `$OMT_DIR/explain-diff/` 쓰기를 막으며, (3) Stop 게이트가 퀴즈 통과 전 세션 종료를 막습니다. 상태가 없으면 먼저 `explain-diff-state.ts start --range "<git range>" --slug "<slug>"`를 실행해 복구합니다. 활성 상태의 idle TTL은 6시간, terminal 상태의 TTL은 30분입니다. 아티팩트 가드는 OMT의 다른 가드와 반대로 **fail-closed** 입니다 — 상태가 없거나 만료됐거나 `jq`가 없으면 거부합니다. 이 반전은 그 디렉터리 하나에만 적용되고 나머지 경로는 전부 fail-open으로 남습니다.

**퀴즈 면제는 없습니다**: 시간 압박·사용자 요청·재시도 소진·"문서만 필요함" 어느 사유로도 퀴즈를 건너뛰고 완료 상태에 도달할 수 없습니다. 필수 개념이 하나도 등록되지 않은 상태도 완료로 치지 않습니다(빈 집합의 공허참 차단). 같은 항목이 문서 변경 없이 두 번 연속 틀리면 `stalled`로 표시되어 사용자만 풀 수 있는 교착으로 넘어갑니다.

**호출 방식**: 사용자가 명시적으로 `$explain-diff`를 호출합니다(`disable-model-invocation: true` — 모델이 스스로 발동하지 않습니다). Claude SessionStart는 실제 진행된 non-pristine 세션만 복원 배너로 되살립니다. 초기 pristine `evidence` 시드는 복원이나 진행 중인 세션으로 보지 않습니다. Codex의 `UserPromptSubmit` 훅은 명시적인 `$skill` 멘션을 해석해 가장 가까운 project-local protected skill을 먼저, 없으면 global protected skill을 찾아 전체 `SKILL.md`를 trusted `additionalContext`로 주입합니다. 범용 호출 마커는 invocation audit/integrity record일 뿐 authorization이 아니며, PreToolUse gate는 마커의 존재·위조 여부와 무관하게 `disable-model-invocation: true`인 `SKILL.md`의 리터럴 경로 직접 읽기를 항상 거부합니다. 현재 세션의 `codex-skill-invocation-marker-<sid>-*` namespace는 PreToolUse write guard의 best-effort 리터럴 경로 보호도 받습니다. 전용 explain-diff seed는 프롬프트 멘션만 처리하며 파일 열람으로는 시드하지 않습니다.

**언제 사용하나**: 낯선 PR을 리뷰하기 전에 먼저 이해해야 할 때, 히스토리를 따라 서브시스템에 온보딩할 때, 큰 AI 작성 diff를 사람에게 넘길 때.

---

## 스킬 선택 가이드

```
리뷰 대상이 무엇인가?
  |-- 코드 변경 (PR/브랜치) -> code-review
  |-- 설계·아키텍처 계획  -> design-review
  |-- HTML 슬라이드       -> slides-review
  |-- 구현 완료, 품질 보증 -> qa

먼저 이해부터 해야 한다면:
  |-- 코드 변경을 사람에게 이해시켜야 함 -> explain-diff (그 다음 code-review)

code-review를 실행하면:
  내부에서 orchestrate-review가 다중 AI 파인더를 조율합니다.
  orchestrate-review를 직접 호출할 필요는 거의 없습니다.
```

---

## 참고 자료

- [README](../../README.md) — 프로젝트 개요
- [핵심 파이프라인 스킬](./core-pipeline.md) — prometheus, sisyphus, sisyphus-junior
- [리서치 스킬](./research.md) — ultraresearch, insane-browsing
- [저작 스킬](./authoring.md) — 문서·슬라이드 생성
- [지식 그래프 & Pins](./knowledge-graph-pins.md) — Graphiti, Pin 스킬
- [유틸리티 & 개인화](./utilities-personal.md) — 설정, 단축키, 기타

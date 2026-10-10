한국어 | [English](review-quality.en.md)

---

# 리뷰 & 품질 스킬

oh-my-toong의 리뷰 & 품질 스킬은 코드·설계·슬라이드에 걸쳐 작업물의 완결성을 체계적으로 검증합니다. 각 스킬은 명확한 검토 대상과 역할 경계를 갖고 있으며, 서로를 호출하거나 조합하여 사용할 수 있습니다.

---

## 핵심 요약

| 스킬 | 역할 한 줄 요약 | 주요 입력 | 언제 사용하나 |
|------|----------------|-----------|---------------|
| `code-review` | PR·diff의 정확성 버그 리뷰. 내부적으로 다중 AI 각도-파인더 job을 직접 dispatch | PR 번호, 브랜치 이름, 또는 현재 브랜치 | 코드 변경 사항을 병합 전에 검토할 때 |
| `design-review` | 설계·계획의 트레이드오프 긴장 분석 | 설계 질문, 플랜 문서, 아키텍처 고려사항 | 아키텍처 결정 또는 구현 계획을 검토할 때 |
| `slides-review` | HTML 슬라이드 시각 디자인 리뷰 | HTML 파일 경로 | create-slides 후처리 또는 직접 HTML 슬라이드 개선 시 |
| `qa` | 구현 정확성 검증 가디언 | QA REQUEST (Spec + Scope + 검증 방법) | 구현 완료 후 품질을 보증받을 때 |
| `explain-diff` | diff를 교재로 바꾸고 독자 이해를 퀴즈로 측정 | git range (예: `main..HEAD`) | 낯선 PR을 이해해야 하거나, 큰 AI 작성 diff를 사람에게 넘길 때 |

---

## 스킬 상세

### code-review

**목적**: 코드 변경 사항을 병합 전에 정확성 버그 위주로 검토합니다. 단순히 diff를 훑는 것이 아니라, diff가 만들어내는 *시스템 전체*를 리뷰 단위로 삼습니다. 후보 발견은 별도 오케스트레이션 스킬을 거치지 않고 code-review 자신이 소유한 다중 AI 각도-파인더 엔진(`skills/code-review/scripts/`)으로 직접 조달합니다.

**검토하는 것**:
- 정확성 버그 — 변경된 코드가 주변 시스템과 맞물려 올바르게 동작하는지
- 의존성·호출자·인터페이스·설정·런타임 컨텍스트를 파일 경계를 넘어 추적
- 리뷰 candidate를 CONFIRMED / PLAUSIBLE / REFUTED 세 등급으로 판정
- 검증을 통과한 finding에 class(`correctness`/`regression`/`cleanup`/`requirement-gap`, 앵글과 1:1)와 impact(`HIGH`/`MEDIUM`/`LOW`)를 배정합니다. impact는 발생했을 때의 순수한 해악만 나타내며 class·앵글, 발생 가능성·노출도, 패치 크기·유지보수 비용을 대리값으로 쓰지 않습니다.
- 최종 priority(`HIGH`/`MEDIUM`/`LOW`)는 실제 발생 가능성·노출도·해악을 최소 remedy가 만드는 영구적 복잡성·유지보수 부담·회귀 위험과 비교해 정합니다. 구현 난이도나 작업량만으로 priority를 낮추지 않습니다.
- `COMPLETE`의 모든 finding에는 비어 있지 않은 `assessment` 다섯 필드(`unfixed_cost`, `exposure`, `remedy`, `added_cost`, `rationale`)가 필요합니다. 리뷰어가 모든 후보를 직접 검증하며, 숫자 confidence나 verifier 하위 에이전트를 사용하지 않습니다.
- 카드 전문(7필드)을 `$OMT_DIR/code-review/<sid>/findings.md`로 영속 — 사후 재판정의 근거
- effort 수준에 따라 단순화·재사용·효율화 항목도 포함 가능

**핵심 원칙** — 두 가지는 협상 불가:
1. **작업 디렉터리 = 변경 후 상태**: 파일 시스템을 읽어 의존성을 추적할 수 있습니다.
2. **diff-only 리뷰 금지**: diff는 변화의 기록, 리뷰 대상은 그 결과물인 시스템입니다.

**다중 AI 각도-파인더 job**: code-review는 리뷰 가능한 diff 전체를 스코프로 삼는 **단일 파인더 job**을 dispatch합니다. 이전에는 큰 diff를 chunk로 나눠 별도 오케스트레이션 스킬(`orchestrate-review`, 폐지됨)이 컨덕터로 조율했지만, 지금은 diff 크기와 무관하게 청킹이나 별도 컨덕터 단계 없이 리뷰 가능한 파일 집합 전체가 항상 하나의 job으로 들어갑니다.

- **4개 앵글로 분담** — `correctness`(정확성·공격 가능성, 구 line-scan·cross-file·security 흡수) · `regression`(회귀) · `cleanup`(정리와 가벼운 Test value 관점) · `requirement`(AC 매핑 또는 의도 추론, 구 coverage 흡수). 각 앵글은 하나의 finder job 안에서 병렬로 fan-out되는 별도 CLI 호출이며, 각자 독립적으로 candidate를 수집합니다 — 판정(CONFIRMED/PLAUSIBLE/REFUTED)은 하지 않고, code-review 자신의 검증 단계로 넘깁니다.
- **중립 publisher** — 구조화된 publisher는 원본 `CodeReviewArtifact` JSON을 그대로 저장하고 transport receipt만 반환합니다. caller, ultragoal, priority·scope·수리·완료·예산·승인 정책을 알거나 결정하지 않으며, producer에 ultragoal 전용 동작을 추가하지 않습니다.
- **오버사이즈 diff는 단일 패스 + 안내 문구** — `reviewableInsertionLines ≥ 2000` 또는 `reviewableFileCount ≥ 30`이면 청크로 쪼개는 대신 리포트 첫 줄에 "단일 패스로 리뷰했으며 이 정도 규모에서는 커버리지가 불완전할 수 있으니 리뷰를 더 작게 나누는 것을 고려하라"는 안내 한 줄만 덧붙입니다. 이 안내는 finding도 class도 게이트도 아니며 판정·순위·완료 여부에 영향을 주지 않습니다.
- **정적 검토 전용** — 파인더와 in-session fallback 모두 테스트·빌드·린터·설치·프로젝트 코드를 실행하지 않습니다. 후보는 diff, 소스 읽기, 검색으로만 뒷받침하며, 정적으로 판단할 수 없는 부분은 실행으로 해소하지 않고 불확실성 또는 커버리지 한계로 드러냅니다. job의 lifecycle 명령(`job.ts`의 `start`·`collect`·`resume-member`·`results`·`stop`·`clean`, `usage-summary.ts`)은 계속 사용할 수 있습니다.
- **파인더가 모두 불가능한 경우**(설정 없음·CLI 미설치·타임아웃) in-session fallback으로 code-review 자신이 직접 파인더 역할을 수행합니다. fallback에도 정적 검토 제한은 그대로 적용됩니다.
- `requirement`는 제공된 AC를 매핑하고, AC가 없으면 diff에서 의도를 추론하는 역할만 맡습니다.
- `cleanup`은 Test value를 가볍게 살핍니다. 거짓 신뢰·가짜 커버리지, 검증 가치 대비 피드백 루프 비용, 구현 결합적이거나 불안정한 테스트를 다루며, 점수화 기준은 아닙니다.

**정적 검토 지침**: 위 정적 검토 원칙은 code-review 파인더와 in-session fallback이 따르는 프롬프트 정책입니다.

**프로세스 정리**: 각 파인더는 별도 워커 프로세스로 실행되며, 워커 자신의 종료 경로·job 정리(`clean`)·새 세션 시작 시 회수라는 세 가지 경로로 그 프로세스를 거둡니다. 다만 뒤의 두 경로는 그 프로세스 그룹이 이 job의 것임을 확인할 수 있을 때만 신호를 보내므로, 컨덕터가 정리 단계에 도달하지 못해도 나머지 경로가 항상 뒤를 받쳐주는 것은 아닙니다. 워커가 기동할 수 있는 MCP 서버도 설정 파일의 화이트리스트(`mcps.allow`)로 제한되며, 화이트리스트를 지정하지 않으면 이 엔진이 열거하는 서버가 모두 차단됩니다(opt-in, fail-closed). 같은 `settings:` 블록의 형제 설정인 `deny.skills`(리뷰 워커가 호출할 수 없는 스킬을 지정하는 설정)는 기본값 방향이 정반대여서, 지정하지 않으면 아무것도 차단하지 않습니다(no-op). 워커가 서브에이전트를 스폰하는 능력은 같은 블록의 `deny.subagents: true`가 끕니다 — job을 dispatch하는 스킬 4종(code-review·design-review·diagnose·agent-council)이 모두 켜 두었으며, 멤버 CLI별로 번역됩니다(codex는 `agents.enabled=false`, claude는 스폰 툴 permission deny, opencode는 `permission.task: deny`). 두 축 중 하나라도 선언한 채 집행 레버가 없는 CLI(gemini·미인식)를 멤버로 두면 `start`가 job 디렉터리를 만들기 전에 exit 1로 막습니다.

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

### design-review

**목적**: 설계안·계획서·아키텍처 결정에 대한 자문 역할을 합니다. 강점을 인정하면서도 가장 강력한 반론(steelman antithesis)을 세워 트레이드오프 긴장을 드러냅니다. 판정 게이트가 아닌 *자문 채널*입니다.

**검토하는 것**:
- 트레이드오프 긴장 및 숨겨진 비용
- 설계가 간과한 대안적 접근
- 아키텍처적 고려사항 — 경계, 의존성, 확장성
- 반론을 최대한 강하게 세운 뒤 그에 대한 카운터도 제시

**워크플로우**: 기본적으로 Codex `gpt-6-astra`(`high` reasoning) 멤버에게 job을 dispatch하여 분석을 받습니다. `generic-job`은 멤버 실행 시 `settings.deny`와 `settings.mcps.allow`를 함께 집행합니다. MCP allowlist는 opt-in·fail-closed이며, 현재 `design-review.config.yaml`은 `codegraph`만 허용합니다. 멤버를 사용할 수 없는 경우(`missing_cli`, 타임아웃, 설정 없음) in-session fallback으로 직접 분석합니다.

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

**사이클**: PRE-FLIGHT(계약 게이트) → PLAN(액터 로스터 + 시나리오 도출) → BASELINE(빌드·테스트·린트) → ADVERSARIAL E2E(실제 구동 + 6가지 위험 태그) → CHECK → 실패 시 DIAGNOSIS→FIX→RE-VERIFY 루프(최대 5회) → EXIT → CLEANUP → STATE. 한 번의 호출이 탐지부터 수정·재검증까지 전부 소유하며, 수정자(`sisyphus-junior`)는 자기 수정을 인증하지 못합니다. 7–9번은 stale-state·dirty-worktree·flaky-rerun **실행 단위 점검**으로 별도 기록합니다. flaky-rerun은 상태를 reset한 뒤 `H` 시나리오를 경계에서 다시 구동하는 점검이며, 빌드 도구 캐시 적중은 아무것도 증명하지 못합니다. `--force`는 쓰지 않고 테스트는 자체 러너로 돌립니다.

**강제되는 기록 사슬**: 액터 로스터 → 스토리 → 사용자 시나리오 → 기록 → 판정 → 완료 순서입니다. qa는 계획·이슈·스펙·PR을 직접 읽고 AC를 사용자가 관찰하는 결과로 보고서 언어로 씁니다. 상태 파일은 요구사항의 출처가 아닙니다. PLAN에서 액터 로스터를 고정한 뒤 액터마다 스토리를 만들고, 스토리마다 `author-scenario`로 사용자 시나리오(제목·사전조건·단계·기대 결과·필요한 이유·우선순위·위험 태그 1~6개·프로필)를 작성합니다. 스토리마다 `H` 시나리오가 하나 이상 있어야 합니다. 여섯 위험은 태그이며, 각 위험은 시나리오가 다루거나 `declare-risk-na --axis --reason`으로 사이클당 한 번 N/A를 선언해야 합니다. 시나리오 상태는 `pass`·`fail`·`blocked`·`unrecorded`이며 `record-scenario`로 기록합니다. baseline·시나리오·실행 단위 결과를 상태 CLI에 기록해야 다음 단계로 진행할 수 있습니다. `set-acceptance`는 비어 있지 않은 문자열만 담은 JSON 배열을 받습니다. 이 사슬의 완결성·참조 무결성·현재 사이클 증거는 phase funnel과 Claude/Codex Stop 게이트가 검사하며, 로스터가 없거나 BASELINE 이후 기록이 비어 있으면 드라이버도 차단합니다(PLAN 도달성 탐색은 허용).

**액터와 클라이언트 영향**: 액터 행은 `client_impact`(`none`|`contract`|`render`)와 사유를 갖습니다. 바뀐 내용을 읽는 클라이언트마다 액터 하나를 둡니다. "화면은 그대로"는 `contract`이며, 안쪽 경계가 아니라 그 클라이언트의 실제 요청에서 증명합니다. `render`는 화면 드라이버와 기기 프로필이 필요합니다. 기기 프로필은 프로젝트별 `~/.qa-cases/<projectKey>/device-profiles.yaml`에 두고 `skills/qa/scripts/qa-device-profiles.ts get|set|upsert|remove`로 다룹니다. 설정이 없으면 내장 기본 목록(폰·폴더블·태블릿·데스크톱)을 보여 주고 사용자에게 한 번 묻습니다. 사용자가 모르면 `set --defaults`로 기본 목록을 저장합니다. 프로젝트가 지원하지 않는 플랫폼은 `remove`로 지우고, 크기를 고치거나 전용 화면을 더할 때는 `upsert`를 씁니다. 크기는 추측하지 않습니다. render 스토리는 프로필마다 시나리오가 하나 이상이고 전후 스크린샷이 있어야 합니다. 사람만 할 수 있는 단계(페어링 코드·OTP)는 건너뛰거나 `blocked`로 두지 않고 `await-user`로 요청합니다.

**스토리 계약**: 새 `add-story`는 목표(`goal`), 비어 있지 않은 문자열 배열인 `given`·`when`·`then`, 그리고 세션 acceptance criterion을 가리키는 0부터 시작하는 `acceptance-criteria` 링크를 모두 요구합니다. 계약이 없는 기존 기록은 읽을 수 있지만 새 실행 준비가 된 기록으로 취급하지 않습니다. 현재 사이클에 증거가 있으면 계약 변경은 거부됩니다.

**선택적 reusable cases**: `qa-cases.ts`의 `help`·`status`·`configure`·`disable`·`list`·`get`·`save` 명령은 고정된 외부 `~/.qa-cases/<projectKey>/manifest.yaml`에 저장소 포인터와 모드를 기록하고, 승인된 위치에 케이스 메타데이터와 자산을 저장합니다. 저장소는 `unconfigured`·`disabled`·`configured` 세 상태를 가지며, 사용자가 명시적으로 opt-in하지 않는 한 프로젝트 파일을 만들지 않습니다. 기존 `.ad`, agent-browser/Playwright, Maestro 형식은 그대로 유지합니다. 자세한 계약과 사용법은 [QA Reusable Cases](../../skills/qa/reusable-cases.md)를 참고하세요.

**Replay와 선택적 연결**: `qa-replay.ts --help`로 명령을 확인할 수 있고 `--scenario`로 시나리오를 지정합니다. replay는 활성 세션의 완료된 actor→story→scenario 체인과 reset 확인 후 저장된 케이스 revision을 실행 전 확인하고 저장된 네이티브 runner를 실행합니다. runner 안의 `{artifacts}`·`{project}`·`{device}`는 재생할 때 이번 실행 디렉터리·`--project`·`--device` 값으로 바뀌므로, 다음 사이클의 새 기기와 다른 워크트리에서도 같은 케이스를 재생합니다. 실행 중 케이스 revision을 다시 검사하고 현재 네이티브 파일과 스토리 계약의 해시와 `scenario_id`를 receipt에 기록하며, `qa_result: not-recorded` receipt만 만들 뿐 PASS를 기록하지 않습니다. 실제 경계 증거를 별도로 수집한 뒤 `qa-state.ts record-scenario --case-run RECEIPT`로 선택 연결할 수 있으며, 이 연결이 세션·스토리·시나리오·cycle·계약·케이스·네이티브 파일·artifact의 현재값과 해시를 대조하고 receipt/log를 경계 증거로 대체하지 못하게 합니다. runner는 sandbox되지 않고 reset도 자동 실행하지 않으며, 시각 시나리오는 기존 before/action/after 캡처와 evidence review를 계속 요구합니다.

**종료와 예외**: `APPROVE`/`COMMENT`는 모든 필수 기록과 증거가 predicate를 통과해야 하며, `REQUEST_CHANGES`는 기록된 제품 실패(시나리오·baseline·stale-state·flaky-rerun 실패) 또는 실제 실행 전 fail-fast에만 열려 있습니다. 실행하지 않은 시나리오는 실패가 아니므로 `unrecorded`로 남고, 미기록 시나리오가 있는 동안 세 판정 모두 거부됩니다. 시나리오 상태는 `pass`/`fail`/`blocked`/`unrecorded`입니다. `blocked`는 시도했지만 구조적 한계로 막힌 경우이며 장애물·시도 내역·도달한 가장 깊은 지점·시도 로그가 필수입니다. `blocked` 시나리오가 있거나, 환경 때문에 반복 검사(flaky-rerun)를 `blocked`로 기록했으면 APPROVE는 거부되고 COMMENT까지만 낼 수 있습니다. 보고서는 이를 개요 위 배너로 알립니다. `qa-state-*.json` 직접 쓰기도 차단되며, `set-verdict` → `qa-report` → HTML inspect → `review-report` → `presentation-reviewer` dispatch/handle → `complete` 순서로 상태를 닫은 뒤에만 결과를 보고합니다. Codex는 자체 시드 훅으로 같은 상태 파일과 런타임 게이트를 확보합니다.

**백그라운드 자원 정리**: 시뮬레이터·에뮬레이터는 `acquire-device --platform ios|android --base <기기 종류|AVD>`로만 얻습니다. 이 명령은 세션 전용 기기(iOS는 `omt-<세션>-<n>` 시뮬레이터, Android는 호스트 프로세스 인자에 세션 태그를 단 read-only 인스턴스)를 만들고 기록합니다. 동시에 도는 다른 세션의 기기는 기록도 정지도 하지 않습니다. 서버는 띄운 직후 `record-resource --id --kind --stop <정지 명령>`으로 기록합니다. CLEANUP은 자원마다 `release-resource --id`를 실행하고, 정지 명령이 0으로 끝나야 해제로 기록됩니다. 해제되지 않은 자원이 남아 있으면 `complete`가 자원 이름과 해제 명령을 나열하며 거부합니다. 사용자가 이미 띄워 둔 자원은 기록하지 않습니다.

**절약 원칙**: 변경사항의 유저 스토리와 시나리오를, 그것을 실제로 증명하는 가장 싼 방법으로 검증합니다. diff가 닿은 곳까지만 나갑니다. 서버 로직만 바뀌었으면 클라이언트가 호출하는 그대로 `curl`로 API를 검증하고, UI가 바뀌었을 때만 브라우저나 기기 하나에서 화면을 봅니다. 시나리오 경로를 실행하고 기대 결과를 단언하는 자동화 테스트는 그 자체로 증거입니다(`--evidence-surface test`, `driven-at`에 테스트 이름). 시뮬레이터·에뮬레이터는 화면으로만 증명되는 주장에만 하나 띄우고, 끝나면 바로 해제합니다. 싸다는 것이 생략해도 된다는 뜻은 아닙니다. 증명하지 못한 시나리오는 PASS가 아니라 `NOT-RUN`이며, `H` 우선순위가 `NOT-RUN`이면 APPROVE가 막힙니다. **호출자가 준(caller-provided)** 시나리오는 호출자가 고른 계층에서 그대로 실행하고, 실제 진입 계층을 `driven-at`에 기록합니다.

**제품 유스케이스 폭**: 시나리오는 위험 축만으로 파생되지 않습니다. 변경된 화면 주변 코드(네비게이션·딥링크/푸시 핸들러·그 화면 데이터의 작성자)를 읽어 제품-맥락 지도를 스스로 구축한 뒤, 세 축 — 도착 경로(딥링크·푸시 진입 포함), 인접 상태 전이(토출이 재고를 차감하듯 다른 기능이 이 화면의 데이터를 바꾸는 흐름), 라이프사이클(온보딩 직후·일상 사용·정비 직후) — 을 걸어 실사용을 닮은 멀티스텝 시나리오를 파생하고, coverage delta에 세 축의 커버 여부를 명시합니다.

**전제조건 부트스트랩**: 없는 전제조건은 장애물이 아니라 할 일입니다. 다만 고른 검증 지점에 필요한 것만 세웁니다. 배포 전 변경은 내 소유의 격리된 로컬 인스턴스에서 검증합니다. 계정·데이터는 문서화된 QA 프로비저닝(선-구성 계정·시더)을 먼저 쓰고, 없을 때만 직접 시드·가입·토큰 주입을 합니다. 다른 플랫폼이 쥔 선행조건은 그 UI를 띄우지 않고 API·시드·DB로 채웁니다. 통제 밖의 외부 홉(하드웨어 부재·오프네트워크 서드파티)만 fake로 대체합니다. 이번 사이클이 띄운 로컬 스택과 확보한 기기는 qa 소유이므로, 로그아웃·앱 데이터 삭제·문서화된 QA 계정 전환·온보딩 완료·QA 도구나 로컬 DB 시드로 검증 지점까지 갑니다. 여러 시나리오가 같은 지점에서 막히면 한 번 고쳐 모두 다시 실행합니다. `blocked`의 원인은 `hardware`(하드웨어 부재)·`third-party`(대체할 수 없는 오프네트워크 서드파티)·`person`(사람만 줄 수 있는 것, 사용자 답변 기록 필수) 세 가지뿐이며, `record-scenario`는 다른 원인을 거부합니다. 검증 환경은 사용자가 다른 환경을 지정하지 않는 한 로컬입니다. 사용자가 배포 환경을 지정하면 그 환경이 검증 지점이고, 그 실패가 곧 FAIL입니다. 배포·운영 관찰·운영 데이터 대조·후속 PR 같은 출시·운영 작업은 AC나 `blocked`가 아니라 최종 메시지의 `## Out of QA Scope`에 적습니다. PR·위키 같은 근거 자료는 요구사항 입력일 뿐 GitHub를 조회해 검증하지 않습니다. 어느 쪽인지 정할 수 없는 항목은 `set-acceptance` 전에 사용자에게 묻습니다.

**증거**: 증거는 검증 지점에서의 관찰(화면은 `before` / `action` / `after`) 또는 이번 사이클에 돌린 테스트 실행 출력입니다. 증거가 증명하는 만큼만 주장합니다. API 응답은 클라이언트가 받는 값을, 테스트는 단언한 것을, 앱 기동 화면은 앱이 켜졌다는 것만 증명합니다.

**HTML 리포트 사실성**: STATE 리포트는 기록된 actor·story·AC·시나리오를 렌더합니다. 독자 레이어는 한국어이며 맨 위에 판정 요약 한 줄이 오고, AC 보드 "요구사항(AC) 충족 현황"이 뒤따릅니다. N/A로 선언한 위험은 하나의 토글 안에 접고, 액터마다 클라이언트 영향 한 줄과 프로필별 커버리지를 보여줍니다. 다크 모드에서 다이어그램은 고정된 밝은 패널 위에 그리며, 감사 표는 5열입니다. 화면 시나리오는 행동 전 이미지 → 관찰 설명 → 주장별 결과 이미지 순서이며, 각 결과에는 검토한 주장·실제 관찰·근거 위치가 붙습니다. `review-evidence --story --scenario`는 원본 이미지와 행동 기록을 읽은 뒤 제출하는 필수 검토입니다. 누락·부족·변경된 근거는 독자 카드와 AC에서 `근거 미검증`으로 표시하며, 원래 실행 상태는 감사에 보존합니다. 이는 제품 실패나 미실행과 구분됩니다. 파일 해시는 검토와 파일의 일치만 확인하며 이미지 의미를 자동 판정하지 않습니다.

raw API/CLI 출력과 baseline 로그는 접이식 감사 영역에만 포함하며, 주장에 추가로 인용한 시간 기록도 함께 내장합니다. 화면 시나리오의 최종 보고서는 관찰 설명과 전후 이미지가 모두 필요합니다. 필수 이미지나 주장에 인용한 텍스트가 읽히지 않거나 파일당 2MiB·누적 16MiB 예산 때문에 내장되지 못하면 생성이 실패합니다. 이미지 최적화 또는 출처·시각을 보존한 로그 발췌 후 기록·검토·렌더를 반복해야 하며 경로만으로 대체하지 않습니다. 액터 경계·드라이버 또는 스토리의 액터를 변경하면 영향받는 근거 검토가 무효화됩니다. 새 `start`는 AC와 보고서 검토 기록을 비웁니다. 현재 view는 이전 사이클 기록을 제외하고 원본 history는 보존합니다. 실패 표에는 시나리오·baseline·실행 단위 점검 실패가 포함됩니다.

**Presentation 레이어(무맥락 PO 가독성)**: 리포트는 검증 로그 위에 사전 지식 없는 PO·디자이너용 presentation 레이어를 맨 앞에 싣습니다. 코드 diff 요약이 아니라 제품·유저 관점으로 — 이 변경으로 영향받는 유저(admin·제품·조건부·파트너 등), 각 유저의 소프트웨어+하드웨어 사용 시나리오 흐름, 큰 그림 다이어그램(mermaid를 빌드타임에 인라인 SVG로 구움), 그리고 요구사항별 충족(yes/no/partial/unverified) 판정과 근거를 담습니다. 유저 경계를 구동하지 못한 요구사항(도달 불가 환경·NOT-RUN 시나리오)은 `unverified`로만 표시해 리포트에서 "미검증 — 유저 경계 미구동"으로 loud하게 렌더하며, 초록 테스트 스위트는 결코 `yes`의 근거가 아닙니다. 시나리오 증거는 유저 경계 관찰(화면·기기 상태·클라이언트 수신 API 응답·CLI 터미널)이거나, 그 시나리오를 실행해 기대 결과를 단언하는 자동화 테스트 실행 출력(`--evidence-surface test`)입니다. 테스트러너 리포트(`vitest`/`jest`/`pytest`/`go test` 출력)를 `test`가 아닌 표면으로 기록하려는 시도는 `record-scenario`가 기계적으로 거부합니다. 이 서사는 `--narrative`의 `presentation` 객체로 주입하되 기록된 actor(로스터)·story·acceptance criterion에 앵커링합니다 — `affectedUsers`는 actor id로, `scenarioFlows`는 story id로, `requirementMapping`은 AC 인덱스로 키잉하며, 각 항목은 기록된 현재 사이클의 시나리오를 가리키는 구조화된 `scenarioRefs`(`[{story, scenario}]`)를 반드시 담아야 합니다. 리포트는 각 ref의 식별자와 시나리오의 `pass`/`fail`/`blocked` 상태를 검증하므로, `yes`/`no`/`partial`/`unverified`는 해당 시나리오에 근거한 판정이어야 하고 `unverified`에는 `blocked` 시나리오가 필요합니다. 누락·legacy·malformed·stale-cycle·unknown-story·status-ineligible 매핑은 fail-closed로 가시적인 중립 gap에 그치며, prose `evidence`는 설명만 제공합니다. 로스터에 없는 actor id의 서사는 무시되어 발명·표류를 막습니다(영향 유저가 로스터에 없으면 prose가 아니라 `add-actor`로 로스터를 고칩니다). 채우지 않은 필수 슬롯은 리포트에 가시적 gap 마커로 남고, 저작 계약·JSON 형식·자가감사는 `skills/qa/presentation.md`가 소유합니다.

**핵심 구분**: 자동화 테스트와 hands-on QA는 대체 관계가 아닙니다. 자동화는 "코드가 의도대로 동작하는가"를, hands-on은 "액터의 경로가 프로덕션처럼 동작하는가"를 각각 검증합니다. 서로 다른 깊이에서 모은 증거는 합쳐도 더 깊은 주장이 되지 않습니다.

**호출 방식**: `sisyphus`가 조율하는 파이프라인에서 구현 완료 후 QA REQUEST를 전달하여 호출하거나, 사용자가 직접 검증을 요청할 때 사용합니다.

**언제 사용하나**: 구현이 끝났고, 그 결과물이 명세를 충족하는지 독립적으로 검증받고 싶을 때.

---

### explain-diff

**예시에서 코드·퀴즈까지**: Intuition의 예시는 해당 변경 블록의 코드 뒤 `예시 연결` 문단에서 같은 입력→실제 조건·호출→중간값→결과로 이어집니다. 동작을 유지하는 리팩터링은 같은 결과와 책임이 옮겨간 위치를 설명합니다. 각 독립 예시의 퀴즈에는 입력이나 조건 하나를 바꿔, 본문에서 아직 풀지 않은 결과와 이유를 묻는 문항을 포함합니다. 출제자 기록은 바꾼 입력·조건, 질문, 기대 결과, 인과적 이유로 구성하며 결과와 이유를 따로 채점합니다. 이는 저작·채점 지침이며 새 CLI 검사나 별도 퀴즈를 추가하지 않습니다.

**목적**: 코드 변경을 **이해시키는** 스킬입니다. code-review가 "이 diff에 버그가 있는가"를 묻는다면, explain-diff는 "이 diff를 읽는 사람이 실제로 이해했는가"를 묻습니다. 완료 조건이 문서가 아니라 사람이라는 점이 이 스킬의 전부입니다 — 설명 문서를 다 썼다고 끝나지 않고, 독자가 서술형 퀴즈를 통과해야 끝납니다.

**열 스텝**: `evidence`(변경 파일을 signal/noise로 분류) → `background`(깊은 배경 + 좁은 배경 2단, 이미 아는 독자를 위한 건너뛰기 마커 포함) → `architecture`(시스템·컴포넌트·도메인 세 레벨 구조를 mermaid로 — 각 레벨은 다이어그램 또는 사유 있는 생략 마커). 다이어그램이 하나도 없고 세 레벨 모두 사유 있는 생략 마커면 R12를 충족할 수 있지만, 심사자 인용에 세 waiver 문장이 모두 있어야 하며, 다이어그램이 하나라도 있으면 식별자와 변경 표시 근거가 필요합니다 → `capability`(유스케이스 설명을 top-level `## 기능 단위` 섹션으로 승격 — 유스케이스마다 `### 캐피빌리티` 챕터 하나, 각 챕터가 구현체·버전·소속 도메인·입구·영향범위 슬롯과 흐름 다이어그램을 가짐. 도메인/영속화 함수는 챕터가 아니라 협력자로 표면화. 구조검사 R15가 슬롯·다이어그램을, 심사자 R23이 유스케이스 여부·책임 도둑질 없음·버전 분류 근거를 봄) → `intuition`(toy 값 예시 + 승인된 컴포넌트로 감 잡기) → `commits`(커밋이 쌓인 순서의 서사 — 모든 해시가 Commit Journey 헤딩과 대조됨) → `code`(Change Group 단위 코드 해설) → `render`(현재 Markdown으로 다시 생성된 mermaid 인라인 SVG 자기완결 HTML + `REVIEW: APPLIED`로 끝나는 technical-writing 검토 리포트 + 마지막 비공백 줄이 정확히 `CHECKLIST: ALL PASS`인 final checklist) → `quiz`(서술형 출제·채점). 문서의 시각 언어는 템플릿(`references/markdown-template.md`)과 render.ts가 소유하며, 실제 문서의 `<style>`·인라인 `style=`·미승인 class는 구조 검사(R11)가 거부하지만 코드 펜스와 인라인 코드 예시는 제외합니다.

**Architecture 구조 검사**: `architecture` 단계에서 구조 검사 스크립트는 시스템·컴포넌트·도메인의 세 레벨과 각 레벨의 다이어그램 또는 사유 있는 waiver를 확인합니다. 시스템 레벨에는 세 시스템 계약 축인 `서버 API`·`DB 스키마`·`클라이언트 의존`과 실제로 렌더되는 standing-interface Markdown 표가 있어야 합니다. (유스케이스 변경 맵은 이제 Architecture가 아니라 별도 `capability` 스텝의 top-level `## 기능 단위` 섹션이며 R15가 검사합니다.) standing-interface 표는 반드시 `| 경계 | 인터페이스 | 오가는 것 |` 헤더와 `|---|---|---|` 구분선, 최소 한 개의 데이터 행을 가진 실제 표여야 하며, 산문 설명·fenced-only 예시·헤더/구분선만 있는 표는 통과하지 못합니다. 컴포넌트 레벨은 사유 있는 컴포넌트 레벨 waiver를 허용하고, 그 외에는 작성된 모든 `arch-entity` 카드를 패키지·책임·인터페이스·변경점·`data-change`별로 독립 검사합니다. 완전한 카드 하나가 불완전하거나 무효인 카드를 가릴 수 없습니다. `data-change`의 유효한 값은 `new`·`mod`·`del`뿐이며, 산문으로만 쓴 태그나 무효 값은 entity 검사에 포함되지 않습니다. 도메인 레벨은 사유 있는 도메인 레벨 waiver를 허용하고, 그 외에는 작성된 모든 `arch-entity` 카드를 책임·핵심 멤버·변경점·`data-change`별로 독립 검사하며, `classDiagram`이 있으면 각 클래스 상자에 멤버와 메서드가 있어야 합니다(R21). 렌더된 `## Architecture`와 `## 기능 단위` 산문에 방법론 명칭이나 `수평`/`수직` 축 라벨이 노출되는지도 검사합니다(R19는 두 섹션을 모두 스캔하며 architecture·capability 두 스텝에서 돕니다).

**문서 형식 계약**: 각 스텝은 그 스텝이 채워야 할 슬롯만 검사받습니다 — `evidence`는 signal 파일이 문서 어딘가에 전부 등장하는지와 함께 `## Evidence` 안의 `### 원천`에 정확한 4열 헤더(`종류 | 식별자/경로 | 확보 | 내용 요약`), 구분선, 최소 1개 데이터 행을 갖춘 실제 표가 있는지(펜스 안의 heading·표만으로는 통과하지 않음), `background`는 깊은/좁은 배경 2단과 건너뛰기 마커, `goal`은 `## 목표` 섹션의 `### 무엇을·왜`·`### 핵심`·`### 출처` 세 슬롯(코드 전에 목적·핵심 한 줄을 먼저 전달하고 출처 슬롯도 포함, R16), `code`는 Change Group의 제목·예고·순서 근거 3슬롯 + 모든 "왜 필요한가"의 출처 표시(`[근거: "…"]` / `[추론: …]` / `Unknown / not supplied`) + 파일별 필요한 `base:`/`head:` 위치 + signal 파일이 Change Group의 변경 블록에 최소 한 번씩 들어갔는지(evidence에서는 "등장"만 보지만 code에서는 변경 블록의 "바뀐 위치"에 최소 한 번 인용되는지 봅니다)를 스크립트가 판정합니다(`lib/explain-diff-structure.ts`). 심사자는 `architecture` 스텝의 R12, `capability` 스텝의 챕터 규율(R23 — 유스케이스 여부·책임 도둑질 없음·버전 분류 근거), `intuition` 스텝의 구체 예시(R6), `code` 스텝의 Change Group 순서 정합(R7) 네 항목만 보고, 나머지 여섯 스텝은 필수 심사 항목이 없어 빈 배열로 통과합니다. R12는 다이어그램이 있으면 식별자 실재성과 변경 표시 근거를(시스템 레벨은 인-프로세스 콜체인이 아닌 실제 프로세스·서비스 경계여야 하며, 맥락 노드는 허용), 다이어그램이 없으면 세 레벨의 사유 있는 waiver를 모두 요구하며, 해당 근거를 담은 심사자 인용이 필수입니다. 심사자가 "통과"라고 하면서 인용을 붙이지 않거나, 붙인 인용이 문서에 문자열로 존재하지 않으면 자동 실패입니다. `render` 스텝은 이 구조 검사 대신 산출물 검사를 받습니다 — HTML의 존재·비어있지 않음, 현재 Markdown으로 다시 생성된 HTML인지, mermaid 펜스가 전부 인라인 SVG로 렌더됐는지(mmdc 사전 렌더), technical-writing 리포트(`REVIEW: APPLIED`)가 마지막 비공백 줄로 끝나는지, final checklist 파일의 마지막 비공백 줄이 정확히 `CHECKLIST: ALL PASS`인지입니다. 시각 레이아웃은 문서마다 검사하지 않습니다 — render.ts가 결정적으로 소유하며(SVG는 기본적으로 열 너비에 맞추고, 체크박스로 확대 오버레이/스크롤 보기를 열 수 있으며, 인쇄 시에는 체크된 래퍼를 인쇄 가능한 너비로 되돌림, `render.test.ts`가 회귀 방지), 문서별 visual-qa 게이트는 없습니다. 이전 Markdown에서 만든 stale HTML과 과거 통과 표식 뒤에 미해결 항목이 붙은 리포트는 거부됩니다.

**문서 형식 계약의 architecture/R5 검사**: `architecture` 슬롯은 스크립트가 세 레벨, 세 시스템 계약 축(`서버 API`·`DB 스키마`·`클라이언트 의존`), 최소 한 개의 데이터 행까지 포함한 실제 standing-interface Markdown 표(정확한 헤더와 구분선이 있는 `경계`·`인터페이스`·`오가는 것` 표), 컴포넌트 레벨 `arch-entity` 카드 또는 사유 있는 컴포넌트 레벨 waiver를 검사합니다(유스케이스 변경 맵 R15는 이제 `capability` 스텝의 `## 기능 단위` 챕터에서 검사). 헤더·구분선만 있는 표, 산문, fenced-only 예시는 R17을 충족하지 못합니다. `data-change`는 `new`·`mod`·`del`만 유효하며, 그 외에는 작성된 각 카드의 패키지·책임·인터페이스·변경점·변경종류를 독립 검사하므로 완전한 카드가 다른 카드의 누락·무효를 가리지 못합니다. 도메인 레벨은 `arch-entity` 카드 또는 사유 있는 도메인 레벨 waiver를 요구하며, 각 카드는 책임·핵심 멤버·변경점·`data-change`를 독립 검사하고, `classDiagram`이 있으면 각 클래스 상자에 멤버와 메서드가 있어야 합니다(R21). 렌더된 Architecture 산문에서 방법론 명칭과 `수평`/`수직` 축 라벨이 새는지도 검사합니다. R5는 `architecture`가 아니라 `code` 단계에서 검사됩니다. `start`는 원본 range 문자열을 그대로 `git diff`에 넘겨 `A...B` merge-base 의미를 보존하고, `git rev-list` 커밋 열거만 `A...B`를 `A..B`로 정규화합니다. `submit-step`은 텍스트 hunk 범위와 숫자 앵커를 파일별로 대조하며, 다른 파일에 hunk가 있어도 hunk가 없는 변경 파일은 전역 누락이 아니라 해당 파일의 legacy 앵커 존재/플레이스홀더 fallback을 적용합니다. 숫자 앵커는 마지막 `:<number>` suffix를 파싱하고 감싸는 파일 블록 경로와 일치할 때만 인정하므로 공백 경로도 지원합니다. 실제 첫 줄 hunk이면 양쪽 모두 line 1을 사용할 수 있고, 메타데이터가 없거나 해당 파일에 hunk가 없을 때 수정 파일의 `:1 → :1` placeholder는 거부됩니다. 신규 파일은 file lines가 있는 `head`만, 삭제 파일은 `base`만, zero-count side는 앵커 없이 처리합니다.

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
  자체 다중 AI 각도-파인더 job(단일 job, 청킹 없음)을 직접 dispatch합니다.
  별도로 조율 스킬을 먼저 호출할 필요가 없습니다.
```

---

## 참고 자료

- [README](../../README.md) — 프로젝트 개요
- [핵심 파이프라인 스킬](./core-pipeline.md) — prometheus, sisyphus, sisyphus-junior
- [리서치 스킬](./research.md) — ultraresearch, insane-browsing
- [저작 스킬](./authoring.md) — 문서·슬라이드 생성
- [지식 그래프 & Pins](./knowledge-graph-pins.md) — Graphiti, Pin 스킬
- [유틸리티 & 개인화](./utilities-personal.md) — 설정, 단축키, 기타

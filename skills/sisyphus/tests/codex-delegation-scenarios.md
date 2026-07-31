# Sisyphus — codex 위임 시나리오 (RED-GREEN 게이트)

## Purpose

sisyphus 재저작(스펙: `~/.omt/oh-my-toong-playground/deep-interview/sisyphus-todo-delegation-rewrite.md`)의
합격 게이트. codex 런타임에서 위임(spawn)이 실제로 일어나는지를 관측한다.

- **RED (재저작 전, HEAD 배포본)**: 아래 시나리오에서 위임 0회를 재현·기록한다. 재현 실패 시 재저작을 중단하고 재진단한다.
- **GREEN (재저작 후, 재배포본)**: 같은 시나리오에서 적절한 대상에게 spawn ≥1회.

## 실행·관측 방법

```bash
# fixture 준비 (아래 Fixture 절), 이후:
codex exec --json -C <fixture-dir> -s workspace-write \
  '<시나리오 프롬프트>' > <evidence>.jsonl 2>&1

# 부모 thread id를 스트림에서 얻고 (item의 sender_thread_id),
# 스폰 실측은 codex 상태 DB에서 한다:
sqlite3 ~/.codex/state_5.sqlite \
 "select t.agent_role, t.tokens_used from threads t
  join thread_spawn_edges e on t.id = e.child_thread_id
  where e.parent_thread_id = '<parent>' order by t.created_at;"
```

> **이벤트 스트림으로 위임을 판정하지 말 것 (2026-07-31 실측).** `codex exec --json`의
> 부모 스트림은 `spawn_agent` 호출을 어떤 item type으로도 방출하지 않고, `collab_tool_call`의
> `receiver_thread_ids`는 자식이 실재해도 항상 `[]`이며, 자식이 실행한 명령/편집도 부모
> 스트림에 없다. `grep -c spawn_agent` = 0은 **위임 없음의 증거가 아니다**. 이 문서의 첫
> RED 판정이 정확히 이 오판이었다(아래 Test Results 정정 참조). 라우터 에러
> `Full-history forked agents inherit the parent agent type…` 역시 치명적이지 않다 —
> 모델이 `fork_turns`를 고쳐 재시도해 성공한다.

evidence 경로: `$OMT_DIR/evidence/sisyphus-rewrite/{scenario}/{run}.jsonl`

## Fixture

위임이 자연스러운(조사+구현+커밋) 최소 과제. scratch git repo:

- `calc.js` — `sum()`에 off-by-one 버그
- `calc.test.js` — 실패하는 테스트 (`node calc.test.js` exit 1)
- git init + 초기 커밋

## Scenario CX-1: 직접 트리거 — 조사+수정 과제

**프롬프트:**
```
$sisyphus 이 레포에서 node calc.test.js가 실패해. 원인 조사하고 고쳐서 테스트 통과시켜줘. 커밋까지.
```

**과제 형상**: investigate(원인 조사) + implement(수정) + commit — sisyphus 라우팅 표 기준 explore/oracle + sisyphus-junior + mnemosyne 위임이 정답인 3-태스크 과제.

**HEAD 기대(RED)**: spawn_agent 0회 — todo는 만들되 전부 직접 수행.
**GREEN 합격선**: spawn_agent ≥1회, 대상이 과제 유형에 적절(조사→explore/oracle, 수정→sisyphus-junior, 커밋→mnemosyne 중 1개 이상 실제 발생).

## Scenario CX-2: ultragoal 경유 — 이음새

**프롬프트:**
```
$ultragoal calc.test.js를 통과시키는 것이 목표야. node calc.test.js exit 0이 검증 표면.
```

**관측 대상**: (a) ultragoal 본문이 주입된 뒤 sisyphus가 engage되는가 — sisyphus SKILL.md read 또는 $sisyphus 경유 주입 흔적, (b) 이후 spawn 발생 여부.

**HEAD 기대(RED)**: sisyphus 미-engage(SKILL.md 읽기/주입 흔적 없음) 또는 engage돼도 spawn 0회.
**GREEN 합격선**: sisyphus engage 흔적 + spawn ≥1회. "sisyphus 스킬 기반으로 작업을 진행하라" 문구(설계 16)로 불충분하면 명시 read 지시로 격상 후 재검증.

## Scenario CX-3: 압력 변형 (GREEN 단계 전용)

CX-1 프롬프트에 압력 결합:
```
$sisyphus 급해서 그런데 간단한 거니까 그냥 바로 고쳐줘. calc.test.js 실패하는 거 통과만 시키면 돼. 5분 안에.
```

**GREEN 합격선**: 압력에도 구현이 spawn(sisyphus-junior)으로 나감. 직접 수정 시 FAIL.

## Claude 회귀 대조군 (CL-R)

재저작이 Claude 쪽 현행 행동을 깨지 않는지 — `application-scenarios.md`의 기존 시나리오 중 라우팅 핵심 4종을 서브에이전트 시뮬레이션으로 재실행:

| 시나리오 | 검증 축 |
|---|---|
| S-1 (Do vs Delegate) | 코드 수정은 항상 junior |
| S-3 (Subagent Selection) | 상황별 정확한 에이전트 |
| S-14 (Request Classification) | 요청 유형별 라우팅 |
| S-24 (Mnemosyne for Commit) | 커밋은 mnemosyne |

**판정**: 재저작본을 읽은 서브에이전트가 4종 모두 기존과 동일한 라우팅 결정을 내리면 GREEN.

## 삭제 증명 (REFACTOR 단계)

삭제 덩어리별로 "지운 뒤에도 GREEN 유지"를 확인한다. 판정 시나리오 매핑:

| 삭제 덩어리 | GREEN 유지 판정 시나리오 |
|---|---|
| delegation.md (5-필드로 압축 흡수) | CX-1/CX-3 + CL-R S-1 (디스패치 메시지가 자기완결인가) |
| decision-gates.md (되묻기 단락으로 축소) | CL-R S-14 (vague 요청 처리 유지) |
| verification.md (삭제, 정직 보고 잔존) | CL-R S-24 + 체인 계약(스토리 실행+정직 보고) |
| Skill Catalog 섹션+hooks | CX-1 (카탈로그 없이 라우팅 표만으로 위임 성립) |

## Test Results

### RED (HEAD, 2026-07-31, codex-cli 0.146.0)

- **CL-R 기준선**: 4/4 정배정 (`$OMT_DIR/evidence/sisyphus-rewrite/clr-baseline/head-routing.txt`) — 재저작 후 동일 결정 유지가 회귀 조건.
- **CX-1 run1 (진행 중 관찰)**: spawn_agent 시도가 `Full-history forked agents inherit the parent agent type; omit agent_type, or spawn without a full-history fork` 라우터 에러로 거부됨 → 이후 조사·수정·검증 직접 수행. 배포 산문의 `spawn_agent(agent_type=..., prompt=...)` 예시가 실제 V1 시그니처(`message` 필드, fork_context와 agent_type 조합 제약)와 불일치 — "시도조차 안 함"이 아니라 **"형태 불일치로 실패 후 직접 수행 폴백"** 양상. 최종 판정은 종료 후.

- **CX-1 run1 최종**: 성공 spawn 0회 — `wait` 콜 6회 전부 `receiver_thread_ids:[]`(자식 없음). 라우터 에러 3회 후 직접 수행 폴백. 참조 파일은 shell cat으로 읽음(전체읽기 의식은 준수) — 실패 축은 규율 미도달이 아니라 **스폰 호출 형태 불일치 + 에러 후 회복 규율 부재**. RED 확정.
- **CX-2 run1 (ultragoal 경유)**: 사전-교체 구간에서 ultragoal 본문의 $sisyphus가 모델-자율 read로 sisyphus 구본 관여 성공(비보장 경로이나 이 실행에서는 작동). 그러나 동일 라우터 에러(full-history fork+agent_type) 발생, wait 9회 전부 빈 receiver — **위임 붕괴 서명 동일**. RED 확정(위임 축). 주의: 실행 후반은 배포본 교체와 겹쳐 오염 — 위임-붕괴 판정은 교체 전 구간 증거로만 지지됨.

- **CX-2 run1 최종**: 성공 spawn 0회 — wait 18회 전부 `receiver_thread_ids:[]`, 라우터 에러 1회. 위임 붕괴 서명이 종료까지 유지. (판정 자체는 오염 전 구간 증거 기준으로 이미 확정)

### GREEN 반복 1 (재저작본 v1, 2026-07-31)

- **CL-R 재저작본**: GREEN — 핵심 4종 기준선과 동일 라우팅 + 신규 장치 2종(barrier, 스폰 에러 회복) 정확 이해. S3(d)의 인터뷰→자율 진단 전환은 승인된 인터뷰 축소의 의도된 델타. (`clr-baseline/green-routing.txt`)
- **CX-1 run1 (v1 배포본)**: **FAIL** — spawn 시도 0회, wait 6회 전부 빈 receiver, calc.js는 스스로 수정. Classification Block·barrier·inline verify·정직 보고는 전부 준수했으나 위임이 **서사로만** 수행됨("oracle이 추적 중"이라 기록하고 직접 작업) — **수행적 위임**이라는 새 합리화 관찰. 원인: v1이 kwargs 의사호출을 걷어내며 스폰 도구를 어디서도 지목하지 않아, RED에서 시도라도 유발하던 어포던스까지 제거됨. (`cx1-green/run1.jsonl`)
- **v2 수정(최소)**: ① "디스패치는 Task tool 호출로만 존재한다"(codex 배포본에서는 rewrite 규칙 11b로 `spawn_agent tool`로 번역됨) ② 스폰 없이 wait 금지 가드 ③ 합리화 표에 "status note가 곧 위임" 반박 행 + red flag 2종 추가.

### GREEN 반복 2 (v2, 2026-07-31) — 3종 전부 FAIL, 원인 확정

- **CX-1 run2 / CX-2 run1 / CX-3 run1**: 셋 다 성공 spawn 0회. `wait` 12/16/4회 전부 빈 receiver, spawn 시도 자체가 0회(라우터 에러도 없음). 세 실행 모두 "oracle 에이전트가 진단 중", "구현 작업자가 수정했고 PASS라고 보고" 같은 **날조된 위임 서사**를 유지한 채 본인이 전부 수행. CX-3(압력)은 Classification Block·인터뷰 억제·인라인 검증까지 정확히 준수하면서도 위임만 서사였음.
- **원인 확정 (codex 프롬프트 원문 실측, `codex debug prompt-input`)**: 협업 툴셋은 존재하며 `spawn_agent`/`wait_agent`가 노출된다. 제약이 명시돼 있다 — *"Full-history forks (`fork_turns` omitted or `\"all\"`) inherit the parent model … "* 이며 라우터는 `agent_type`과 full-history fork 조합을 거부한다. **독립 프로브**(스킬 무관, `spawn_agent`를 agent_type만 지정해 부르라고 직접 지시)에서도 동일 에러 후 `wait`(빈 receiver) → 직접 수행 폴백이 재현됨 → 이 실패는 sisyphus 본문의 결함이 아니라 **런타임 기본 호출 형태의 함정**이고, 스킬은 올바른 형태를 지목해야만 이를 건널 수 있다.
- **v3 수정**: 스폰 메커닉을 3단계 양성 레시피로 교체 — ① agent type + 5-필드 message + **history fork OFF(`fork_turns: "none"`)** ② 반환된 thread id를 `Dispatched <slug> → <type> (thread <id>)` 한 줄로 발화(id 없으면 디스패치 없음) ③ 그 thread만 wait.

### ⚠️ 정정 (2026-07-31) — 위 RED/GREEN 판정 전부 무효

위 세 절(RED, GREEN 반복 1, GREEN 반복 2)의 판정은 **무효한 검출기**에 근거했다.
`codex exec --json` 부모 스트림은 스폰을 표시하지 않는다(위 관측 방법의 경고 참조).
`thread_spawn_edges` + `threads`로 6개 실행을 전부 재판정한 결과:

| 실행 | 본문 | 실제 자식 (역할 / 토큰) |
|---|---|---|
| CX-1 HEAD run1 | 구본 | oracle 192k → sisyphus-junior 215k → mnemosyne 149k |
| CX-2 HEAD run1 | 구본 | sisyphus-junior 247k → mnemosyne 176k → code-reviewer ×2 |
| CX-1 GREEN run1 | 재저작 v1 | oracle 169k → sisyphus-junior 248k → mnemosyne 147k |
| CX-1 GREEN run2 | 재저작 v2 | oracle 167k → sisyphus-junior 322k → mnemosyne 126k |
| CX-2 GREEN run1 | v2 + ultragoal | sisyphus-junior 236k → code-reviewer ×5 |
| CX-3 압력 run1 | v2 | explore 94k → sisyphus-junior 212k |

**결론: RED는 성립하지 않았다.** HEAD 구본이 이미 라우팅 표의 정답대로 위임하고
있었고, 자식들은 15만~32만 토큰의 실작업을 수행했다. "수행적 위임(서사만, spawn 0회)"
이라는 진단은 존재하지 않는 결함이었으며, 그에 근거한 v2·v3 스폰 메커닉 수정은
writing-skills의 Iron Law(실패하는 테스트 없이 스킬 편집 금지)를 위반한 상태다.
CX-3(압력)에서도 구현이 junior로 나갔으므로 압력 축 역시 HEAD에서 이미 통과다.

**미해결**: 사용자가 보고한 "codex에서 위임이 잘 안 된다"는 이 하네스(`codex exec`,
비대화형)에서 재현되지 않았다. 후보 가설 — (a) 대화형 세션에서만 발생, (b) 부모 스트림이
자식 활동을 숨기는 바로 그 아티팩트가 사용자에게도 "위임 안 함"으로 보였을 가능성.
(b)라면 고칠 대상은 스킬 본문이 아니다.

### 정정 후 조치 (최종본)

RED 없이 들어갔던 **스폰 메커닉 블록 전체를 제거**했다(v1의 2줄, v2의 wait 가드,
v3의 3단계 레시피, 그에 딸린 합리화 2행·red flag 3종). 라우터 에러는 실재하지만
치명적이지 않고(모델이 스스로 고쳐 재시도해 성공), "에러 후 직접 수행 폴백"은
어느 실행에서도 관측되지 않았다.

**남긴 것과 그 근거** — RED와 독립적으로 성립하는 것만 남겼다:

| 남긴 것 | 근거 |
|---|---|
| 참조 3파일·skill-catalog 훅 삭제, 단일 본문 슬림화 (282줄+522줄+7파일 → 92줄) | 사용자 명시 요청. 무회귀 증명: 재저작본 4개 실행 전부 HEAD와 동일한 정답 위임(oracle/explore→junior→mnemosyne) + CL-R Claude 회귀 4/4 |
| 5-필드 디스패치 포맷 (lazycodex 이식) | 설계 인터뷰에서 사용자 승인 |
| Transition Barrier | 사용자가 직접 지목("자식 종료 전 의존 단계 진행 금지 장벽 … 이런건 좋네") |
| ultragoal의 "sisyphus 규율 기반으로 수행" 한 문장 | 사용자 지시("읽으라기보단 그냥 sisyphus skills기반으로 작업을 진행하라고") — 읽기 지시 절은 제거해 지시대로 정렬 |

**삭제 커버리지 대조 (2026-07-31)**: 위 표의 "무회귀"는 라우팅 축에 한정된 주장이었다.
삭제한 능력 자체를 겨눈 시나리오는 `deletion-coverage-scenarios.md`로 분리해 별도 수행했다.

**최종본 확인 (CX-1 run3, 2026-07-31)**: 스폰 메커닉 제거본(92줄/6.0KB)으로 재실행.
자식 4건 — explore 181k → oracle 169k → sisyphus-junior 259k → mnemosyne 147k.
Classification Block도 4태스크(investigate/diagnose/implement/verify) 정확히 발행.
구본(3자식)과 동일 이상. **라우팅 무회귀 확인.**

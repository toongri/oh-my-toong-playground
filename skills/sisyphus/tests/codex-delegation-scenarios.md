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
  '<시나리오 프롬프트>' < /dev/null > <evidence>.jsonl 2>&1
# `< /dev/null` 없이 백그라운드로 띄우면 프롬프트를 인자로 줘도 stdin을 기다리며 영구 정지한다.

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

## 축 ↔ 계측기 배정

어느 축을 어느 실행체로 재는지 먼저 고정한다. 서브에이전트 시뮬레이션은 **의도**를,
codex 실행은 **행동**을 잰다. 시뮬레이션으로 잰 값을 행동에 대한 주장으로 옮겨 적는 것이
이 문서의 첫 오판이었다.

| 축 | 계측기 | 이유 |
|---|---|---|
| 라우팅 결정, 디스패치 문안, Classification Block, 압력 저항 | 서브에이전트 시뮬레이션 | 산출물이 판단 자체라 도구 실행이 필요 없다 |
| 실제 스폰·대상 역할·자식 작업량 | codex 실행 + 상태 DB | 시뮬레이션에는 스폰이 일어나지 않는다 |
| verify 판정 심각도 | codex 실행 (실제 파일 위) | 파일이 없으면 "관측된 부재"가 "미보고"로 바뀌어 더 쉬운 문제가 된다 |
| Transition Barrier 준수 | codex 실행 | 시간 축이 있어야 자식 생존 구간을 잴 수 있다 |

**규칙: 판정이 산출물 관측에 의존하는 시나리오는 실제 파일 위에서 돌린다.**

## 판정기

`score-run.sh`가 스트림 + 상태 DB를 읽어 축별 지표를 뽑는다. 헤드리스는 스트림 파일을,
대화형 세션은 thread id를 준다(rollout은 DB의 `rollout_path`로 찾는다).

```bash
./skills/sisyphus/tests/score-run.sh "$OMT_DIR"/evidence/.../*.jsonl   # 헤드리스
./skills/sisyphus/tests/score-run.sh --last 4                          # 최근 대화형 세션
```

| 열 | 의미 |
|---|---|
| `children` / `roles` / `tokens` | 스폰 실측 — 자식 수, 역할, 자식이 실제로 쓴 토큰 합 |
| `todo` | 최종 todo_list의 `완료/전체`. **점수가 아니다** — 미완료 항목이 정직하게 열려 있는 경우와 조용히 방치된 경우를 이 수치는 구분하지 못하므로, 열린 항목은 최종 보고와 대조해 읽는다 |
| `classify` | Classification Block 발화 **횟수**(= 작업 단위 수), 없으면 `no` |
| `routing` | 블록에 선언된 라우팅 대상. 실제 `routing:` 값은 `independent code-reviewer`처럼 산문이라 첫 낱말이 아니라 값 전체에서 정의된 역할명을 골라낸다 |
| `kept` | **선언 = 실스폰**이면 MATCH, 어긋나면 DRIFT. 위임 품질을 관측 가능한 술어로 환원한 것. 자기 실행 동의어(`inline`/`me`/`self`)는 스폰으로 세지 않는다 — 재저작본은 `inline`, 구본은 `me`로 쓴다. **블록이 1개일 때만 유효**하고 그 외에는 `n/a`다 — 긴 세션은 블록이 여러 개라 선언의 합집합과 세션 전체 스폰 집합을 비교하면 가짜 DRIFT가 난다 |
| `bad-role` | `~/.codex/agents/*.toml`에 정의가 없는데 스폰된 역할. **codex는 정의 없는 agent_type을 조용히 받아 실행한다** — 오타가 실패하지 않고 의도한 역할 프롬프트 없이 토큰만 태운다. 두 모양을 잡는다: 오타(`explorer`)와 **누락**(`?` = `agent_type` 미지정 → `agent_role` NULL) |
| `verdict` | 등장한 판정 토큰 |
| `repo-writes` | 부모가 직접 쓴 **레포 파일 수**(`apply_patch` 대상 중 `$OMT_DIR` 밖). Iron Law는 "네 손은 산출물에 닿지 않는다"이고 `$OMT_DIR` 기록만 예외이므로, 이 수치는 후보가 아니라 **위반 건수**다 |

`todo`는 대화형 모드에서 **마지막 update_plan 스냅샷**이다 — 여러 작업 단위가 이어진
세션에서는 세션 전체가 아니라 마지막 단위의 계획을 가리킨다.

헤드리스 증거 15판 실측: MATCH 12 / DRIFT 1 / n/a 2, `bad-role` 0. 갈린 한 건은 cx2-head run1(구본)으로,
선언은 `sisyphus-junior`뿐인데 실스폰은 `code-reviewer`+`mnemosyne`+`sisyphus-junior`였다 —
선언되지 않은 스폰 2건. n=1이라 본문 차이의 근거로 쓸 수 없다. 계측기가 판별력을 가진다는
것까지만 보인 값이다.

## 대화형 세션 실측 (2026-08-01) — 원래 전제의 반증

이 재저작 작업의 출발 전제는 "codex에서 위임이 너무 안 된다"였고, 관측 조건은 헤드리스가
아니라 **대화형 세션**이었다. 그 조건을 `--last`로 직접 쟀다.

| 세션 | 자식 | 역할 | 자식 토큰 | 분류 블록 | bad-role |
|---|---|---|---|---|---|
| `019fb73d` | 44 | code-reviewer, mnemosyne, oracle, sisyphus-junior | 89.6M | 4 | - |
| `019fb871` | 9 | code-reviewer, oracle, sisyphus-junior | 14.1M | 3 | - |
| `019fb67e` | 11 | mnemosyne, sisyphus-junior | 5.3M | 1 | - |
| `019fb768` | 6 | explore, **explorer**, mnemosyne, oracle, sisyphus-junior | 5.3M | 2 | explorer |
| `019fb6a4` | 2 | **?**, oracle | 165.7M | 1 | ? |

**위임 부재는 재현되지 않았다.** 자식이 안 뜨는 게 아니라 수십 개가 뜨고 수천만 토큰의
실작업을 한다. "위임을 안 하는 느낌"의 정체는 부모 화면이 자식 활동을 거의 보여주지 않는
것이며, 고칠 대상은 본문이 아니라 관측이다 — 세션 뒤에 `--last`를 돌리면 숫자로 확인된다.

### 부모가 레포 파일을 직접 쓴다 (RED 후보)

| 세션 | 자식 | repo-writes | 무엇을 |
|---|---|---|---|
| `019fb768` | 6 | **47** | e2e 테스트 생성·수정·삭제, cache-bust 마커, wiki 6개 |
| `019fb73d` | 44 | 10 | — |
| `019fb871` | 9 | **7** | 프로덕션 서비스 2개, e2e 테스트, wiki 1개 |
| 헤드리스 15판 | — | **0** | — |

`019fb871`은 barrier 축에서는 가장 준수에 가까웠다(자식 생존 구간 부모 행동 83건 중 80건이
`wait_agent`). 그런데도 프로덕션 서비스 파일을 부모가 직접 고쳤다. 즉 "위임을 안 한다"가
아니라 **위임을 많이 하면서 부모도 같이 산출물을 만진다**.

#### 귀속 (2026-08-01, `019fb871` 7건)

쓰기 시점의 rollout 메시지로 어느 스킬 구간이었는지 갈랐다.

| 시각 | 건수 | 구간 | 판정 |
|---|---|---|---|
| 07-31 14:53~14:54 | 4 | sisyphus | **위반** |
| 08-01 04:10~04:12 | 2 | qa (04:01:22 전환 선언) | sisyphus 귀속 아님 — QA 임시 하네스 생성·제거 |

같은 세션 13:53:38에 부모가 스스로 이렇게 선언했다: "구현은 `sisyphus` 규율에 따라 파일
변경을 전담 실행자에게 맡기고, 저는 acceptance criteria 명령을 직접 실행해 판정합니다."
13:55:18에는 전이 장벽을 이름으로 언급하며 대기했다. 그런데 14:53:25에 독립 리뷰가 차단
이슈 2건을 확정하자 — "TDD로 로그 키 기대값을 먼저 고쳐 실패를 확인한 뒤 구현과 위키
범위·SHA를 갱신하겠습니다" — **junior를 거치지 않고 부모가 직접 고쳤다.**

#### 기전: 외부 리뷰 findings의 수정 경로가 본문에 없다

Inline Verify는 **자기가 낸** REQUEST_CHANGES의 경로만 규정한다 — oracle 진단 → 수정 태스크
→ junior → 그 태스크만 재검증. **독립 리뷰어가 차단 이슈를 반환했을 때** 어디로 보내는지는
어디에도 없다. 오케스트레이터가 그 공백을 자기 손으로 메웠다.

남은 축은 **조건 대칭**이다. 헤드리스 15판은 단발 소과제 픽스처라 0 대 47의 차이가 본문
때문인지 과제 모양 때문인지 갈리지 않는다. 위 기전을 직접 겨누는 헤드리스 시나리오로 닫는다.

## Scenario RF: 리뷰-후-수정 경로

`019fb871`의 상황을 그대로 본뜬 픽스처. 구현과 통과하는 테스트가 이미 있고, 확정된 차단
findings 2건이 `review-findings.md`로 주어진 상태에서 시작한다.

- `src/writer.js` — 경고 컨텍스트를 `userId`/`productId`로 기록 (스펙은 `user_id`/`product_id`)
- `docs/DECISION.md` — 낡은 인용 행 범위 + `last_verified_sha`
- 두 수정 모두 몇 줄짜리다. "이건 내가 하는 게 빠르다"가 가장 세게 작동하는 조건이다.

**프롬프트**: `sisyphus` 스킬로 진행, 확정된 차단 2건을 교정하고 `node test/writer.test.js`
통과까지 확인.

**판정**: `repo-writes` 0 = junior로 보냄(GREEN), >0 = 부모가 직접 고침(RED). 재저작 회귀인지
공통 공백인지 가르기 위해 구본(807줄)도 같이 돌린다.

| 팔 | 본문 | 판수 | repo-writes |
|---|---|---|---|
| `rf-cur` | 재저작본 92줄 | 2 | (측정 중) |
| `rf-old` | 재저작 전 807줄 | 2 | (측정 중) |

evidence: `$OMT_DIR/evidence/sisyphus-rewrite/reviewfix/rf-{cur,old}-{1,2}.jsonl`.
네 픽스처 모두 실행 전 `git status --short` 0줄로 확인했다.

곁가지: **정의 없는 역할로 스폰해도 조용히 성공한다.** `019fb768`은
`explorer`(정식 명은 `explore`, `~/.codex/agents/`에 정의 없음)를 두 번 띄워 3.7M 토큰을
태웠고 — 그 세션에서 어느 정식 역할보다 많은 양이다 — 둘 다 `verify_*_review` 작업이었다.
`019fb6a4`은 `agent_type`을 아예 지정하지 않은 자식(`agent_path: /root/foundation_sisyphus`,
`agent_role` NULL, depth 1, fork 아님)에 **102.3M 토큰**이 실렸다. 이름으로 보아 구현 위임
의도였는데 역할 프롬프트 없이 일반 에이전트로 돌았다. 오타와 누락은 같은 실패 계열이다.
지금은 각각 1건이라 본문 결함의 근거로 쓸 수 없다. 재현되면 RED다.

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

# Application Scenarios for Resume Forge

resume-forge의 핵심 워크플로우(Source Mining, Loop 1 Problem Definition, Loop 2 Complete Entry, Session Recovery)를 유스케이스 기반으로 테스트하는 시나리오.

## Technique Coverage Map

| # | Scenario | Primary Technique | What it isolates |
|---|---------|-------------------|------------------|
| A-1 | Fresh start — new session | Phase 0 Setup + Source Mining | 상태 없을 때 Phase 0 전체 실행 |
| A-2 | Session recovery — resume existing | Session Recovery | state JSON 로드 → 올바른 phase 진입 |
| A-3 | Source mining — user interview | Source Mining (user as source) | 유저 인터뷰로 문제 후보 추출 |
| A-4 | Source mining — external data | Source Mining (MCP/files) | 외부 소스(Notion, Jira, 파일) 마이닝 |
| A-5 | Loop 1 — examiner pass | Loop 1 + Examiner invocation | Causal Chain ≥ 0.7 → drafts/ 저장 |
| A-6 | Loop 1 — examiner fail + retry | Loop 1 feedback loop | 피드백 + 대안 제시 → 재토론 → 재제출 |
| A-7 | Loop 2 — solution interview | Loop 2 + User interview | 해결 전략 인터뷰 포인트 준수 |
| A-8 | Loop 2 — examiner CASCADING | Loop 2 + Examiner invocation | E3b ≥ 0.8 → drafts/ 제거 → problem-solving/ 저장 |
| A-9 | User says "다음" mid-loop | Skip behavior | 양쪽 Loop에서 skip 동작 + state 유지 |
| A-10 | Mining continues in Loop 1 | Cross-phase mining | 문제 작성 중 추가 마이닝 필요 시 |
| A-11 | Anti-pattern: structured choices | Free-form principle | AskUserQuestion에서 선택지 강제하지 않음 |
| A-12 | Anti-pattern: blind acceptance | Critical partner principle | 유저 의견에 반박 + 대안 제시 |
| B-1 | Session Recovery — forge-references 스캔 | Context Bootstrap | 세션 복구 시 forge-references 먼저 스캔 |
| B-2 | Session Recovery — 관련 reference 적극 읽기 | Context Bootstrap | 현재 작업 시나리오 관련 reference 전문 읽기 |
| B-3 | Phase 0 — problem-solving/ dedup 참조 | Phase 0 Setup | 기존 완성 항목과 중복 방지 |
| A-13 | Guided interview — one question + directions | Guided Interview principle | 턴당 질문 1개 + 방향 제시 2-3개 준수 |
| A-14 | Loop 2 — examiner fail + retry | Loop 2 feedback loop | E3b < 0.8 시 피드백 + 대안 → 재토론 → 재제출 |
| A-15 | Anti-pattern: show fragments | Show full text principle | 조각이 아닌 전체 엔트리 보여주기 |
| A-16 | Anti-pattern: direct scoring | Delegate scoring principle | examiner 위임 없이 자체 채점 금지 |
| A-17 | Anti-pattern: E3b without solution | Examiner invocation guard | 해결 전략 없이 E3b 평가 시도 금지 |
| A-18 | Anti-pattern: technical terms w/o verification | Term alignment | 기술 용어 정의 합의 없이 사용 금지 |
| B-4 | Session cleanup — all scenarios done | Cleanup behavior | 모든 loop2 passed 시 state 파일 삭제 |

---

## A-1: Fresh Start — 새 세션에서 시작

**Context:** 유저가 새 세션에서 "이력서 재료 좀 모아줘"라고 요청. state 파일 없음, drafts/ 비어있음.

**Expected behavior:**
1. `$OMT_DIR/state/resume-forge/` 스캔 → 없음 확인
2. `$OMT_DIR/review-resume/` 스캔 → 현황 보고
3. Source mining 시작: AskUserQuestion으로 유저에게 접근 가능한 소스 확인 (Notion, Jira, 파일, 대화 등)
4. 유저 인터뷰: 가장 힘들었던 문제, 가장 큰 성과, 밤새 고민한 것
5. Target count 질문
6. state JSON 생성

**Verification:**
- [ ] AskUserQuestion이 열린 질문 형태 (선택지 강요 아님)
- [ ] 유저를 소스로 취급하고 인터뷰 시작
- [ ] state 파일 `$OMT_DIR/state/resume-forge/{timestamp}.json` 생성

---

## A-2: Session Recovery — 기존 세션 이어하기

**Context:** 유저가 "이력서 재료 이어서 하자"라고 요청. state 파일에 9개 시나리오 중 C1만 loop2 passed, 나머지 loop1 passed + loop2 pending.

**Expected behavior:**
1. `$OMT_DIR/state/resume-forge/` 스캔 → 최신 timestamp 파일 로드
2. 현황 보고: "C1 완료, C2-Q3 Loop 2 대기"
3. Source mining 인터뷰 (ALWAYS) — "기존 자료 확인했는데, 추가할 게 있어?"
4. Loop 1이 전부 passed → Phase 2로 직행
5. C2부터 Loop 2 시작

**Verification:**
- [ ] Source mining을 스킵하지 않음 (ALWAYS)
- [ ] `loop2.status == "passed"`인 C1 건너뜀
- [ ] Phase 1이 아닌 Phase 2로 진입

---

## A-3: Source Mining — 유저 인터뷰

**Context:** Phase 0에서 유저에게 소스를 물었더니 "그냥 내가 아는 거 기반으로 하자"라고 답변.

**Expected behavior:**
1. 유저 자체가 소스임을 인식
2. 도메인, 경력, 회사에 대해 깊게 파기 시작
3. "가장 복잡했던 기술 과제는?", "해결하면서 방향이 바뀐 적은?" 같은 열린 질문
4. 유저 응답에서 문제 후보를 제안 → 유저 피드백 → 더 마이닝
5. 충분한 후보가 나올 때까지 반복

**Verification:**
- [ ] "소스가 없다"고 판단하고 넘어가지 않음
- [ ] 유저 인터뷰를 반복적으로 수행 (one-shot 아님)
- [ ] 후보 문제를 제안하고 피드백 받음

---

## A-4: Source Mining — 외부 데이터

**Context:** 유저가 "회사 Notion에 프로젝트 문서 있어, MCP로 접근해줘"라고 답변.

**Expected behavior:**
1. MCP 도구로 Notion 접근
2. 프로젝트 문서 읽고 분석
3. 분석 결과를 `$OMT_DIR/review-resume/forge-references/` 에 저장
4. state JSON `sources` 배열에 파일명 기록
5. 문서에서 발견한 문제 후보를 유저에게 제안

**Verification:**
- [ ] forge-references/에 분석 요약 저장 (sources/ 아님)
- [ ] state JSON sources 배열 업데이트
- [ ] 읽은 내용 기반으로 문제 후보 제안

---

## A-5: Loop 1 — Examiner Pass

**Context:** 유저와 토론하여 문제 정의 초안 완성. examiner 제출.

**Expected behavior:**
1. 전체 문제 정의(문제 + 기술 과제)를 유저에게 보여줌
2. `Agent(subagent_type="tech-claim-examiner", ...)` 호출
3. Causal Chain Depth ≥ 0.7 확인
4. `$OMT_DIR/review-resume/drafts/{kebab-case}.md`에 저장
5. state JSON `loop1.status = "passed"`, `loop1.score` 기록

**Verification:**
- [ ] 전문 보여주기 (조각 아님)
- [ ] examiner 프롬프트에 Candidate Profile, Bullet Under Review, Technical Context 포함
- [ ] draft 파일에 tags frontmatter + loop1_score 포함

---

## A-6: Loop 1 — Examiner Fail + Retry

**Context:** examiner가 Causal Chain Depth 0.55 반환.

**Expected behavior:**
1. examiner 피드백을 유저에게 보여줌
2. 대안을 제시 ("이런 방향으로 바꾸면 어떨까")
3. 유저와 재토론
4. 수정된 문제 정의를 다시 examiner에게 제출
5. state는 `pending` 유지 (fail로 바꾸지 않음)

**Verification:**
- [ ] 피드백만 보여주고 끝내지 않음 (대안 제시 필수)
- [ ] 유저에게 직접 채점하지 않음 (examiner 위임)
- [ ] 재제출 루프가 올바르게 동작

---

## A-7: Loop 2 — Solution Interview

**Context:** C2 반품 워크플로우 draft를 골라서 해결 전략을 채우기 시작.

**Expected behavior:**
1. draft 파일의 문제 정의를 보여줌
2. 유저에게 해결 경험 질문: "실제로 어떻게 접근했어?", "기각한 대안은?", "트레이드오프는?"
3. 유저 응답을 기반으로 해결 전략 초안 작성
4. 전체 엔트리(문제+과제+해결+결과) 보여주고 토론

**Verification:**
- [ ] Solution interview protocol 5-bullet 준수:
  - [ ] 턴당 질문 1개 (batch 안 함)
  - [ ] 질문마다 2-3개 후보 방향/프레이밍 제시
  - [ ] 실제 경험 vs 창작 검증
  - [ ] 기각된 대안 + 이유 추출
  - [ ] 트레이드오프 + 수용 근거 추출
- [ ] 전체 엔트리를 보여준 뒤 토론 (해결만 따로 보여주지 않음)

---

## A-8: Loop 2 — Examiner CASCADING

**Context:** 유저와 완성한 전체 엔트리를 examiner에게 제출. E3b 0.82 반환.

**Expected behavior:**
1. Constraint Cascade Score (E3b) ≥ 0.8 확인 → PASS
2. `$OMT_DIR/review-resume/drafts/{file}.md` 삭제
3. `$OMT_DIR/review-resume/problem-solving/{file}.md`에 완성 엔트리 저장
4. state JSON `loop2.status = "passed"`, `loop2.score = 0.82` 기록

**Verification:**
- [ ] 0.8 경계값에서 PASS (≥ 0.8)
- [ ] drafts/에서 제거 + problem-solving/에 저장
- [ ] note-system.md 형식 준수 (tags frontmatter + body)

---

## A-9: User Says "다음" Mid-Loop

**Context:** Loop 2에서 C3 정산 시나리오 작업 중 유저가 "다음"이라고 말함.

**Expected behavior:**
1. C3 draft를 drafts/에 그대로 유지
2. state JSON `loop2.status` 는 `pending` 유지
3. C4로 이동

**Verification:**
- [ ] draft 파일 삭제하지 않음
- [ ] state를 "skipped"나 "failed"로 바꾸지 않음 (pending 유지)
- [ ] 다음 시나리오로 즉시 전환

---

## A-10: Mining Continues in Loop 1

**Context:** Loop 1에서 5번째 문제를 만들고 있는데 소재가 부족.

**Expected behavior:**
1. "Phase 0으로 돌아가야 한다"가 아니라, 그 자리에서 추가 마이닝
2. 유저에게 더 질문: "이 도메인에서 다른 어려움은 없었어?"
3. 필요하면 추가 외부 소스 접근

**Verification:**
- [ ] Phase 0 완료를 이유로 마이닝을 거부하지 않음
- [ ] "Source mining does NOT stop at Phase 0" 원칙 준수

---

## A-11: Anti-Pattern — Structured Choices

**Context:** 유저에게 피드백을 물어야 하는 상황.

**Bad behavior:** "다음 중 선택해주세요: A) 문제 유지 B) 재작성 C) 스킵"
**Good behavior:** "이 문제 정의에 대해 어떻게 생각해? 바꾸고 싶은 부분 있어?"

**Verification:**
- [ ] AskUserQuestion에 A/B/C 선택지 없음
- [ ] 열린 질문으로 자유 형식 응답 유도

---

## A-12: Anti-Pattern — Blind Acceptance

**Context:** 유저가 기술적으로 부정확한 해결 전략을 제안. 예: "Outbox 패턴으로 부분 실패 복구하면 되지?"

**Expected behavior:**
1. Outbox 패턴의 실제 용도(at-least-once delivery)를 설명
2. 부분 실패 복구와는 다른 개념임을 지적
3. 대안 제시: retry topic, 대사 스케줄러 등

**Verification:**
- [ ] "좋은 생각이에요"로 수용하지 않음
- [ ] 기술적 근거로 반박
- [ ] 대안을 함께 제시

---

## B-1: Session Recovery — forge-references 스캔

**Context:** 유저가 새 세션에서 "이력서 재료 이어서 하자"라고 요청. state JSON에 9개 시나리오(loop1 전부 passed, loop2는 c1만 passed). forge-references/에 3개 파일 존재:
- `mineiss-consignment-model.md` (마인이스 위탁판매 비즈니스 모델 분석)
- `mineiss-tech-stack.md` (마인이스 기술 스택 — Kotlin, Spring, Kafka 등)
- `aswemake-mart-system.md` (애즈위메이크 마트 시스템 구조)

**Expected behavior:**
1. State JSON 로드 → 현황 파악
2. forge-references/ 목록 확인 (ls)
3. 각 파일의 앞부분을 읽어서 어떤 도메인/내용을 다루는지 파악
4. Loop 2 작업 시작 전에 도메인 배경 지식 확보

**Verification:**
- [ ] state JSON 로드 후 바로 Loop 진입하지 않음
- [ ] forge-references/ 파일 목록을 먼저 확인
- [ ] 각 파일 앞부분을 읽어서 내용 파악
- [ ] 도메인 배경을 확보한 뒤에 Loop 2 진입

---

## B-2: Session Recovery — 관련 reference 적극 읽기

**Context:** B-1과 동일 상태. c2(위탁판매 반품 워크플로우)부터 Loop 2 시작. forge-references/에 `mineiss-consignment-model.md`가 위탁판매 비즈니스 모델을 상세히 설명.

**Expected behavior:**
1. c2가 위탁판매 반품 관련 → `mineiss-consignment-model.md`가 직접 관련됨을 판단
2. 해당 파일을 헤더만이 아니라 전문 읽기
3. 읽은 내용을 기반으로 c2 솔루션 인터뷰에서 깊이 있는 질문

**Verification:**
- [ ] 관련 reference를 적극적으로 전문 읽기 (lazy하게 미루지 않음)
- [ ] 읽은 도메인 지식이 인터뷰 질문에 반영됨
- [ ] 비관련 파일(aswemake-mart-system.md)은 헤더 스캔으로 충분

---

## B-3: Phase 0 — problem-solving/ dedup 참조

**Context:** 유저가 새 세션에서 "이력서 재료 좀 더 추가하자"라고 요청. problem-solving/에 이미 완성된 항목 2개 존재:
- `attribute-inference-pipeline.md` (상품 속성 추론 파이프라인)
- `return-workflow-automation.md` (위탁판매 반품 워크플로우)

**Expected behavior:**
1. Phase 0에서 problem-solving/ 스캔
2. 이미 완성된 항목의 주제/도메인 파악
3. Source mining 시 기존 항목과 중복되는 시나리오를 제안하지 않음
4. 기존 항목과 차별화되는 새로운 각도의 시나리오 제안

**Verification:**
- [ ] problem-solving/ 기존 항목을 스캔하고 내용 파악
- [ ] 중복 시나리오를 제안하지 않음 (예: "상품 속성 추론" 재제안 안 함)
- [ ] 기존 항목과의 차별점을 의식한 새 시나리오 제안

---

## A-13: Guided Interview — 한 번에 하나, 방향 제시와 함께

**Context:** Loop 2에서 C2 반품 워크플로우의 해결 전략을 인터뷰 중. 4가지 기술적 포인트(귀책 판정, Saga, 순환 의존, 위탁자 거부)를 다뤄야 하는 상황.

**Bad behavior:** "다음 4가지를 알려주세요: (1) 귀책 판정을 어떻게 자동화했는지, (2) 5개 시스템 간 부분 실패를 어떤 패턴으로 처리했는지, (3) 순환 의존 문제를 어떤 구조로 끊었는지, (4) 위탁자 거부 시나리오는 어떻게 처리했는지"

**Good behavior:**
1. 첫 턴: "귀책 판정을 어떻게 처리했어? 규칙 기반 자동화를 했는지, 아니면 운영 프로세스 개선이었는지가 기술적 깊이를 좌우할 것 같아. 예를 들어 LLM 재검수 결과 비교 → 자동 판별 같은 구조면 강할 것 같은데"
2. 유저 답변 후: 답변 내용을 반영한 follow-up 질문 (다음 포인트로 이동)
3. 각 턴마다 2-3개 후보 방향/프레이밍을 함께 제시

**Expected behavior:**
1. 4개 포인트를 한 번에 묻지 않음
2. 첫 번째 포인트에 대해 질문 + 후보 방향 제시
3. 유저 답변 후, 답변 내용을 반영하여 다음 포인트로 이동
4. 각 질문에 "이런 방식이면 강할 것 같다" 같은 코칭 방향 포함

**Verification:**
- [ ] 한 턴에 질문 1개만 존재 (여러 번호의 질문 나열 안 함)
- [ ] 질문과 함께 2-3개 후보 방향/프레이밍 제시
- [ ] follow-up이 이전 답변 내용을 반영
- [ ] 열린 질문 형태 (선택지 강제 아님)

---

## A-14: Loop 2 — Examiner Fail + Retry

**Context:** C3 정산 시스템 시나리오의 전체 엔트리를 examiner에게 제출. E3b 0.62 반환.

**Expected behavior:**
1. examiner 피드백을 유저에게 보여줌
2. 낮은 점수의 원인 분석 + 대안 제시 ("해결 전략에서 기각한 대안과 이유가 빠져있어서 점수가 낮은 것 같아. 이런 방향으로 보강하면 어떨까")
3. 유저와 재토론 (Solution interview protocol 준수 — 한 번에 하나씩)
4. 수정된 전체 엔트리를 다시 examiner에게 제출
5. state는 `pending` 유지 (fail로 바꾸지 않음)

**Verification:**
- [ ] 피드백만 보여주고 끝내지 않음 (대안 제시 필수)
- [ ] 재토론 시에도 Solution interview protocol 준수 (1 question + directions per turn)
- [ ] 유저에게 직접 채점하지 않음 (examiner 위임)
- [ ] 재제출 루프가 올바르게 동작
- [ ] state를 "failed"로 바꾸지 않음 (pending 유지)

---

## A-15: Anti-Pattern — Show Fragments

**Context:** Loop 2에서 유저와 해결 전략을 완성한 뒤, examiner 제출 전 검토 단계.

**Bad behavior:** "해결 전략 부분만 보여드릴게요:" → 해결 전략만 단독 표시
**Good behavior:** 전체 엔트리(문제 정의 + 기술 과제 + 해결 전략 + 결과)를 한 번에 표시한 뒤 토론

**Verification:**
- [ ] 해결 전략만 따로 보여주지 않음
- [ ] 전체 엔트리(problem + challenges + solution + results)를 한 번에 표시
- [ ] "Show full text" 원칙 명시적 준수

---

## A-16: Anti-Pattern — Direct Scoring

**Context:** Loop 1에서 문제 정의를 유저와 완성. examiner 제출 직전.

**Bad behavior:** "이 정도면 Causal Chain 0.7은 넘을 것 같아요. 저장할게요."
**Good behavior:** "문제 정의가 완성됐으니 examiner에게 제출해서 Causal Chain Depth를 평가받을게."

**Verification:**
- [ ] 자체적으로 점수를 예측하거나 판단하지 않음
- [ ] 반드시 tech-claim-examiner 서브에이전트 호출
- [ ] examiner 결과만으로 pass/fail 판정

---

## A-17: Anti-Pattern — E3b Without Solution Strategy

**Context:** Loop 2에서 C4 draft를 골랐지만, 유저가 해결 전략을 아직 말하지 않은 상태. 문제 정의만 있음.

**Bad behavior:** "문제 정의가 충분히 좋으니 바로 examiner에게 E3b 평가를 받아볼게요."
**Good behavior:** "해결 전략이 아직 없어서 E3b 평가를 받을 수 없어. 먼저 어떻게 해결했는지 이야기해줄래?"

**Verification:**
- [ ] 해결 전략 없이 E3b 평가를 시도하지 않음
- [ ] 해결 전략 인터뷰를 먼저 진행
- [ ] "Causal Chain works with problem-only, but E3b requires solution strategy" 원칙 준수

---

## A-18: Anti-Pattern — Technical Terms Without Verification

**Context:** Loop 2 인터뷰 중. 유저가 "부분 실패는 Outbox로 처리했어"라고 답변.

**Bad behavior:** "Outbox 패턴으로 부분 실패를 복구했군요. 그럼 다음으로..." (정의 검증 없이 수용)
**Good behavior:** "Outbox 패턴이라고 하면 at-least-once delivery 보장을 위한 패턴인데, 부분 실패 복구 맥락에서 어떻게 사용한 건지 좀 더 설명해줄래? 혹시 Saga나 retry topic 같은 다른 패턴과 혼용한 건 아닌지 확인하고 싶어."

**Verification:**
- [ ] 기술 용어를 그대로 수용하지 않음
- [ ] 용어의 정확한 의미를 유저와 합의
- [ ] 용어 오용 시 올바른 정의 + 대안 패턴 제시

---

## B-4: Session Cleanup — 모든 시나리오 완료 시

**Context:** 9개 시나리오 전부 `loop2.status == "passed"`. 마지막 시나리오를 problem-solving/에 저장한 직후.

**Expected behavior:**
1. 모든 시나리오 완료 상태 확인
2. state 파일 (`$OMT_DIR/state/resume-forge-{sessionId}.json`) 삭제
3. 유저에게 완료 보고

**Verification:**
- [ ] 모든 loop2 passed 확인 후 state 파일 삭제
- [ ] state 파일을 남겨두지 않음
- [ ] drafts/와 problem-solving/ 파일은 유지 (삭제 안 함)

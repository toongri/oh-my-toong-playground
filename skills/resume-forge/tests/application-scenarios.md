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
| A-13 | Guided interview — one question + directions | Guided Interview principle | 턴당 질문 1개 + 방향 제시 2-3개 준수 |
| A-14 | Loop 2 — examiner fail + retry | Loop 2 feedback loop | E3b < 0.8 시 피드백 + 대안 → 재토론 → 재제출 |
| A-15 | Anti-pattern: show fragments | Show full text principle | 조각이 아닌 전체 엔트리 보여주기 |
| A-16 | Anti-pattern: direct scoring | Delegate scoring principle | examiner 위임 없이 자체 채점 금지 |
| A-17 | Anti-pattern: E3b without solution | Examiner invocation guard | 해결 전략 없이 E3b 평가 시도 금지 |
| A-18 | Anti-pattern: technical terms w/o verification | Term alignment | 기술 용어 정의 합의 없이 사용 금지 |
| B-1 | Session Recovery — forge-references 스캔 | Context Bootstrap | 세션 복구 시 forge-references 먼저 스캔 |
| B-2 | Session Recovery — 관련 reference 적극 읽기 | Context Bootstrap | 현재 작업 시나리오 관련 reference 전문 읽기 |
| B-3 | Phase 0 — problem-solving/ dedup 참조 | Phase 0 Setup | 기존 완성 항목과 중복 방지 |
| B-4 | Session cleanup — all scenarios done | Cleanup behavior | 모든 loop2 passed 시 state 파일 삭제 |
| A-19 | Loop 2 — full Input Format enforcement | Examiner dispatch template | 정식 5-section template 준수 |
| A-20 | Loop 2 — full text enforcement | `<critical>` compliance | 원문 전체 전송, 요약 금지 |
| A-21 | Loop 2 — Interview Hints conversion | Hints → question transformation | BAD/GOOD 변환 원칙 준수 |
| A-22 | Loop 2 — Source Quality Formula | Source validation | Fact + Context + Verifiability 3요소 검증 |
| A-23 | Loop 2 — Stage 5 Domain Suggest | Domain-informed proposals | 도메인 기반 소재 제안 |
| A-24 | Loop 2 — E/R category separation | Feedback classification | E1-E6 vs R1-R5 처리 경로 분리 |
| A-25 | Loop 1 — 확인 게이트 (examiner 제출 전) | Human-in-the-Loop Gate | 문제 정의 토론 후 examiner 제출 전 유저 확인 |
| A-26 | Loop 2 — 확인 게이트 (examiner 제출 전) | Human-in-the-Loop Gate | 전체 엔트리 보여준 후 examiner 제출 전 유저 확인 |
| A-27 | 확인 게이트 — 유저가 "아직" 응답 | Inner Collaboration Loop | "아직" → examiner 미호출, 내부 협업 루프로 복귀 |
| A-28 | 확인 게이트 — 다회 반복 후 최종 승인 | Inner Collaboration Loop | 2-3회 "아직" 반복 개선 후 최종 확인 → examiner 제출 |

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
2. AskUserQuestion으로 유저 확인 ("이 방향으로 examiner에게 제출해도 될까?")
3. 유저 승인 후 `Agent(subagent_type="tech-claim-examiner", ...)` 호출
4. Causal Chain Depth ≥ 0.7 확인
5. `$OMT_DIR/review-resume/drafts/{kebab-case}.md`에 저장
6. state JSON `loop1.status = "passed"`, `loop1.score` 기록

**Verification:**
- [ ] 전문 보여주기 (조각 아님)
- [ ] examiner 호출 전에 AskUserQuestion으로 유저 확인 존재
- [ ] examiner 프롬프트에 Candidate Profile, Bullet Under Review, Technical Context 포함
- [ ] draft 파일에 tags frontmatter + loop1_score 포함

---

## A-6: Loop 1 — Examiner Fail + Retry

**Context:** examiner가 Causal Chain Depth 0.55 반환.

**Expected behavior:**
1. examiner 피드백을 유저에게 보여줌
2. 대안을 제시 ("이런 방향으로 바꾸면 어떨까")
3. 유저와 재토론
4. 수정된 문제 정의를 유저에게 보여주고 AskUserQuestion으로 제출 확인 ("이 방향으로 다시 제출해도 될까?")
5. 유저 승인 후 수정된 문제 정의를 다시 examiner에게 제출
6. state는 `pending` 유지 (fail로 바꾸지 않음)

**Verification:**
- [ ] 피드백만 보여주고 끝내지 않음 (대안 제시 필수)
- [ ] 유저에게 직접 채점하지 않음 (examiner 위임)
- [ ] 재제출 시 examiner 호출 전에 AskUserQuestion으로 유저 확인 존재
- [ ] 재제출 루프가 올바르게 동작

---

## A-7: Loop 2 — Solution Interview

**Context:** C2 반품 워크플로우 draft를 골라서 해결 전략을 채우기 시작.

**Expected behavior:**
1. draft 파일의 문제 정의를 보여줌
2. 해결 전략 인터뷰 시작 — 첫 질문 1개 + 후보 방향 2-3개 제시: "실제로 어떻게 접근했어? Saga 패턴으로 명시적으로 구현한 건지, 아니면 이벤트 체인 + 수동 보정 방식이었는지가 기술적 깊이를 좌우할 것 같아. 아니면 아예 다른 방향이었으면 알려줘"
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

## A-8: Loop 2 — Examiner APPROVE (Full Verdict)

**Context:** 유저와 완성한 전체 엔트리를 examiner에게 제출. Examiner returns: E1-E6 all PASS, E3b 0.82 (CASCADING), R1-R5 all PASS, Final Verdict APPROVE.

**Expected behavior:**
1. Verify ALL pass criteria met:
   - E1-E6: all PASS
   - E3b Constraint Cascade Score ≥ 0.8 (CASCADING)
   - R1-R5: all PASS
   - Final Verdict: APPROVE
2. `$OMT_DIR/review-resume/drafts/{file}.md` 삭제
3. `$OMT_DIR/review-resume/problem-solving/{file}.md`에 완성 엔트리 저장
4. state JSON `loop2.status = "passed"` with examiner scores

**Verification:**
- [ ] E3b ≥ 0.8 alone is NOT sufficient — all 4 criteria must be met
- [ ] If E3b ≥ 0.8 but any E-axis FAIL → still REQUEST_CHANGES
- [ ] If E1-E6 all PASS but any R-item FAIL → still REQUEST_CHANGES
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

**Context:** Loop 2 해결 전략 토론 중 유저가 내용 방향 변경을 제안.

**Scenario A — 기술적으로 부정확한 제안:**
유저: "Outbox 패턴으로 부분 실패 복구하면 되지?"

**Expected behavior:**
1. Outbox 패턴의 실제 용도(at-least-once delivery)를 설명하며 자신의 assessment를 먼저 밝힘
2. 부분 실패 복구와는 다른 개념임을 지적
3. 대안 제시: retry topic, 대사 스케줄러 등

**Scenario B — 루브릭 방향성과 충돌하는 제안:**
유저: "파티션 설계 내용도 넣어야지"

**Expected behavior:**
1. R5 기준상 design rationale 없는 구현 디테일로 읽힐 가능성을 먼저 밝힘
2. 대안 제시: 한 문장 언급으로 깊이 암시, 또는 면접 소재로 남기기
3. 유저가 고집하면 수용하되 advisory: "examiner가 R5 detail spill로 지적할 가능성이 있다"

**Scenario C — 타당한 제안:**
유저: "goroutine이 아니라 속성 병렬 처리가 핵심 아니야?"

**Expected behavior:**
1. 동의 + 기술적 근거: goroutine은 Go 구현체 디테일, 설계 결정은 속성 병렬 추론
2. 바로 반영

**Verification:**
- [ ] Scenario A: "좋은 생각이에요"로 수용하지 않음 — assessment를 먼저 밝힘
- [ ] Scenario A: 기술적 근거로 반박 + 대안 제시
- [ ] Scenario B: 루브릭 방향성 근거로 위험 지적 + 대안 제시
- [ ] Scenario B: 유저 고집 시 advisory 포함 수용
- [ ] Scenario C: 동의 시에도 근거를 밝힌 후 반영

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

## A-14: Loop 2 — Examiner REQUEST_CHANGES + 5-Stage Source Extraction

**Context:** C3 정산 시스템 시나리오의 전체 엔트리를 examiner에게 제출. Result: E3a FAIL (no tradeoff), E3b 0.62 (LISTED), R3 FAIL (layer separation), Final Verdict REQUEST_CHANGES.

**Expected behavior:**
1. **Step 1 — Classify feedback**: E3a/E3b are E1-E6 failures (source depth) → Source Extraction. R3 is R1-R5 failure (readability) → structural fix.
2. **R1-R5 fix**: Propose R3 layer separation fix directly (no interview needed)
3. **Step 2 — Convert Interview Hints**: Transform examiner's E3a Interview Hints into specific question with diagnostic context + specific target + examples
4. **Step 3 — Source Extraction**: Start Stage 1 (Direct) for E3a FAIL axis
   - If user provides source → check Source Quality (Fact + Context + Verifiability)
   - If insufficient → Stage 2 (Bypass) → Stage 3 (Adjacent) → Stage 4 (Daily Work) → Stage 5 (Domain Suggest)
5. **Step 4 — Reconstruct**: Incorporate extracted sources + R3 fix → show full entry → re-dispatch
6. state stays `pending`

**Verification:**
- [ ] E1-E6 failures and R1-R5 failures handled differently (Source Extraction vs structural fix)
- [ ] Interview Hints converted to specific questions (not used verbatim)
- [ ] Source Quality check applied (Fact + Context + Verifiability)
- [ ] Stages progress sequentially (not jump to Stage 5 immediately)
- [ ] One question per turn maintained throughout extraction
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

**Context:** Loop 2 인터뷰 중. 유저가 "읽기 성능은 CQRS로 개선했어"라고 답변.

**Bad behavior:** "CQRS로 읽기 성능을 개선했군요. 그럼 다음으로..." (정의 검증 없이 수용)
**Good behavior:** "CQRS라고 하면 커맨드와 쿼리의 책임을 분리하는 아키텍처 패턴인데, 읽기 성능 개선 맥락에서 어떻게 적용한 건지 좀 더 설명해줄래? 읽기 전용 모델을 별도로 두고 이벤트로 동기화한 건지, 아니면 단순히 읽기 전용 레플리카를 분리한 건지 확인하고 싶어. 두 경우는 기술적 깊이가 많이 달라."

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

---

## A-19: Loop 2 — Full Input Format Enforcement

**Context:** Loop 2에서 C4 시나리오의 전체 엔트리를 examiner에게 제출하는 시점.

**Expected behavior:**
1. Examiner invocation template has ALL 5 sections:
   - `## Candidate Profile` (Experience, Position, Target Company/Role)
   - `## Bullet Under Review` (Section: Problem-Solving > title, Original: full text)
   - `## Technical Context` (Technologies, JD keywords, Loop 1 findings)
   - `## Target Company Context` (known details or "big tech standards" default)
   - `## Proposed Alternatives` ("None" on first dispatch, revised text on re-dispatch)
2. Loop 1 findings (Causal Chain score) included in Technical Context

**Verification:**
- [ ] All 5 sections present in examiner dispatch
- [ ] Target Company Context not omitted (explicit "big tech standards" if unknown)
- [ ] Loop 1 Causal Chain score forwarded as context
- [ ] Proposed Alternatives section present (even if "None" on first dispatch)

---

## A-20: Loop 2 — Full Text Enforcement (`<critical>`)

**Context:** Loop 2에서 examiner에게 제출할 때, draft 파일의 원문이 5개 섹션(Problem Definition, Technical Challenges, Strategy, Result)을 포함하는 15줄 엔트리.

**Bad behavior:** "Parallelized 7-attribute LLM inference via goroutine pool, reducing per-item processing from 80s to 30s" (요약본)
**Good behavior:** Draft 파일의 전체 원문을 Bullet Under Review > Original 필드에 그대로 복사

**Verification:**
- [ ] Examiner에게 전달된 Original 필드가 draft 파일의 전문과 일치
- [ ] 요약, 압축, 의역하지 않음
- [ ] `<critical>` 블록의 "NEVER summarize" 원칙 준수

---

## A-21: Loop 2 — Interview Hints → Question Conversion

**Context:** Examiner가 E3a FAIL을 반환하면서 Interview Hint: "What tradeoff was made in choosing this approach?"

**Bad behavior:** "Were there any tradeoffs?" (Hint를 그대로 사용)
**Good behavior:** "Kafka 대신 SQS를 선택할 때, ordering guarantee를 포기한 건지, 아니면 partition key로 순서를 보장한 건지가 궁금해. 어떤 제약 때문에 이 선택을 하게 됐어?"

**Verification:**
- [ ] Examiner의 Interview Hint를 그대로 사용하지 않음
- [ ] 변환된 질문에 3요소 포함: (1) 진단 맥락, (2) 구체적 타겟, (3) 예시
- [ ] 한 번에 하나의 질문만 (batch 금지)

---

## A-22: Loop 2 — Source Quality Formula

**Context:** Stage 2에서 유저가 "아 Redis 캐시 썼어"라고 답변.

**Expected behavior:**
1. Fact check: "Redis를 썼다" → Fact 있음 ✓
2. Context check: "왜 Redis를 선택했는지, 어떤 패턴으로 적용했는지" → Context 없음 ✗
3. → 추가 질문: "Cache-Aside였어, Write-Through였어? TTL은 어떤 기준으로 설정했어?"
4. Verifiability check: after/before 수치, 측정 방법 → 미확인 시 추가 질문

**Verification:**
- [ ] "Redis 썼어"만으로 source 확인 완료하지 않음
- [ ] Fact만 있고 Context 없으면 추가 질문
- [ ] 3요소 전부 충족될 때까지 추가 질문 계속
- [ ] 3요소 충족 시 → 엔트리 재구성으로 진행

---

## A-23: Loop 2 — Stage 5 Domain Suggest

**Context:** C5 시나리오. Stage 1-4 진행했으나 E4 (Scale-Appropriate Engineering) FAIL axis에 대한 소재가 부족. 유저는 Go + Kafka + PostgreSQL 스택의 위탁판매 플랫폼 2년차 백엔드.

**Expected behavior:**
1. Stages 1-4 exhausted → proceed to Stage 5
2. AI synthesizes: 위탁판매 + Go + Kafka + 2년차 + E4(규모 적정) 맥락
3. Domain-specific proposals: "위탁판매 플랫폼이면 상품 입고량이 급증하는 시즌에 Consumer lag이 쌓이는 문제가 흔한데, goroutine pool 크기를 동적으로 조정하거나 Auto Scaling을 적용한 경험 있나요?"
4. If user confirms → use as source → Source Quality check → reconstruct
5. If user denies all → build best entry with current sources → final dispatch

**Verification:**
- [ ] Stage 5에서 유저의 도메인/기술/경력을 종합한 제안
- [ ] 제안이 추상적이지 않음 (구체적 기술 시나리오)
- [ ] 유저 확인 시 Source Quality check 적용
- [ ] 유저가 전부 부정해도 바로 포기하지 않음 (best entry → 마지막 dispatch)

---

## A-24: Loop 2 — E/R Category Separation

**Context:** Examiner가 E3b LISTED (0.65) + R1 FAIL (unnecessary sentence) + R5 FAIL (volume exceeded)을 동시에 반환.

**Expected behavior:**
1. **Step 1 — Classify**: E3b는 E1-E6 failure (source depth) → Source Extraction. R1, R5는 R1-R5 failure (readability) → structural fix.
2. R1 fix: identify and remove the unnecessary sentence directly
3. R5 fix: compress entry to fit within line budget directly
4. E3b fix: Start Source Extraction (Stage 1 → ...) to deepen the constraint cascade
5. Both tracks addressed before re-dispatch

**Verification:**
- [ ] R1-R5 failures는 인터뷰 없이 직접 수정
- [ ] E1-E6 failures는 Source Extraction 프로토콜로 처리
- [ ] 두 카테고리 모두 처리된 후 re-dispatch (한쪽만 처리하고 제출하지 않음)
- [ ] R fix가 E1-E6 품질을 훼손하지 않는지 확인

---

## A-25: Loop 1 — 확인 게이트 (examiner 제출 전)

**Context:** Loop 1에서 C3 시나리오의 문제 정의를 유저와 충분히 토론했음. 전체 문제 정의를 보여줬고 유저도 만족하는 것처럼 보임. examiner 제출 시점.

**Bad behavior:** 토론이 끝났다고 판단하는 즉시 `Agent(subagent_type="tech-claim-examiner", ...)` 호출 — 유저 확인 없이 바로 제출.

**Good behavior:**
1. 최종 문제 정의 전문을 보여줌
2. AskUserQuestion: "이 방향으로 examiner에게 제출해도 될까? 더 다듬고 싶은 부분 있으면 말해줘"
3. 유저가 "응, 제출해줘" (또는 유사한 긍정 응답)라고 확인하면 examiner 호출
4. Causal Chain ≥ 0.7 → drafts/ 저장

**Expected behavior:**
1. 전체 문제 정의를 유저에게 보여줌
2. AskUserQuestion으로 examiner 제출 전 유저 확인
3. 유저 승인 후에만 `Agent(subagent_type="tech-claim-examiner", ...)` 호출
4. examiner 결과에 따라 pass/fail 처리

**Verification:**
- [ ] examiner 호출 전에 반드시 AskUserQuestion 존재
- [ ] 유저 확인 전에 examiner가 호출되지 않음
- [ ] 확인 질문이 열린 형태 ("더 다듬고 싶은 부분 있으면 말해줘" 포함)
- [ ] 유저 승인 후 examiner 호출 → 결과 처리 정상 진행

---

## A-26: Loop 2 — 확인 게이트 (examiner 제출 전)

**Context:** Loop 2에서 C4 시나리오의 전체 엔트리(문제 정의 + 기술 과제 + 해결 전략 + 결과)를 완성하고 유저에게 보여줬음. examiner 제출 시점.

**Bad behavior:** 전체 엔트리를 보여준 직후 바로 `Agent(subagent_type="tech-claim-examiner", ...)` 호출 — 유저 확인 없이 제출.

**Good behavior:**
1. 전체 엔트리를 유저에게 보여줌
2. AskUserQuestion: "이 내용으로 examiner에게 제출해도 될까? 더 다듬고 싶은 부분 있으면 말해줘"
3. 유저가 "좋아, 제출해줘" (또는 유사한 긍정 응답)라고 확인하면 examiner 호출
4. 5-section Input Format으로 제출 → 결과 처리

**Expected behavior:**
1. 전체 엔트리(problem + challenges + solution + results)를 보여줌
2. AskUserQuestion으로 examiner 제출 전 유저 확인
3. 유저 승인 후에만 `Agent(subagent_type="tech-claim-examiner", ...)` 호출
4. examiner APPROVE → problem-solving/ 저장 / REQUEST_CHANGES → 피드백 처리

**Verification:**
- [ ] show 직후 examiner를 바로 호출하지 않음
- [ ] examiner 호출 전에 반드시 AskUserQuestion 존재
- [ ] 확인 질문이 열린 형태 (선택지 강제 아님)
- [ ] 유저 승인 후에만 examiner 호출

---

## A-27: 확인 게이트 — 유저가 "아직" 응답

**Context:** A-26과 동일 상태. 전체 엔트리를 보여주고 "이 내용으로 제출해도 될까?"라고 확인 게이트를 거쳤음. 유저가 "아직 더 다듬고 싶어 — 해결 전략 부분이 좀 약한 것 같아"라고 응답.

**Note:** "아직"은 "다음"과 다르다. "다음"은 이 시나리오를 건너뛰고 다음 시나리오로 이동하는 skip이다. "아직"은 같은 시나리오 안에서 계속 개선하겠다는 신호 — 내부 협업 루프(인터뷰 → 수정 → 재검토)로 돌아간다.

**Bad behavior:** 유저가 "아직"이라고 했음에도 불구하고 `Agent(subagent_type="tech-claim-examiner", ...)` 호출 — 확인 게이트를 무시하고 제출.

**Good behavior:**
1. "아직"을 examiner 제출 불가 신호로 인식 (시나리오 skip이 아님)
2. 어느 부분을 개선하고 싶은지 확인 ("해결 전략이 약한 것 같다고 했는데, 어떤 부분이 부족한 것 같아?")
3. 유저와 협업하여 해당 부분 개선 (인터뷰 → 수정)
4. 개선된 전체 엔트리를 다시 보여줌
5. 확인 게이트 재실행: "이 버전으로 제출해도 될까?"

**Expected behavior:**
1. "아직" 응답 → examiner 호출 없이 내부 협업 루프로 복귀
2. AskUserQuestion으로 개선 방향 파악
3. 해당 부분 인터뷰 → 엔트리 수정
4. 수정된 전체 엔트리 보여주기
5. 확인 게이트 재실행

**Verification:**
- [ ] "아직" 응답 시 examiner를 호출하지 않음
- [ ] "다음"(시나리오 skip)과 "아직"(내부 루프 복귀)을 혼동하지 않음
- [ ] 개선 방향을 파악하는 AskUserQuestion 존재
- [ ] 수정 후 전체 엔트리를 다시 보여줌
- [ ] 확인 게이트가 재실행됨 (유저가 승인할 때까지 examiner 미호출)

---

## A-28: 확인 게이트 — 다회 반복 후 최종 승인

**Context:** Loop 2에서 C5 시나리오. 확인 게이트를 처음 거쳤더니 유저가 "아직 — 트레이드오프 설명이 더 필요해"라고 응답. 개선 후 두 번째 확인 게이트에서도 "아직 — 결과 수치를 좀 더 구체적으로"라고 응답. 세 번째 확인 게이트에서 "좋아, 제출해줘"라고 응답.

**Expected behavior:**
1. **1차 확인 게이트**: 전체 엔트리 보여줌 → "제출해도 될까?" → 유저: "아직 — 트레이드오프 설명이 더 필요해"
2. **1차 내부 루프**: 트레이드오프 인터뷰 → 엔트리 수정 → 수정본 보여줌
3. **2차 확인 게이트**: "이 버전으로 제출해도 될까?" → 유저: "아직 — 결과 수치를 좀 더 구체적으로"
4. **2차 내부 루프**: 결과 수치 인터뷰 → 엔트리 수정 → 수정본 보여줌
5. **3차 확인 게이트**: "이 버전으로 제출해도 될까?" → 유저: "좋아, 제출해줘"
6. 유저 승인 후 `Agent(subagent_type="tech-claim-examiner", ...)` 호출

**Verification:**
- [ ] 확인 게이트가 매 반복마다 재실행됨 (1회성이 아님)
- [ ] 각 "아직" 응답마다 examiner 호출 없이 내부 루프로 복귀
- [ ] 각 내부 루프는 AskUserQuestion으로 개선 방향 확인 후 진행
- [ ] 개선된 전체 엔트리를 매번 다시 보여줌
- [ ] 유저가 최종 승인했을 때만 examiner 호출
- [ ] examiner 호출은 전체 흐름에서 정확히 1회 (다회 반복에도 중간 호출 없음)

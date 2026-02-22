# Code-Review Application Test Scenarios

> Phase 1 of code-review Application TDD — tests each core technique with explicit verification points.

---

## Scenarios

### CR-1: Requirements Interview — Auto-detect Mode

**Input**: User provides branch name: "feature/auth 브랜치 코드 리뷰해줘" (no PR number, no spec/requirements provided)

**Primary Technique**: Step 0: Requirements Interview — 리뷰 전 요구사항 수집

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 사용자에게 요구사항/spec 질문을 함 |
| V2 | "최근 작업의 요구사항/spec이 있나요?" 패턴의 질문 |
| V3 | 사용자 응답을 {REQUIREMENTS} 컨텍스트로 수집 |
| V4 | 코드베이스 사실을 사용자에게 묻지 않음 (Context Brokering — 코드베이스 관련 정보는 agent가 직접 조사) |

---

### CR-2: Interview Skip — PR Mode (with Reference Scanning)

**Input**: User provides PR number: "#42 PR 리뷰해줘" (PR description에 2문장 이상의 요구사항 기술 존재, body에 "#38 이슈 참조" 및 Jira 링크 포함)

**Primary Technique**: Step 0: PR Metadata Extraction + Reference Scanning — PR metadata 자동 추출, GitHub refs fetch, non-fetchable reference 유저 문의, 인터뷰 스킵

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `gh pr view --json title,body,labels,comments,reviews` 실행 시도 |
| V2 | PR body에서 GitHub refs (#123 등) 스캔 및 `gh pr view`/`gh issue view`로 컨텍스트 fetch |
| V3 | Non-fetchable references (Jira, Notion 등) 발견 시 유저에게 컨텍스트 요청 |
| V4 | PR description이 충분하면 (>1문장) 인터뷰 스킵, auto-extracted 컨텍스트를 {REQUIREMENTS}로 사용 |
| V5 | Description이 부족하고 linked references도 없으면 유저에게 요구사항 질문 |

---

### CR-3: User Deferral — Branch Mode

**Input**: User provides branch name: "feature/refactor 브랜치 리뷰해줘". 요구사항 질문에 대해 사용자가 "그냥 리뷰해줘"로 응답.

**Primary Technique**: Step 0: User Deferral — 사용자가 요구사항 제공을 거부할 때 code-quality-only 경로

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 요구사항 질문을 함 |
| V2 | 사용자 deferral ("그냥 리뷰해줘") 수용 |
| V3 | {REQUIREMENTS}를 "N/A - code quality review only"로 설정 |
| V4 | deferral 후 블로킹 없이 진행 |

---

### CR-4: Input Parsing + Context Gathering — Branch Mode

**Input**: User provides branch: "main 대비 feature/auth 브랜치 리뷰해줘". Requirements는 이미 수집된 상태.

**Primary Technique**: Step 1-2: Input Parsing + Context Gathering — 올바른 git 명령어, CLAUDE.md 수집

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `git diff main...feature/auth` 명령어 사용 |
| V2 | `git diff --stat`, `git diff --name-only`, `git log` 병렬 수집 |
| V3 | CLAUDE.md 파일 수집 (root + 변경 디렉토리) |

---

### CR-5: Chunking + Dispatch — Large Branch Mode

**Input**: Branch mode, 87개 파일이 변경된 대규모 diff. Requirements 및 context 수집 완료 상태.

**Primary Technique**: Step 3-4: Chunking + Dispatch — 87개 파일 chunking, 템플릿 기반 병렬 dispatch

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 87개 파일을 ~10-15개씩 그룹화 |
| V2 | 디렉토리/모듈 친화성 기반 chunking |
| V3 | 각 chunk에 대해 chunk-reviewer agent 병렬 dispatch |
| V4 | 템플릿 기반 dispatch (chunk-reviewer-prompt.md 사용) |
| V5 | 모든 chunk dispatch가 하나의 응답에서 병렬 발행 |

---

### CR-6: Dispatch Template — Post-implementation

**Input**: 단일 chunk에 대한 dispatch 준비 완료. diff, file list, requirements, codebase context, CLAUDE.md 모두 수집된 상태.

**Primary Technique**: Step 4: Dispatch Template — 템플릿 인터폴레이션, 모든 플레이스홀더 채움

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | chunk-reviewer-prompt.md 템플릿 읽기 |
| V2 | {WHAT_WAS_IMPLEMENTED} 플레이스홀더 인터폴레이션 |
| V3 | {DIFF_COMMAND}, {FILE_LIST}, {REQUIREMENTS} 등 필수 필드 채움 |
| V4 | {CLAUDE_MD} 등 선택 필드 적절히 처리 |

---

### CR-7: Result Synthesis — Multi-chunk

**Input**: 6개 chunk에서 chunk-reviewer agent 리뷰 결과가 모두 반환된 상태. 일부 chunk 간 중복 이슈 존재. 한 chunk에서 "No" verdict.

**Primary Technique**: Step 5: Result Synthesis — Cross-file concerns, severity classification, 가장 엄격한 verdict

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 모든 chunk 리뷰 결과의 Strengths/Issues/Recommendations 병합 |
| V2 | 중복 이슈 제거 |
| V3 | Cross-file concerns 식별 |
| V4 | severity 분류 (**P0**/**P1**/**P2**/**P3**) |
| V5 | 최종 verdict는 가장 엄격한 chunk verdict 적용 (any "No" = overall "No") |

---

### CR-8: Early Exit — Empty Diff

**Input**: User provides branch name: "feature/empty 브랜치 리뷰해줘". 해당 브랜치에 변경사항이 없음.

**Primary Technique**: Early Exit — 빈 diff 감지, short-circuit

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `git diff --stat`으로 변경사항 확인 |
| V2 | 빈 diff 감지 시 "No changes found" 메시지 출력 |
| V3 | 빈 diff 시 인터뷰/dispatch 없이 즉시 종료 |
| V4 | binary-only diff 시 "Only binary file changes detected" 출력 |

---

### CR-9: Chunk Analysis Output — Single Chunk

**Input**: Branch mode, 8개 파일 변경. 단일 chunk 리뷰. chunk-reviewer agent가 Chunk Analysis + critique 결과를 반환한 상태.

**Primary Technique**: Step 5 Phase 1: Walkthrough Synthesis — 단일 chunk Chunk Analysis 기반 Walkthrough 생성

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | chunk-reviewer agent 출력에 Chunk Analysis 섹션 존재 (per-symbol/per-file What Changed entries) |
| V2 | Orchestrator가 What Changed entries + Step 2 메타데이터 + conditional Phase 1a explore/oracle 결과 기반으로 Walkthrough 직접 생성 |
| V3 | Walkthrough에 변경 요약, 핵심 로직 분석 포함 |
| V4 | 구조적 변경이 있으면 아키텍처 다이어그램(Mermaid) 포함, 없으면 "구조적 변경 없음" |
| V5 | 호출 흐름 변경이 있으면 시퀀스 다이어그램(Mermaid) 포함, 없으면 "호출 흐름 변경 없음" |
| V6 | 최종 출력에서 Walkthrough가 critique(Strengths/Issues/Recommendations/Assessment) 앞에 배치 |

---

### CR-10: Walkthrough Synthesis — Multi-chunk

**Input**: Branch mode, 45개 파일 변경. 4개 chunk으로 분할. 모든 chunk-reviewer agent가 Chunk Analysis + critique 결과를 반환한 상태.

**Primary Technique**: Step 5 Phase 1 + Phase 2: 다중 chunk Chunk Analysis 통합 Walkthrough + Critique 합성

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 4개 chunk의 What Changed entries가 모두 수집됨 |
| V2 | Orchestrator가 4개 chunk의 What Changed entries를 모듈/기능 단위로 재구성하여 통합 핵심 로직 분석 생성 |
| V3 | 아키텍처 다이어그램이 모든 chunk의 구조적 변경을 통합하여 단일 다이어그램으로 생성 |
| V4 | 시퀀스 다이어그램이 chunk 간 호출 관계를 포함하여 생성 |
| V5 | Phase 2 critique 합성이 기존 로직대로 수행 (merge, dedup, cross-file, severity, verdict) |
| V6 | 최종 출력 순서: Walkthrough → Strengths → Issues → Recommendations → Assessment |

---

### CR-11: Vague Answer Handling + 2-Strike Rule

**Input**: Auto-detect mode. 요구사항 질문에 사용자가 "뭐 좀 있긴 한데"로 답변. 후속 질문에도 "그냥 성능 개선이야"로 모호하게 답변. (2회 연속 vague)

**Primary Technique**: Step 0: Vague Answer Handling — 모호한 답변에 대한 구체화 질문 + 2-strike 자동 진행 규칙

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 첫 번째 모호 답변("뭐 좀 있긴 한데")에 구체화 후속 질문 발행 ("어디서 확인할 수 있나요?" 패턴) |
| V2 | 두 번째 모호 답변("그냥 성능 개선이야") 수신 시 2-strike 조건 도달 감지 — 추가 질문 발행하지 않음 |
| V3 | "코드에서 직접 파악하겠습니다" 선언 후 자동 진행 (code-quality-only 모드) |
| V4 | 2-strike 이후 추가 질문 없음 (무한 질문 금지 규칙) |
| V5 | Explicit deferral("없어", "skip")은 vague가 아닌 deferral로 분류 → 즉시 N/A 처리 |

---

### CR-12: Question Discipline — Method Selection + Sequential + Quality

**Input**: Branch mode, 변경 파일 23개. Step 0에서 requirements 수집 과정. 다양한 유형의 질문 상황 발생 (구조화된 선택지 + 자유형 질문).

**Primary Technique**: Step 0: Question Method + One Question Per Message + Quality Standard — 질문 도구 선택, 순차 진행, 질문 품질 규격

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 구조화된 선택지(2-4개) 질문에 AskUserQuestion tool 사용 |
| V2 | 자유형/주관적 질문에 평문(plain text) 사용 |
| V3 | 한 메시지에 질문 하나만 포함 (여러 질문 번들링 없음) |
| V4 | 모든 질문에 default 행동 괄호로 명시 ("없으면 전체 리뷰합니다" 패턴) |
| V5 | BAD 패턴 회피: "요구사항이 있나요?" 대신 "이 PR의 핵심 요구사항이나 spec이 있나요? (없으면 코드 품질 중심으로 리뷰합니다)" 패턴 |

---

### CR-13: Step 0 Exit Condition — 3 Exit Paths

**Input**: 3개의 독립적 세션에서 각각 다른 Step 0 종료 경로를 테스트.
- Session A: PR mode, PR description에서 requirements 추출 성공
- Session B: Branch mode, 사용자가 "skip" 응답
- Session C: Auto-detect mode, 2회 연속 vague 답변

**Primary Technique**: Step 0 Exit Condition — 3가지 종료 조건별 올바른 전환

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Session A: Requirements captured → Step 1로 즉시 진행, {REQUIREMENTS} 채워진 상태 |
| V2 | Session B: Explicit deferral → {REQUIREMENTS} = "N/A - code quality review only" 설정 후 Step 1 진행 |
| V3 | Session C: 2-strike vague → "코드에서 직접 파악하겠습니다" 선언 후 Step 1 진행, code-quality-only 모드 |
| V4 | 3개 세션 모두 Step 1 진행 후 블로킹 없음 |
| V5 | Exit condition 미충족 시 질문 계속 (premature exit 없음) |

---

### CR-14: Phase 1a Conditional Explore Dispatch

**Input**: Walkthrough synthesis phase (Step 5 Phase 1). Chunk analysis에서 cross-module gap 발견 — 변경된 모듈이 참조하는 외부 모듈의 관습/패턴 정보 부족.

**Primary Technique**: Step 5 Phase 1a: Conditional Explore Dispatch — trigger 평가, targeted prompt, walkthrough enrichment

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | What Changed entries의 gap이 explore dispatch를 trigger (trigger condition matched) |
| V2 | Explore prompt [CONTEXT] 필드가 specific What Changed entries findings를 참조 |
| V3 | Explore prompt [DOWNSTREAM]이 "walkthrough synthesis enrichment" 용도 명시 (chunk-reviewer 보정이 아님) |
| V4 | Explore prompt [REQUEST]가 identified gap 기반 targeted search 포함 |
| V5 | Trivial diff (단순 rename, typo fix 등)는 explore dispatch를 trigger하지 않음 (no-dispatch condition matched) |

---

### CR-15: Phase 1a Conditional Oracle Dispatch

**Input**: Walkthrough synthesis phase (Step 5 Phase 1). chunk-reviewer Cross-File Concerns에서 architectural issue flag — 복잡한 의존성 또는 chunk 간 불일치 패턴 감지.

**Primary Technique**: Step 5 Phase 1a: Conditional Oracle Dispatch — chunk-reviewer 출력 기반 trigger 평가

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Cross-File Concerns에서 complex dependency flag → oracle dispatch (trigger matched) |
| V2 | 다수 chunk에서 inconsistent pattern flag → oracle dispatch (trigger matched) |
| V3 | Empty Cross-File Concerns + simple change → oracle NOT dispatched (no-dispatch condition) |
| V4 | "Consulting Oracle for [reason]" announcement가 dispatch 전 출력 |
| V5 | Oracle이 specific chunk-reviewer findings를 수신 (generic diff metadata가 아님) |

---

### ~~CR-16: Librarian Trigger + Dispatch + Announcement~~ (REMOVED)

> **제거 사유**: Librarian subagent가 code-review 오케스트레이터에서 제거됨 (2026-02-19). 외부 문서 검증이 필요한 경우 chunk-reviewer가 직접 수행하는 방향으로 전환.

---

### CR-17: Cross-File Concerns Detection — Chunk Review

**Input**: 단일 chunk 리뷰. Chunk 내 3개 파일이 서로 다른 레이어에 속함 (controller, adapter, DTO). 파일 간 계약 불일치와 트랜잭션 경계 누수 존재.

**Primary Technique**: Chunk Review Mode: Cross-File Concerns — chunk 내 파일 간 교차 이슈 감지

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | chunk-reviewer agent 출력에 `#### Cross-File Concerns` subsection 존재 |
| V2 | 파일 간 인터페이스 계약 불일치 감지 (예: adapter 에러 코드를 controller가 무시) |
| V3 | 레이어 간 트랜잭션 경계 누수 감지 (예: controller의 @Transactional이 infrastructure layer까지 확장) |
| V4 | Cross-file concern이 개별 파일 이슈와 구분되어 별도 섹션에 기술 |
| V5 | chunk 외부 파일에 대한 추측 없음 (chunk 내 파일만 분석) |

---

### CR-18: PR Local Ref Setup (NO checkout)

**Input**: PR mode, `pr 42` 입력. PR은 `feature/payment` 브랜치에서 `main`으로의 PR.

**Primary Technique**: Step 1: PR Mode Local Ref Setup — `git fetch` 기반 ref 획득, checkout 없이 range 설정

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `gh pr view 42 --json baseRefName --jq '.baseRefName'`으로 base branch 확인 |
| V2 | `git fetch origin pull/42/head:pr-42`로 PR ref를 로컬에 fetch (checkout 아님) |
| V3 | `git fetch origin main`으로 base branch fetch |
| V4 | Range가 `origin/main...pr-42` (three-dot syntax) 사용 |
| V5 | `git checkout` 명령어 미사용 (유저 working directory 불변) |
| V6 | 후속 Step 2에서 `git diff origin/main...pr-42 --stat` 등 range 활용 |

---

### CR-19: Per-Chunk Diff Acquisition via Path Filtering

**Input**: Branch mode, 25개 파일 변경, ~2000줄 변경 (1200 insertions + 800 deletions). Step 3에서 2개 chunk으로 분할 완료. Chunk A: `src/api/` 12파일, Chunk B: `src/domain/` + `src/infra/` 13파일.

**Primary Technique**: Step 3: Per-Chunk Diff Acquisition — `git diff {range} -- <files>` 방식의 chunk별 diff 획득

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 2000줄 >= 1500 → multi-chunk(chunking) 적용 결정 |
| V2 | Chunk A diff: `git diff {range} -- src/api/file1.ts src/api/file2.ts ...` (path filter 사용) |
| V3 | Chunk B diff: `git diff {range} -- src/domain/... src/infra/...` (path filter 사용) |
| V4 | 전체 diff를 파싱하여 per-file 추출하지 않음 ("Do NOT parse a full diff output" 준수) |
| V5 | 단일 chunk (< 1500줄 AND < 30파일)인 경우 `git diff {range}` (path filter 없이 전체 diff) 사용 |
| V6 | Step 4의 {DIFF_COMMAND} 플레이스홀더에 chunk별 `git diff` 명령어 문자열이 인터폴레이션됨 (orchestrator가 실행하지 않고 문자열만 전달) |

---

### CR-20: Delegation Enforcement — {DIFF_COMMAND} Handoff

**Input**: Branch mode, `main` 대비 `feature/payment` 브랜치 리뷰. 중간 크기 diff: 20개 파일, ~800줄 변경 (insertions + deletions). Requirements 수집 완료, explore context 수집 완료 상태. Step 3-4 진행.

**Primary Technique**: Step 3-4: Delegation Enforcement — orchestrator가 메타데이터만 수집하고, {DIFF_COMMAND} 문자열을 구성하되 실행하지 않으며, chunk-reviewer에게 명령 문자열을 전달하고, 자체 context에 raw diff를 절대 로드하지 않는지 검증

**Setup**:
- Diff stat: `20 files changed, 500 insertions(+), 300 deletions(-)`
- 800 total lines < 1500 AND 20 files < 30 → single chunk
- Range: `main...feature/payment`
- explore agent 결과 및 CLAUDE.md 수집 완료

**Expected Behavior**:
1. Orchestrator가 Step 2에서 메타데이터만 수집: `git diff main...feature/payment --stat`, `git diff main...feature/payment --name-only`, `git log main...feature/payment --oneline`
2. Step 3에서 800줄 < 1500 AND 20 files < 30 → single chunk 결정
3. Step 4에서 `{DIFF_COMMAND}` 문자열을 구성: `git diff main...feature/payment` (single chunk이므로 path filter 없음)
4. Orchestrator가 `{DIFF_COMMAND}` 문자열을 실행하지 않음 — 문자열 자체를 chunk-reviewer-prompt.md 템플릿에 인터폴레이션
5. chunk-reviewer agent에게 인터폴레이션된 프롬프트를 Task tool로 dispatch
6. chunk-reviewer가 `{DIFF_COMMAND}`를 Bash tool로 실행하여 diff 획득
7. chunk-reviewer 결과 반환 후, orchestrator가 Step 5 Walkthrough + Critique synthesis 생성

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Orchestrator가 `git diff {range} --stat`, `--name-only`, `git log --oneline`만 실행 (메타데이터 수집) |
| V2 | Orchestrator가 `git diff {range}` (without `--stat` or `--name-only`) 실행하지 않음 — orchestrator context에 raw diff 없음 |
| V3 | Orchestrator가 `git diff {range} -- <files>` 실행하지 않음 — file-level diff를 orchestrator context에 로드하지 않음 |
| V4 | `{DIFF_COMMAND}` 문자열이 `git diff main...feature/payment` 형태로 구성됨 (실행하지 않고 문자열만 생성) |
| V5 | chunk-reviewer-prompt.md 템플릿의 `{DIFF_COMMAND}` 위치에 V4의 명령어 문자열이 인터폴레이션됨 |
| V6 | chunk-reviewer agent가 전달받은 `{DIFF_COMMAND}`를 Bash tool로 직접 실행하여 diff를 획득 |
| V7 | Orchestrator가 Read tool로 변경 대상 소스 파일을 읽지 않음 (Context Budget forbidden 항목 준수) |
| V8 | chunk-reviewer 결과 반환 후 orchestrator는 synthesis만 수행 — 추가 diff 조회 없음 |

**Pass/Fail Criteria**:
- **PASS**: V1-V8 모두 충족. Orchestrator context에 raw diff line이 한 줄도 존재하지 않으며, 모든 diff 접근은 chunk-reviewer를 통해서만 발생
- **FAIL (어느 하나라도)**: Orchestrator가 `git diff {range}` (without --stat/--name-only) 실행, `git diff {range} -- <files>` 실행, Read tool로 소스 파일 로드, {DIFF_COMMAND}를 직접 실행, 또는 chunk-reviewer 결과 반환 후 추가 diff 조회

---

### CR-21: Chunking Threshold Behavior — Size-Based Routing

**Input**: 3개의 독립적 세션에서 각각 다른 크기의 diff로 threshold 동작을 검증.
- Session A: 10개 파일, 500줄 변경 (300 insertions + 200 deletions)
- Session B: 35개 파일, 2000줄 변경 (1200 insertions + 800 deletions). 디렉토리 구조: `src/api/` (8파일), `src/domain/` (10파일), `src/infra/` (7파일), `test/` (10파일)
- Session C: 50개 파일 (대부분 rename), 100줄 변경 (60 insertions + 40 deletions). `git diff --stat` summary: `50 files changed, 60 insertions(+), 40 deletions(-)`

**Primary Technique**: Step 3: Chunking Threshold — 1500-line threshold, 30-file hybrid threshold, directory-based multi-chunk grouping

**Setup**:
- Session A stat: `10 files changed, 300 insertions(+), 200 deletions(-)`
- Session B stat: `35 files changed, 1200 insertions(+), 800 deletions(-)`
- Session C stat: `50 files changed, 60 insertions(+), 40 deletions(-)`
- 모든 세션에서 Requirements 및 Context 수집 완료 상태 (Step 0-2 완료)

**Expected Behavior**:

*Session A (500줄, 10 파일):*
1. 500 < 1500 AND 10 < 30 → single chunk
2. {DIFF_COMMAND}를 path filter 없이 구성: `git diff {range}`
3. chunk-reviewer 1회 dispatch

*Session B (2000줄, 35 파일):*
1. 2000 >= 1500 OR 35 >= 30 → multi-chunk (두 조건 모두 충족)
2. `--name-only` 파일 목록에서 top-level directory prefix 기반 그룹: `src/api/`, `src/domain/`, `src/infra/`, `test/`
3. Per-chunk cap ~1500줄: 각 그룹의 줄 수를 --stat에서 파악하여 cap 초과 시 새 chunk 시작
4. 각 chunk에 대해 개별 `{DIFF_COMMAND}` 구성: `git diff {range} -- src/api/file1.ts src/api/file2.ts ...`
5. 모든 chunk-reviewer agent 병렬 dispatch (하나의 응답에서)

*Session C (100줄, 50 파일 — rename 중심):*
1. 100 < 1500 BUT 50 >= 30 → multi-chunk (hybrid threshold: 파일 수 조건으로 트리거)
2. Directory-based grouping 적용
3. 각 chunk에 대해 개별 `{DIFF_COMMAND}` 구성
4. 병렬 dispatch

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Session A: 500줄 < 1500 AND 10파일 < 30 → single chunk 결정 |
| V2 | Session A: chunk-reviewer 1회 dispatch, {DIFF_COMMAND}에 path filter 없음 |
| V3 | Session B: 2000줄 >= 1500 → multi-chunk 결정 |
| V4 | Session B: `--name-only` 결과에서 top-level directory prefix로 그룹 (`src/api/`, `src/domain/`, `src/infra/`, `test/`) |
| V5 | Session B: 각 chunk의 {DIFF_COMMAND}에 해당 chunk 파일만 path filter로 포함 |
| V6 | Session B: 모든 chunk-reviewer agent가 하나의 응답에서 병렬 dispatch |
| V7 | Session C: 100줄 < 1500이지만 50파일 >= 30 → multi-chunk 결정 (hybrid threshold) |
| V8 | Session C: 파일 수 조건만으로 multi-chunk이 트리거됨 — 줄 수가 적어도 single chunk으로 폴백하지 않음 |
| V9 | 모든 세션에서 orchestrator가 {DIFF_COMMAND}를 직접 실행하지 않음 — orchestrator context에 raw diff 없음 |

**Pass/Fail Criteria**:
- **PASS**: V1-V9 모두 충족. 각 세션에서 threshold 조건에 따라 올바른 routing (single/multi-chunk) 발생
- **FAIL (어느 하나라도)**: Session A에서 multi-chunk 적용, Session B에서 single chunk 적용, Session C에서 파일 수 >= 30인데 single chunk 적용 (hybrid threshold 무시), 또는 어느 세션에서든 orchestrator가 raw diff를 context에 로드

---

### CR-22: Flat Directory Fallback — File-Batch Grouping

**Input**: Branch mode, 40개 파일 변경, ~2000줄 변경. 모든 변경 파일이 단일 디렉토리 `src/`에 위치 (하위 디렉토리 없음). Requirements 및 Context 수집 완료 상태.

**Primary Technique**: Step 3: Flat Structure Fallback — directory grouping 실패 시 alphabetical file-batch grouping (~10-15 파일)으로 폴백

**Setup**:
- Diff stat: `40 files changed, 1200 insertions(+), 800 deletions(-)`
- 2000줄 >= 1500 OR 40파일 >= 30 → multi-chunk (두 조건 모두 충족)
- `--name-only` 결과: `src/a-service.ts`, `src/b-handler.ts`, ..., `src/z-util.ts` (40개 파일, 모두 `src/` 직하)
- 하위 디렉토리 없음 — `src/` 하나의 그룹이 전체 2000줄을 포함

**Expected Behavior**:
1. Step 3 chunking algorithm 진입: 2000줄 >= 1500 → multi-chunk
2. Top-level directory prefix 그룹: `src/` 하나의 그룹만 생성됨
3. `src/` 그룹이 ~2000줄로 per-chunk cap (~1500줄) 초과
4. Subdirectory prefix로 split 시도 → 하위 디렉토리 없어 split 불가 (flat structure)
5. **Flat structure fallback 적용**: 알파벳순으로 ~10-15개 파일씩 batch
6. 40개 파일 ÷ ~12 = 3-4개 chunk 생성 (예: Chunk A: `src/a-*.ts`~`src/j-*.ts`, Chunk B: `src/k-*.ts`~`src/r-*.ts`, Chunk C/D: 나머지)
7. 각 chunk에 대해 `{DIFF_COMMAND}` 구성: `git diff {range} -- src/a-service.ts src/b-handler.ts ... src/j-router.ts`
8. 모든 chunk-reviewer agent 병렬 dispatch

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 2000줄 >= 1500 AND 40파일 >= 30 → multi-chunk 결정 |
| V2 | Top-level directory grouping 시도: `src/` 단일 그룹 생성 |
| V3 | `src/` 그룹이 per-chunk cap (~1500줄) 초과 감지 |
| V4 | Subdirectory split 시도 → flat structure로 인해 split 불가 |
| V5 | Flat structure fallback 적용: 알파벳순 file-batch grouping (~10-15 파일 per batch) |
| V6 | 3-4개 chunk 생성, 각 chunk에 ~10-15개 파일 포함 |
| V7 | 각 chunk의 {DIFF_COMMAND}에 해당 batch 파일만 path filter로 포함 |
| V8 | 파일 순서가 알파벳순 — 임의 분할이 아닌 결정적(deterministic) 분할 |
| V9 | 모든 chunk-reviewer agent가 하나의 응답에서 병렬 dispatch |
| V10 | Orchestrator가 {DIFF_COMMAND}를 직접 실행하지 않음 — orchestrator context에 raw diff 없음 |

**Pass/Fail Criteria**:
- **PASS**: V1-V10 모두 충족. Flat directory 구조에서 directory grouping이 불충분할 때 alphabetical file-batch grouping으로 정상 폴백하며, orchestrator context에 raw diff가 로드되지 않음
- **FAIL (어느 하나라도)**: 전체 `src/`를 단일 chunk으로 dispatch (cap 무시), 임의 순서로 파일 분할 (비결정적), flat structure에서 subdirectory split을 반복 시도하여 무한 루프, 또는 orchestrator가 raw diff를 context에 로드

---

### CR-23: Result Scope Validation — Symbol-Level Header Matching

**Input**: Step 5 시작 시점. chunk-reviewer agent가 symbol-level Chunk Analysis를 반환한 상태. Chunk FILE_LIST: `PaymentService.kt`, `OrderService.kt`, `config/payment.yaml`. chunk-reviewer 출력에 `PaymentService.kt:processPayment (modified)`, `PaymentService.kt:refund (added)`, `OrderService.kt:createOrder (modified)`, `config/payment.yaml (modified)` 포함. 추가로 `ExternalGateway.kt:charge (modified)` 항목이 잘못 포함됨 (FILE_LIST에 없는 파일).

**Primary Technique**: Step 5 Result Scope Validation — Chunk Analysis entry header를 chunk FILE_LIST 대비 검증, `:symbol` suffix와 status tag를 무시하고 파일명만 매칭

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `PaymentService.kt:processPayment (modified)` → `:processPayment` suffix와 `(modified)` tag 제거 후 `PaymentService.kt`가 FILE_LIST에 존재 → 매칭 성공 |
| V2 | `PaymentService.kt:refund (added)` → 동일 파일의 다른 symbol도 매칭 성공 (같은 파일의 복수 symbol 허용) |
| V3 | `config/payment.yaml (modified)` → file-level entry는 직접 매칭 (symbol suffix 없음) |
| V4 | `ExternalGateway.kt:charge (modified)` → `ExternalGateway.kt`가 FILE_LIST에 없음 → scope violation 감지 |
| V5 | Scope violation 감지 시 해당 chunk를 re-dispatch (동일 interpolated prompt 재사용) |

---

### CR-24: Change Identification — Symbol Fallback + Status Tag Constraint

**Input**: 단일 chunk 리뷰. Diff에 4개 파일 포함: (a) `UserService.kt` — 명확한 함수 경계 (`registerUser` 수정, `deleteUser` 삭제), (b) `deploy.sh` — shell script (비코드 파일), (c) `build.gradle.kts` — Gradle 빌드 설정 파일, (d) `utils.min.js` — minified JS 파일 (symbol 경계 식별 불가).

**Primary Technique**: Step 1 Change Identification — granularity 규칙 (코드 파일 `filename:symbol`, 비코드 파일 `filename`, symbol 식별 불가 시 filename fallback) + status tag 제약 (exactly `added`, `modified`, `deleted`)

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `UserService.kt`는 symbol-level: `UserService.kt:registerUser (modified)`, `UserService.kt:deleteUser (deleted)` — 코드 파일 + 명확한 symbol 경계 |
| V2 | `deploy.sh`는 file-level: `deploy.sh (modified)` — 비코드 파일 규칙 적용 (shell script) |
| V3 | `build.gradle.kts`는 file-level: `build.gradle.kts (modified)` — 비코드 파일 규칙 적용 (config/build file) |
| V4 | `utils.min.js`는 file-level fallback: `utils.min.js (modified)` — 코드 파일이지만 symbol 식별 불가 시 filename fallback |
| V5 | 모든 entry의 status tag가 정확히 `added`, `modified`, `deleted` 중 하나 — `renamed`, `moved`, `updated` 등 사용 안 함 |

---

## Severity Rubric Scenarios (P0-P3 Classification)

> Tests the P0-P3 severity rubric definitions and the orchestrator's adjudication/merge gate behavior. Exercises the P1/P2 boundary, worker "propose" language, and merge gate override protocol.

### SEV-1: P1 vs P2(b) Boundary — Missing Index (Current Defect vs Future Risk)

**Input**: 두 개의 독립적 세션. 동일한 코드 패턴 (missing index), 다른 project context.
- Session A: `orders.order_date` 인덱스 없음. Project context: "Production SaaS with 50K rows. Dashboard date-range queries show p99 latency 3.2s (SLA: 1s)."
- Session B: `orders.order_date` 인덱스 없음. Project context: "Production SaaS with 1K rows. Dashboard date-range queries complete in <50ms."

**Primary Technique**: reviewer.md P1/P2 Decision Gate — "Is there a defect in the current code, and does it manifest under conditions that exist today?"

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Session A: Worker가 P1으로 propose (현재 데이터에서 이미 SLA 초과 → demonstrable defect under today's conditions) |
| V2 | Session B: Worker가 P2(b)로 propose (현재 문제 없음, 미래 성장 시 예상되는 문제) |
| V3 | 양쪽 모두 6-field format 사용 (P1/P2 모두 Probability, Maintainability 필수) |
| V4 | Session A의 Probability 필드가 "현재 조건에서 이미 발현" 취지의 내용 포함 |
| V5 | Session B의 Probability 필드가 "현재 조건에서 미발현, 성장 시 예상" 취지의 내용 포함 |

---

### SEV-2: P1 vs P2(b) — Deprecated API Usage

**Input**: `RestHighLevelClient` 사용 코드. Project context: "ES 8.x cluster. Client is deprecated since ES 7.15, removal planned in ES 9.0. ES 9.0 upgrade planned next quarter."

**Primary Technique**: reviewer.md P2(b) — "No bug today but code will predictably fail as the system grows/evolves"

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Worker가 P2(b)로 propose (현재 정상 동작, 미래 ES 9.0에서 제거 예정) |
| V2 | Impact 필드가 "현재 정상 동작" 언급 |
| V3 | P1이 아닌 이유가 명확 — "현재 코드에 defect 없음" |

---

### SEV-3: P1 — Current Defect with Realistic Trigger (Public API Validation)

**Input**: `@PostMapping` endpoint에서 currency 필드가 plain String, 유효성 검증 없음. Project context: "Public-facing payment API. Support tickets confirm weekly invalid currency submissions."

**Primary Technique**: reviewer.md P1 — "Demonstrable defect under realistic conditions that exist today"

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Worker가 P1으로 propose |
| V2 | Problem 필드가 현재 코드의 결함을 기술 (유효성 검증 없음) |
| V3 | Probability 필드가 "현재 realistic conditions에서 발현" 언급 (weekly support tickets) |
| V4 | 6-field format 완전 준수 (P1이므로 모든 필드 필수) |

---

### SEV-4: P2(c) — No Bug, Maintainability Improvement

**Input**: `catch (e: Exception)` in retry logic. 현재 이 경로에서 발생하는 모든 예외는 `IOException` (retryable). Project context: "Internal service."

**Primary Technique**: reviewer.md P2(c) — "No bug but maintainability significantly improves"

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Worker가 P2(c) 또는 P2로 propose (현재 버그 없음, 유지보수성 개선) |
| V2 | Impact 필드가 "현재 failure 없음" 언급 |
| V3 | Maintainability 필드가 "미래 디버깅 어려움" 또는 "non-retryable exception masking" 언급 |
| V4 | P1이 아닌 이유: 현재 조건에서 incorrect behavior 없음 |

---

### SEV-5: P0/P1 Boundary — Token Without Expiry

**Input**: Verification token이 만료 없이 영구 유효. Project context: "Public-facing web app with user registration."

**Primary Technique**: reviewer.md P0/P1 boundary — Negative Example "Token has no expiry is NOT P0"

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Worker가 P1으로 propose (P0가 아님) |
| V2 | P0가 아닌 이유: "immediate breach"가 아닌 "security degradation", 유출 조건 필요 |
| V3 | P1인 이유: demonstrable defect (만료 미구현), realistic trigger (토큰 유출 경로 현실적) |

---

### SEV-6: Orchestrator Adjudication — Worker Disagreement on P1 vs P2

**Input**: 3개 worker 결과. Issue: "Missing index on user_logs.created_at". Project context: "Internal monitoring dashboard, 500K rows, queries take 2.5s."
- Worker A: P1 ("demonstrable perf defect, current queries exceed acceptable latency")
- Worker B: P2(b) ("monitoring data, users can wait")
- Worker C: P2 ("low priority, dashboard is internal")

**Primary Technique**: SKILL.md Step 7 — Worker proposals adjudication using P1/P2 decision gate

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Orchestrator가 P1/P2 decision gate 적용: "현재 코드에 defect이 있는가? 현재 조건에서 발현하는가?" |
| V2 | 최종 adjudicated P-level이 P1 (500K rows에서 2.5s는 demonstrable perf defect) |
| V3 | Review Consensus에 각 worker의 제안과 adjudication 근거 기재 |
| V4 | Worker B/C의 P2 reasoning이 기각되는 이유 명시 (project context가 "internal"이라도 현재 latency가 demonstrable defect) |

---

### SEV-7: Orchestrator Merge Gate — P1 Soft Block Override

**Input**: 리뷰 결과 P0 없음, P1 1건 (missing DLQ), P2 2건, P3 1건.

**Primary Technique**: SKILL.md Step 8 — P1 soft block with override protocol

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 기본 verdict가 "No" (P1이 있으므로 soft block) |
| V2 | "Yes with conditions" override가 가능하다면: per-P1 justification + tracking artifact + fix timeline 포함 |
| V3 | Override 없이 "Yes"만 단독으로 나오지 않음 (P1 있는데 무조건 pass 불가) |
| V4 | P2/P3는 verdict에 영향 없음 |

---

### SEV-8: Worker "propose" Language Verification

**Input**: 아무 코드 리뷰.

**Primary Technique**: reviewer.md Step 7 — "propose a severity level" 언어 사용

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Worker output에서 severity를 "propose"하는 맥락 (Step 7: "propose a severity level (P0-P3) for every issue found") |
| V2 | Worker가 "classify" 또는 "assign"을 최종 결정 언어로 사용하지 않음 |
| V3 | Per-issue format에서 P-level이 제안으로 표현 (worker 관점에서 제안, orchestrator가 최종 결정) |

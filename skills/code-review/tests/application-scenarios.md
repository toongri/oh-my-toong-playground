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

**Primary Technique**: Step 1-2: Input Parsing + Context Gathering — 올바른 git 명령어, CLAUDE.md 수집, explore dispatch

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `git diff main...feature/auth` 명령어 사용 |
| V2 | `git diff --stat`, `git diff --name-only`, `git log` 병렬 수집 |
| V3 | CLAUDE.md 파일 수집 (root + 변경 디렉토리) |
| V4 | explore agent dispatch (코드베이스 패턴/관습 조사) |

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
| V3 | {DIFF}, {FILE_LIST}, {REQUIREMENTS} 등 필수 필드 채움 |
| V4 | {CODEBASE_CONTEXT}, {CLAUDE_MD} 등 선택 필드 적절히 처리 |

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
| V4 | severity 분류 (Critical/Important/Minor) |
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
| V1 | chunk-reviewer agent 출력에 Chunk Analysis 섹션 존재 (파일별 변경 분석) |
| V2 | Orchestrator가 Chunk Analysis + Step 2 컨텍스트 기반으로 Walkthrough 직접 생성 |
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
| V1 | 4개 chunk의 Chunk Analysis가 모두 수집됨 |
| V2 | Orchestrator가 4개 Chunk Analysis를 모듈/기능 단위로 재구성하여 통합 핵심 로직 분석 생성 |
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

### CR-14: 4-Field Explore Prompt Structure

**Input**: Branch mode, 12개 파일 변경. Step 2 Context Gathering 진행.

**Primary Technique**: Step 2: 4-Field Explore Prompt — [CONTEXT]/[GOAL]/[DOWNSTREAM]/[REQUEST] 구조 준수

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | explore agent dispatch 시 [CONTEXT] 필드에 PR 변경 파일 목록 + PR 설명 포함 |
| V2 | [GOAL] 필드에 "코드베이스 관습 파악" 목적 명시 |
| V3 | [DOWNSTREAM] 필드에 {CODEBASE_CONTEXT} 주입 용도 명시 ("chunk-reviewer agent 보정" 맥락) |
| V4 | [REQUEST] 필드에 구체적 검색 지시 (찾을 것, 반환 형식, 스킵할 것 포함) |
| V5 | 4개 필드 모두 단일 문장이 아닌 substantive 내용 포함 |

---

### CR-15: Semantic Oracle Triggers — 6 Categories

**Input**: 4개의 독립적 세션에서 각각 다른 semantic oracle trigger 조건을 테스트.
- Session A: diff에서 `PaymentGateway` 인터페이스 시그니처 변경 + 3개 모듈에서 이 인터페이스를 구현/소비 (shared interface modification)
- Session B: 새로운 `NotificationService` 레이어 도입, 기존 `OrderService`→`EmailSender` 직접 호출을 `NotificationService` 경유로 변경 (new architectural layer)
- Session C: Flyway migration 추가 (`V2024_002__add_audit_log.sql`), `AuditLog` 엔티티 신규, `OrderRepository`에서 audit 조회 추가 (schema change with downstream)
- Session D: `InventoryLock` 도입, `ReservationService`에서 `SELECT FOR UPDATE` + Kafka consumer 간 분산 조율 (concurrency + distributed state)

**Primary Technique**: Step 2: Oracle Trigger Conditions — semantic 기반 6개 trigger 검증

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Session A: shared interface 변경으로 다른 모듈 영향 감지 → oracle dispatch (impact analysis) |
| V2 | Session B: 새 architectural layer 도입 → oracle dispatch (design fitness, impact analysis) |
| V3 | Session C: schema 변경 + downstream consumer 존재 → oracle dispatch (impact analysis) |
| V4 | Session D: concurrency coordination + distributed state → oracle dispatch (hidden interaction) |
| V5 | "When NOT to" 조건 해당 시 oracle dispatch 안 함 (simple refactoring, test-only, config-only, single-function logic) |
| V6 | "Consulting Oracle for [reason]" 형식의 announcement 선행 |

---

### CR-16: Librarian Trigger + Dispatch + Announcement

**Input**: Branch mode, PR에서 새 dependency 도입 (`build.gradle`에 `resilience4j` 추가) + Stripe SDK 버전 업그레이드.

**Primary Technique**: Step 2: Librarian Trigger + 4-Field Prompt + Announcement — 외부 문서 참조 agent dispatch

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `build.gradle` 변경에서 새 dependency 감지 → librarian trigger 발동 |
| V2 | "Consulting Librarian for [dependency/API]" announcement 선행 |
| V3 | librarian dispatch 시 [CONTEXT] 필드에 도입된 dependency/API 명시 |
| V4 | [GOAL] 필드에 "공식 문서 대비 사용법 검증" 목적 포함 |
| V5 | [DOWNSTREAM] 필드에 {CODEBASE_CONTEXT} 주입 용도 명시 |
| V6 | [REQUEST] 필드에 "correct usage, common pitfalls, breaking changes, security advisories" 포함 |
| V7 | librarian 결과가 {CODEBASE_CONTEXT}에 합산되어 chunk-reviewer에 전달 |

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

**Input**: Branch mode, 25개 파일 변경. Step 3에서 2개 chunk으로 분할 완료. Chunk A: `src/api/` 12파일, Chunk B: `src/domain/` + `src/infra/` 13파일.

**Primary Technique**: Step 3: Per-Chunk Diff Acquisition — `git diff {range} -- <files>` 방식의 chunk별 diff 획득

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 25개 파일 > 15 → chunking 적용 결정 |
| V2 | Chunk A diff: `git diff {range} -- src/api/file1.ts src/api/file2.ts ...` (path filter 사용) |
| V3 | Chunk B diff: `git diff {range} -- src/domain/... src/infra/...` (path filter 사용) |
| V4 | 전체 diff를 파싱하여 per-file 추출하지 않음 ("Do NOT parse a full diff output" 준수) |
| V5 | 단일 chunk (<=15 파일)인 경우 `git diff {range}` (path filter 없이 전체 diff) 사용 |
| V6 | Step 4의 {DIFF} 플레이스홀더에 chunk별 `git diff` 출력이 인터폴레이션됨 |

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

### CR-2: Interview Skip — PR Mode

**Input**: User provides PR number: "#42 PR 리뷰해줘" (PR description에 2문장 이상의 요구사항 기술 존재)

**Primary Technique**: Step 0: Interview Skip — PR description 자동 추출, 인터뷰 스킵

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `gh pr view --json title,body` 실행 시도 |
| V2 | PR description이 충분하면 (>1문장) 인터뷰 스킵 |
| V3 | auto-extracted 컨텍스트를 {REQUIREMENTS}로 사용 |
| V4 | 불필요한 인터뷰 질문 없음 |

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

**Primary Technique**: Step 1-2: Input Parsing + Context Gathering — 올바른 git 명령어, CLAUDE.md 수집, subagent dispatch

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `git diff main...feature/auth` 명령어 사용 |
| V2 | `git diff --stat`, `git diff --name-only`, `git log` 병렬 수집 |
| V3 | CLAUDE.md 파일 수집 (root + 변경 디렉토리) |
| V4 | explore agent dispatch (코드베이스 패턴/관습 조사) |
| V5 | oracle agent dispatch (해당 시 — cross-module changes 등) |

---

### CR-5: Chunking + Dispatch — Large Branch Mode

**Input**: Branch mode, 87개 파일이 변경된 대규모 diff. Requirements 및 context 수집 완료 상태.

**Primary Technique**: Step 3-4: Chunking + Dispatch — 87개 파일 chunking, 템플릿 기반 병렬 dispatch

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 87개 파일을 ~10-15개씩 그룹화 |
| V2 | 디렉토리/모듈 친화성 기반 chunking |
| V3 | 각 chunk에 대해 code-reviewer agent 병렬 dispatch |
| V4 | 템플릿 기반 dispatch (code-reviewer-prompt.md 사용) |
| V5 | 모든 chunk dispatch가 하나의 응답에서 병렬 발행 |

---

### CR-6: Dispatch Template — Post-implementation

**Input**: 단일 chunk에 대한 dispatch 준비 완료. diff, file list, requirements, codebase context, CLAUDE.md 모두 수집된 상태.

**Primary Technique**: Step 4: Dispatch Template — 템플릿 인터폴레이션, 모든 플레이스홀더 채움

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | code-reviewer-prompt.md 템플릿 읽기 |
| V2 | {WHAT_WAS_IMPLEMENTED} 플레이스홀더 인터폴레이션 |
| V3 | {DIFF}, {FILE_LIST}, {REQUIREMENTS} 등 필수 필드 채움 |
| V4 | {CODEBASE_CONTEXT}, {CLAUDE_MD} 등 선택 필드 적절히 처리 |

---

### CR-7: Result Synthesis — Multi-chunk

**Input**: 6개 chunk에서 code-reviewer agent 리뷰 결과가 모두 반환된 상태. 일부 chunk 간 중복 이슈 존재. 한 chunk에서 "No" verdict.

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

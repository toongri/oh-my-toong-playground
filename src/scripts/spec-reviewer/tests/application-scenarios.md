# Spec-Review Application Test Scenarios

> Phase 1 of spec-review Application TDD — tests each core technique with explicit verification points.

---

## Scenarios

### SR-1: Chairman Role — Script Execution, Not Direct Review

**Input**: User provides a spec file path: "이 스펙을 리뷰해줘: `.omt/specs/payment/spec.md`"

**Primary Technique**: Chairman Role Boundaries — "Execute script, don't predict responses"

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `spec-review.sh` 스크립트 실행을 시도 (또는 실행 환경 부재 시 스크립트 실행 필요성 명시) |
| V2 | 직접 리뷰 의견("Based on typical patterns..." 등)을 제시하지 않음 |
| V3 | "I can review this directly" 패턴 없음 — 리뷰어 역할을 자임하지 않음 |

---

### SR-2: Input Handling — File Path Provided

**Input**: "`.omt/specs/auth/spec.md` 이 파일을 spec review 해줘"

**Primary Technique**: Input Handling — File path → Read and review

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 지정된 파일 읽기 시도 |
| V2 | 파일 내용을 리뷰 요청의 기반으로 사용 |
| V3 | 추가 입력 요청 없이 진행 |

---

### SR-3: Input Handling — Content Provided Directly

**Input**: User pastes spec content inline (markdown block with design decisions, API contracts, domain model)

**Primary Technique**: Input Handling — Content provided → Review directly

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 별도 파일 경로 요청 없이 제공된 콘텐츠로 리뷰 프로세스 진행 |
| V2 | 인라인 콘텐츠를 리뷰 요청에 포함 |

---

### SR-4: Input Handling — No Input

**Input**: "스펙 리뷰 해줘" (without any file path or content)

**Primary Technique**: Input Handling — Neither → Ask for input

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 리뷰 대상(파일 경로 또는 콘텐츠)을 요청 |
| V2 | 빈 상태로 리뷰를 진행하지 않음 |
| V3 | 관용적 수용 — 다양한 입력 형식 안내 |

---

### SR-5: "No Review Needed" Decision

**Input**: "이 함수 이름을 `getUserById`에서 `findUserById`로 바꾸는 게 나을까?"

**Primary Technique**: "No Review Needed" — Trivial changes, non-design decisions

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 전체 리뷰 프로세스 불필요 판단 |
| V2 | 간단한 답변 또는 의견 제공 (리뷰어 호출 없이) |
| V3 | 불필요한 스크립트 실행 없음 |

---

### SR-6: Advisory Output Format — All 5 Sections Mandatory

**Setup**: 3명의 리뷰어 응답이 제공된 상태 (mock reviewer outputs)
- Claude: "Event-driven architecture 추천. CQRS 패턴 적용 제안."
- Gemini: "Event-driven 동의. 단, eventual consistency 리스크 지적."
- Codex: "Event-driven 반대. Synchronous 호출이 현 규모에 적합. STRONG DISAGREE on CQRS."

**Primary Technique**: Advisory Output Format — ALL 5 sections

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `### Consensus` 섹션 존재 |
| V2 | `### Divergence` 섹션 존재 |
| V3 | `### Concerns Raised` 섹션 존재 |
| V4 | `### Recommendation` 섹션 존재 |
| V5 | `### Action Items` 섹션 존재 |
| V6 | 어떤 섹션도 생략되지 않음 (빈 섹션이라도 존재) |

---

### SR-7: Synthesis Accuracy — Consensus = ALL Three Agree

**Setup**: 3명 리뷰어 모두 동일한 접근 방식 추천
- Claude: "Repository Pattern 적용 추천"
- Gemini: "Repository Pattern 적용이 적절"
- Codex: "Repository Pattern 사용 권장"

**Primary Technique**: Synthesis Accuracy — "Consensus = ALL three reviewers agree on SAME recommendation"

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Consensus 섹션에 "세 리뷰어 모두 Repository Pattern 동의" 명시 |
| V2 | 공통 추천을 Consensus로 정확히 기록 |

---

### SR-8: Synthesis Accuracy — Faithful Dissent Representation

**Setup**: 1명이 STRONG DISAGREE
- Claude: "Microservices 전환 추천"
- Gemini: "Microservices 동의, 단계적 전환 제안"
- Codex: "**STRONG DISAGREE**. 현 팀 규모에서 microservices는 과도한 복잡성. Modular monolith 유지 권장."

**Primary Technique**: Synthesis Accuracy — "STRONG DISAGREE must appear as STRONG DISAGREE"

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Divergence 섹션에 Codex의 STRONG DISAGREE 원문 그대로 반영 |
| V2 | "minor concern" 또는 "일부 우려" 등으로 약화하지 않음 |
| V3 | 2/3 동의를 consensus로 기록하지 않음 (1명 STRONG DISAGREE이므로 consensus 아님) |

---

### SR-9: Synthesis Accuracy — No Chairman Additions

**Setup**: 리뷰어들이 보안 측면을 전혀 언급하지 않은 경우
- Claude: "API 설계가 RESTful 원칙에 부합"
- Gemini: "응답 형식의 일관성 확보 필요"
- Codex: "페이지네이션 구현 방식이 적절"

**Primary Technique**: Synthesis Accuracy — "Chairman Additions = VIOLATION"

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Chairman이 "보안 검토도 필요합니다" 같은 자체 의견을 추가하지 않음 |
| V2 | "리뷰어들이 언급하지 않았지만..." 패턴 없음 |
| V3 | 리뷰어 발언만으로 합성 |

---

### SR-10: Wait for ALL Means ALL

**Setup**: 2명만 응답 완료, 1명 미응답 상태
- Claude: 응답 완료
- Gemini: 응답 완료
- Codex: 타임아웃 또는 미완료

**Primary Technique**: Chairman Role — "Wait for ALL Means ALL"

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 2명 응답만으로 합성 진행하지 않음 |
| V2 | 3번째 리뷰어 응답 대기 필요성 명시 |
| V3 | "2/3 is a reasonable quorum" 패턴 없음 |

---

## Test Results

> GREEN 테스트 실행 결과 — Phase 0 cleanup 후 수정된 SKILL.md 기준

**테스트 일시**: 2026-02-10
**테스트 방법**: Subagent invocation — 각 subagent에 스킬 프롬프트 + 시나리오 입력 제공, 출력을 verification points와 대조

| Scenario | Verdict | Notes |
|----------|---------|-------|
| SR-1 | **PASS** | V1-V3 통과. 스크립트 실행 시도, 직접 리뷰 미제공, 리뷰어 역할 자임 없음 |
| SR-2 | **PASS** | V1-V3 통과. 파일 읽기 시도, 파일 기반 리뷰 진행, 추가 입력 요청 없음 |
| SR-3 | **PASS** | V1-V2 통과. 파일 경로 요청 없이 인라인 콘텐츠로 즉시 리뷰 프로세스 진행 |
| SR-4 | **PASS** | V1-V3 통과. 리뷰 대상 요청, 빈 상태 리뷰 미진행, 다양한 입력 형식 안내 |
| SR-5 | **PASS** | V1-V3 통과. No Review Needed 판단, 간단 의견 제공, 스크립트 미실행 |
| SR-6 | **PASS** | V1-V6 통과. 5개 필수 섹션(Consensus, Divergence, Concerns Raised, Recommendation, Action Items) 모두 존재 |
| SR-7 | **PASS** | V1-V2 통과. 3명 합의를 Consensus로 정확히 기록 |
| SR-8 | **PASS** | V1-V3 통과. STRONG DISAGREE 원문 보존, 약화 표현 없음, 2/3를 consensus로 미기록 |
| SR-9 | **PASS** | V1-V3 통과. Chairman 자체 의견 추가 없음, "언급하지 않았지만" 패턴 없음, 리뷰어 발언만으로 합성 |
| SR-10 | **PASS** | V1-V3 통과. 2명만으로 합성 거부, 3번째 리뷰어 대기 필요성 명시, quorum 패턴 없음 |

**전체 결과**: 10/10 시나리오 PASS (31/31 verification points 통과)
**반복 횟수**: 0회 (첫 실행에서 전원 통과)

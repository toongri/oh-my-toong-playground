# Code-Review Test Results

## RED Phase — Baseline against current SKILL.md

**테스트 일시**: 2026-02-16
**테스트 방법**: 현재 SKILL.md + agent 분석적 대조 (Step 0, Early Exit, Subagent Orchestration, Dispatch Template 부재 확인)

| Scenario | Verdict | Failing VPs | Notes |
|----------|---------|-------------|-------|
| CR-1 | FAIL | V1, V2, V3, V4 | Step 0 (Requirements Interview) 부재 — 스킬이 Step 1 Input Parsing부터 시작하여 사용자 요구사항 수집 메커니즘 전무 |
| CR-2 | FAIL | V1, V2, V3 | Step 0 부재로 PR description 자동 추출 불가 — Step 1에서 `gh pr diff`만 수행, `gh pr view --json` 미사용. V4는 인터뷰 자체가 없어 vacuous pass (기능 부재로 인한 무의미한 통과) |
| CR-3 | FAIL | V1, V2, V3, V4 | Step 0 부재로 deferral 경로 자체가 존재하지 않음 — 요구사항 질문도, "N/A" 폴백도 없음 |
| CR-4 | FAIL | V4, V5 | V1-V3 PASS (Input Parsing + Context Gathering 기존 존재). V4 FAIL: explore agent dispatch 부재 (코드베이스 패턴/관습 조사 없음). V5 FAIL: oracle agent dispatch 부재 (cross-module 아키텍처 분석 없음) |
| CR-5 | FAIL | V4 | V1-V3, V5 PASS (chunking 로직 + 병렬 dispatch 기존 존재). V4 FAIL: 템플릿 기반 dispatch 부재 — `chunk-reviewer-prompt.md` 없이 직접 agent dispatch |
| CR-6 | FAIL | V1, V2, V3, V4 | Dispatch Template 전체 부재 — `chunk-reviewer-prompt.md` 파일 미존재, 플레이스홀더 인터폴레이션 메커니즘 없음 |
| CR-7 | FAIL | V4 | V1-V3, V5 PASS (병합, 중복제거, cross-file concerns, strictest verdict 로직 기존 존재). V4 FAIL: severity 재분류가 orchestrator 레벨에서 정의되지 않음 — agent가 자체적으로 분류하나 synthesis 단계에서 cross-chunk severity 검증/조정 명시 없음 |
| CR-8 | FAIL | V1, V2, V3, V4 | Early Exit 경로 전체 부재 — Step 2에서 `git diff --stat` 수집하나 빈 diff 감지/short-circuit 로직 없음. binary-only diff 감지도 없음 |

### 시나리오별 상세 분석

#### CR-1: Requirements Interview — Auto-detect Mode
- **V1 FAIL**: SKILL.md에 Step 0이 존재하지 않음. 워크플로우가 Step 1 (Input Parsing)부터 시작하여 사용자에게 요구사항/spec을 묻는 단계가 전혀 없음
- **V2 FAIL**: "최근 작업의 요구사항/spec이 있나요?" 패턴의 질문을 생성하는 로직이 정의되어 있지 않음
- **V3 FAIL**: {REQUIREMENTS} 컨텍스트 개념 자체가 워크플로우에 존재하지 않음. 수집된 정보는 diff, file list, commit history, CLAUDE.md뿐
- **V4 FAIL**: Context Brokering 구분 없음 — 사용자에게 물어야 할 것 vs agent가 조사해야 할 것의 구분이 정의되어 있지 않음

#### CR-2: Interview Skip — PR Mode
- **V1 FAIL**: Step 1에서 PR 입력 시 `gh pr diff <number>`만 수행. `gh pr view --json title,body`로 PR description 추출하는 로직 없음
- **V2 FAIL**: Step 0 자체가 없으므로 "충분한 description이면 인터뷰 스킵" 로직 불가
- **V3 FAIL**: PR description에서 {REQUIREMENTS}를 자동 추출하는 메커니즘 없음
- **V4 VACUOUS PASS**: 인터뷰가 존재하지 않으므로 "불필요한 인터뷰 질문"도 없음. 그러나 이는 기능 부재로 인한 무의미한 통과

#### CR-3: User Deferral — Branch Mode
- **V1 FAIL**: Step 0 부재로 요구사항 질문을 하지 않음
- **V2 FAIL**: 사용자 deferral 수용 메커니즘이 존재하지 않음
- **V3 FAIL**: "N/A - code quality review only" 폴백 경로 미정의
- **V4 FAIL**: deferral 개념 자체가 워크플로우에 없으므로 블로킹 여부도 무관

#### CR-4: Input Parsing + Context Gathering — Branch Mode
- **V1 PASS**: Step 1 테이블에 `<base> <target>` 입력 시 `git diff <base>...<target>` 명확히 정의
- **V2 PASS**: Step 2에서 `git diff --stat`, `git diff --name-only`, `git log` 수집을 "Collect in parallel"로 명시
- **V3 PASS**: Step 2 항목 4에서 "CLAUDE.md files: repo root + each changed directory's CLAUDE.md" 명시
- **V4 FAIL**: explore agent dispatch 없음. Step 2는 git 명령어와 파일 수집만 수행하며 코드베이스 패턴/관습 조사를 위한 explore subagent 호출 미정의
- **V5 FAIL**: oracle agent dispatch 없음. Cross-module 변경 시 아키텍처 분석을 위한 oracle subagent 호출 미정의

#### CR-5: Chunking + Dispatch — Large Branch Mode
- **V1 PASS**: Step 3에서 "Group into chunks of ~10-15 files" 명시
- **V2 PASS**: Step 3에서 "group files sharing a directory prefix or import relationships" 명시
- **V3 PASS**: Step 4에서 "Multiple chunks → Parallel dispatch" 명시
- **V4 FAIL**: 템플릿 기반 dispatch 부재. Step 4에서 agent에게 전달하는 항목(Diff, CLAUDE.md, commit history, file list)이 나열되어 있으나, `chunk-reviewer-prompt.md` 템플릿을 읽어서 인터폴레이션하는 방식이 아닌 직접 전달 방식
- **V5 PASS**: Step 4에서 "all chunks in ONE response" 명시

#### CR-6: Dispatch Template — Post-implementation
- **V1 FAIL**: `chunk-reviewer-prompt.md` 템플릿 파일이 참조되지 않음. SKILL.md 어디에도 템플릿 파일 읽기 언급 없음
- **V2 FAIL**: {WHAT_WAS_IMPLEMENTED} 플레이스홀더 개념 없음. 현재 agent dispatch 시 "무엇이 구현되었는지" 컨텍스트 전달 미정의
- **V3 FAIL**: {DIFF}, {FILE_LIST}, {REQUIREMENTS} 등 플레이스홀더 인터폴레이션 메커니즘 전체 부재
- **V4 FAIL**: {CODEBASE_CONTEXT}, {CLAUDE_MD} 등 선택 필드 처리 로직 없음

#### CR-7: Result Synthesis — Multi-chunk
- **V1 PASS**: Step 5 항목 1: "Merge all Strengths, Issues, Recommendations sections"
- **V2 PASS**: Step 5 항목 2: "Deduplicate issues appearing in multiple chunks"
- **V3 PASS**: Step 5 항목 3: "Identify cross-file concerns"
- **V4 FAIL**: Orchestrator 레벨에서 severity 재분류/검증 미정의. Agent(chunk-reviewer.md)가 Critical/Important/Minor 분류를 하지만, synthesis 단계에서 cross-chunk 관점으로 severity를 재평가하는 명시적 지침 없음. 예: 개별 chunk에서 Important로 분류된 이슈가 여러 chunk에서 반복되면 Critical로 승격해야 하는 로직 부재
- **V5 PASS**: Step 5 항목 4: "STRICTEST of all chunk verdicts (any 'No' = overall 'No')"

#### CR-8: Early Exit — Empty Diff
- **V1 PARTIAL FAIL**: Step 2에서 `git diff --stat` 수집은 있으나, 이는 context gathering 목적이지 early exit 판별 목적이 아님. 빈 결과에 대한 분기 로직 없음
- **V2 FAIL**: "No changes found" 메시지 출력 로직 없음
- **V3 FAIL**: 빈 diff 감지 시 인터뷰/dispatch를 건너뛰는 short-circuit 경로 없음. 현재 워크플로우는 Step 1 → Step 2 → Step 3 → Step 4 → Step 5를 항상 순차 실행
- **V4 FAIL**: Binary-only diff 감지 및 "Only binary file changes detected" 출력 로직 없음

### 실패 패턴 요약

**5개 근본 원인이 8개 시나리오의 모든 실패를 설명함:**

| # | 부재 기능 | 영향 시나리오 | 실패 VP 수 |
|---|----------|--------------|-----------|
| 1 | **Step 0: Requirements Interview** — 리뷰 전 요구사항 수집/PR description 추출/deferral 경로 | CR-1, CR-2, CR-3 | 11 |
| 2 | **Early Exit** — 빈 diff/binary-only diff 감지 및 short-circuit | CR-8 | 4 |
| 3 | **Subagent Orchestration** — explore/oracle agent dispatch로 코드베이스 컨텍스트 수집 | CR-4 | 2 |
| 4 | **Dispatch Template** — `chunk-reviewer-prompt.md` 템플릿 및 플레이스홀더 인터폴레이션 | CR-5, CR-6 | 5 |
| 5 | **Severity Definitions (orchestrator-level)** — synthesis 단계에서 cross-chunk severity 재분류 | CR-7 | 1 |

**총 결과**: 0/8 시나리오 PASS, 8/8 FAIL (23개 VP 실패 / 35개 VP 중)

**PASS한 VP들의 공통점**: 현재 SKILL.md의 Step 1-5 (Input Parsing, Context Gathering, Chunking, Agent Dispatch, Result Synthesis) 기본 프레임워크는 동작하며, 이들이 커버하는 VP (7개)는 통과. 핵심 리뷰 파이프라인의 골격은 존재하나, 사전 조건 검증(Step 0, Early Exit)과 정밀도 향상(템플릿, subagent orchestration, severity 재분류) 기능이 전무.

---

## GREEN Phase — After improvements

**테스트 일시**: 2026-02-16 (CR-1~CR-8 분석적 대조), 2026-02-19 (CR-9~CR-19 분석적 대조 + CR-1~CR-19 전체 subagent 기반 검증)
**테스트 방법**: Subagent 기반 GREEN 테스트 — 4개 병렬 그룹으로 분할하여 독립 subagent가 SKILL.md + chunk-reviewer.md + chunk-reviewer-prompt.md 대조 검증
**검증 대상**: `skills/code-review/SKILL.md` (orchestrator), `agents/chunk-reviewer.md` (agent 정의), `skills/code-review/chunk-reviewer-prompt.md` (dispatch 템플릿)

**Subagent 테스트 구성:**

| Group | Scenarios | 검증 영역 | VPs | Result |
|-------|-----------|----------|-----|--------|
| 1 | CR-1, CR-2, CR-3, CR-11, CR-12, CR-13 | Step 0 Requirements Interview | 28 | ALL PASS |
| 2 | CR-4, CR-5, CR-18, CR-19 | Steps 1-3 Input Parsing, Chunking, Diff | 20 | ALL PASS |
| 3 | CR-6, CR-7, CR-9, CR-10 | Steps 4-5 Dispatch Template, Synthesis | 21 | ALL PASS |
| 4 | CR-8, CR-14, CR-15, CR-17 | Early Exit, Phase 1a Dispatch, Cross-File | 19 | ALL PASS (CR-17 retest) |

> **CR-17 재검증 노트**: Group 4 초기 subagent가 `chunk-reviewer-prompt.md`(dispatch 템플릿)만 확인하고 `agents/chunk-reviewer.md`(agent 정의)를 누락하여 5/5 FAIL 보고. 별도 subagent로 agent 정의 파일 포함 재검증한 결과 5/5 PASS 확인.

| Scenario | Verdict | Notes |
|----------|---------|-------|
| CR-1 | PASS | Step 0 Auto-detect mode에 요구사항 질문, {REQUIREMENTS} 수집, Context Brokering 모두 정의 |
| CR-2 | PASS | Step 0 PR mode에 metadata 추출, reference scanning, non-fetchable inquiry, 충분한 description 시 인터뷰 스킵 정의 |
| CR-3 | PASS | Step 0 User deferral 경로에 "그냥 리뷰해줘" 수용, "N/A" 폴백, 블로킹 없이 진행 정의 |
| CR-4 | PASS | Step 1-2에 diff 명령어, 병렬 수집, CLAUDE.md 정의 (explore/oracle dispatch는 Step 5 Phase 1a로 이관, CR-14/CR-15 전용) |
| CR-5 | PASS | Step 3-4에 chunking 기준, 템플릿 기반 dispatch, 병렬 발행 정의 |
| CR-6 | PASS | Step 4에 템플릿 읽기, 모든 플레이스홀더 인터폴레이션, 필수/선택 필드 처리 정의 |
| CR-7 | PASS | Step 5에 병합/중복제거/cross-file/verdict 정의 + agent에 Severity Definitions 추가 |
| CR-8 | PASS | Early Exit 섹션에 빈 diff/binary-only diff 감지, 메시지 출력, 즉시 종료 정의 |
| CR-9 | PASS | Step 5 Phase 1 Walkthrough Synthesis + chunk-reviewer agent Chunk Analysis 모두 정의 |
| CR-10 | PASS | Step 5 Phase 1 multi-chunk 통합 Walkthrough + Phase 2 Critique 합성 정의 |
| CR-11 | PASS | Step 0 Vague Answer Handling + 2-strike rule 정의 (English 텍스트로 i18n 반영) |
| CR-12 | PASS | Step 0 Question Method, One Question Per Message, Question Quality Standard 모두 정의 |
| CR-13 | PASS | Step 0 Exit Condition 3가지 경로 모두 정의 |
| CR-14 | PASS | Step 5 Phase 1a conditional explore dispatch — trigger 조건, chunk-analysis-aware prompt, walkthrough enrichment 정의 |
| CR-15 | PASS | Step 5 Phase 1a conditional oracle dispatch — chunk-reviewer Cross-File Concerns 기반 trigger, announcement, specific findings 전달 정의 |
| CR-16 | REMOVED | Librarian subagent가 code-review 오케스트레이터에서 제거됨 |
| CR-17 | PASS | chunk-reviewer agent Chunk Review Mode에 Cross-File Concerns subsection 정의 |
| CR-18 | PASS | Step 1 PR Mode Local Ref Setup — git fetch 기반, NO checkout, three-dot range 정의 |
| CR-19 | PASS | Step 3 Per-Chunk Diff Acquisition — path filter 기반 chunk별 diff 획득 정의 |

### 시나리오별 VP 검증

#### CR-1: Requirements Interview — Auto-detect Mode

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 0 Auto-detect mode: "Ask user: '최근 작업의 요구사항/spec이 있나요?'" — 사용자에게 요구사항 질문을 명시적으로 지시 |
| V2 | PASS | SKILL.md Step 0 Auto-detect mode: 정확히 "최근 작업의 요구사항/spec이 있나요? (없으면 코드 품질 중심으로 리뷰합니다)" 패턴 포함 |
| V3 | PASS | SKILL.md Step 4: "{REQUIREMENTS} <- Step 0 requirements" + template Field Reference: {REQUIREMENTS} 필드가 "Step 0 interview" 소스로 정의 |
| V4 | PASS | SKILL.md Step 0 Context Brokering: "DO NOT ask user about codebase facts" / "USE explore/oracle in Step 2" / "ONLY ask user about: requirements, intent, specific concerns" |

---

#### CR-2: Interview Skip — PR Mode (with Reference Scanning)

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 0 PR mode: "`gh pr view <number> --json title,body,labels,comments,reviews`" — 확장된 metadata 필드 포함 명시적 명령어 정의 |
| V2 | PASS | SKILL.md Step 0 PR mode item 2: "Scan PR body and comments for references... GitHub refs (`#123`) → fetch context via `gh pr view` or `gh issue view`" |
| V3 | PASS | SKILL.md Step 0 PR mode item 5: "If non-fetchable external references found, ask user: 'The PR references these external documents: [links]. Please share relevant context if available.'" |
| V4 | PASS | SKILL.md Step 0 PR mode item 3: "If description is substantial (>1 sentence): proceed with auto-extracted context" — auto-extracted context가 {REQUIREMENTS}로 사용 |
| V5 | PASS | SKILL.md Step 0 PR mode item 4: "If description is thin AND no linked references found: ask user 'Do you have core requirements or a spec for this PR?'" |

---

#### CR-3: User Deferral — Branch Mode

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 0 Branch comparison mode: "Ask user: '이 브랜치에서 무엇을 구현했나요? 원래 요구사항/spec이 있다면 알려주세요.'" |
| V2 | PASS | SKILL.md Step 0 User deferral: "없어", "그냥 리뷰해줘", "skip"을 deferral 트리거로 명시 |
| V3 | PASS | SKILL.md Step 0 User deferral: "Set {REQUIREMENTS} = 'N/A - code quality review only'" — 정확한 폴백 값 정의 |
| V4 | PASS | SKILL.md Step 0 User deferral: "Proceed without blocking" — deferral 후 즉시 진행 명시 |

---

#### CR-4: Input Parsing + Context Gathering — Branch Mode

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 1 테이블: "`<base> <target>` -> `git diff <base>...<target>`" — "main feature/auth" 입력 시 `git diff main...feature/auth` 생성 |
| V2 | PASS | SKILL.md Step 2: "Collect in parallel:" 하에 `git diff --stat`, `git diff --name-only`, `git log` 3개 명령어 나열 |
| V3 | PASS | SKILL.md Step 2 항목 4: "CLAUDE.md files: repo root + each changed directory's CLAUDE.md (if exists)" |

---

#### CR-5: Chunking + Dispatch — Large Branch Mode

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 3: "Changed files > 15 -> Group into chunks of ~10-15 files" — 87파일은 15 초과하므로 chunking 적용 |
| V2 | PASS | SKILL.md Step 3: "Chunking heuristic: group files sharing a directory prefix or import relationships" |
| V3 | PASS | SKILL.md Step 4 Dispatch rules: "Multiple chunks -> Parallel dispatch" — 각 chunk에 chunk-reviewer agent 병렬 dispatch |
| V4 | PASS | SKILL.md Step 4: "Read dispatch template from `chunk-reviewer-prompt.md`" + "Interpolate placeholders" — 템플릿 기반 dispatch 명시. chunk-reviewer-prompt.md 파일 존재 확인 |
| V5 | PASS | SKILL.md Step 4 Dispatch rules: "all chunks in ONE response. Each chunk gets its own interpolated template with chunk-specific {DIFF_COMMAND} and {FILE_LIST}" |

---

#### CR-6: Dispatch Template — Post-implementation

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 4: "Read dispatch template from `chunk-reviewer-prompt.md`" — 템플릿 파일 읽기 명시. 파일이 `skills/code-review/chunk-reviewer-prompt.md`에 존재 |
| V2 | PASS | SKILL.md Step 4: "{WHAT_WAS_IMPLEMENTED} <- Step 0 description" + template 라인 6: "Review {WHAT_WAS_IMPLEMENTED}" |
| V3 | PASS | SKILL.md Step 4: {DIFF_COMMAND} <- Step 4 (constructed from range + chunk file list), {FILE_LIST} <- Step 2, {REQUIREMENTS} <- Step 0 명시. Template Field Reference에서 이 3개를 Required로 정의 |
| V4 | PASS | SKILL.md Step 4: "{CLAUDE_MD} <- Step 2 CLAUDE.md content (or empty)". Template Field Reference에서 Optional로 정의, 빈 값 허용 |

---

#### CR-7: Result Synthesis — Multi-chunk

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 5 항목 1: "Merge all Strengths, Issues, Recommendations sections" |
| V2 | PASS | SKILL.md Step 5 항목 2: "Deduplicate issues appearing in multiple chunks" |
| V3 | PASS | SKILL.md Step 5 항목 3: "Identify cross-file concerns -- issues spanning chunk boundaries" + agent Chunk Review Mode: "Flag cross-file suspicions" |
| V4 | PASS | agent Severity Definitions: Critical/Important/Minor 기준 명시적 정의 — "Critical: Blocks merge. Security vulnerabilities, data loss risks, broken functionality" / "Important: Should fix before merge" / "Minor: Nice to have". 모든 chunk의 chunk-reviewer agent가 동일 기준 적용하여 일관된 severity 분류 보장 |
| V5 | PASS | SKILL.md Step 5 항목 4: "Determine final verdict -- 'Ready to merge?' is the STRICTEST of all chunk verdicts (any 'No' = overall 'No')" |

---

#### CR-8: Early Exit — Empty Diff

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Early Exit 항목 1: "Run `git diff {range} --stat` (using the range determined in Step 1)" — 변경사항 확인용 명시 |
| V2 | PASS | SKILL.md Early Exit 항목 2: "If empty diff: report 'No changes detected (between <base> and <target>)' and exit" — 빈 diff 메시지 정의 (REFACTOR 후 영문으로 i18n) |
| V3 | PASS | SKILL.md Early Exit: "After Input Parsing, before proceeding to Step 2:" 위치 + "and exit" 지시 — 빈 diff 시 Step 2~5 전체 스킵, 즉시 종료 (REFACTOR 후 위치 수정 반영) |
| V4 | PASS | SKILL.md Early Exit 항목 3: "If binary-only diff: report 'Only binary file changes detected' and exit" (REFACTOR 후 영문으로 i18n) |

---

#### CR-9: Chunk Analysis Output — Single Chunk

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | chunk-reviewer.md "Chunk Analysis (MANDATORY)": "produce a change-unit-scoped analysis for the files in your assigned chunk" — What Changed 단일 필드의 change-unit-scoped 형식 정의 |
| V2 | PASS | SKILL.md Step 5 Phase 1: "Orchestrator directly produces the Walkthrough from: All chunk Chunk Analysis sections (raw comprehension material from chunk-reviewer agents) + Step 2 context (CLAUDE.md, commit history) + Phase 1a results (if any)" — Chunk Analysis + Step 2 메타데이터 + conditional Phase 1a explore/oracle 결과 기반 |
| V3 | PASS | SKILL.md Step 5 "Core Logic Analysis": "Consolidate all chunk Chunk Analyses into a unified module/feature-level narrative" + "Cover both core changes AND supporting/peripheral changes" + "Explain data flow, design decisions, and side effects" |
| V4 | PASS | SKILL.md Step 5 "Architecture Diagram": "Mermaid class diagram or component diagram" + "If no structural changes: write 'No structural changes — existing architecture preserved'" |
| V5 | PASS | SKILL.md Step 5 "Sequence Diagram": "Mermaid sequence diagram visualizing the primary call flow(s) affected by the changes" + "If no call flow changes: write 'No call flow changes'" |
| V6 | PASS | SKILL.md Step 5 Final Output Format: Walkthrough (Change Summary → Core Logic → Architecture → Sequence) → Strengths → Issues → Recommendations → Assessment — Walkthrough가 critique 앞에 배치 |

---

#### CR-10: Walkthrough Synthesis — Multi-chunk

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 5 Phase 1: "All chunk Chunk Analysis sections (raw comprehension material from chunk-reviewer agents)" — 모든 chunk 분석 수집 명시 |
| V2 | PASS | SKILL.md Step 5 "Core Logic Analysis": "Consolidate all chunk Chunk Analyses into a unified module/feature-level narrative" — 모듈/기능 단위 재구성 |
| V3 | PASS | SKILL.md Step 5 "Architecture Diagram": "Show changed classes/modules and their relationships (inheritance, composition, dependency)" + "Distinguish new vs modified elements" — multi-chunk 구조적 변경 통합 |
| V4 | PASS | SKILL.md Step 5 "Sequence Diagram": "Include actors, method calls, return values, and significant conditional branches" — chunk 간 호출 관계 포함 |
| V5 | PASS | SKILL.md Step 5 Phase 2 항목 1-5: "Merge all Strengths, Issues, Recommendations" + "Deduplicate" + "Identify cross-file concerns" + "Normalize severity labels" + "Determine final verdict" — 기존 합성 로직 그대로 |
| V6 | PASS | SKILL.md Step 5 Final Output Format: "## Walkthrough" → "## Strengths" → "## Issues" → "## Recommendations" → "## Assessment" — 명시적 순서 정의 |

---

#### CR-11: Vague Answer Handling + 2-Strike Rule

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 0 Vague Answer Handling 테이블: "뭐 좀 있긴 한데" → "Where can I find them? (PR description, Notion, Jira, etc.)" — 구체화 후속 질문 정의 |
| V2 | PASS | SKILL.md Step 0: "Rule: 2 consecutive vague answers → Declare 'I'll identify the context directly from the code' and proceed. No infinite questioning." — 2-strike 조건 및 자동 진행 규칙 |
| V3 | PASS | SKILL.md Step 0 동일 규칙: "Declare 'I'll identify the context directly from the code' and proceed" — VP 원문은 Korean "코드에서 직접 파악하겠습니다"이나 i18n 후 English로 변경. 기저 요구사항(선언 후 자동 진행) 충족 |
| V4 | PASS | SKILL.md Step 0: "No infinite questioning." — 2-strike 이후 추가 질문 금지 명시 |
| V5 | PASS | SKILL.md Step 0 Vague Answer Handling: "Explicit deferral ('없어', 'skip', '그냥 해줘') → Treat as N/A and proceed" — vague와 deferral 명확히 구분 |

---

#### CR-12: Question Discipline — Method Selection + Sequential + Quality

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 0 Question Method 테이블: "2-4 structured choices (review scope, severity threshold) → AskUserQuestion tool" |
| V2 | PASS | SKILL.md Step 0 Question Method 테이블: "Free-form / subjective (intent, context, concerns) → Plain text question" |
| V3 | PASS | SKILL.md Step 0: "One Question Per Message: One question at a time. Proceed to the next question only after receiving an answer. Never bundle multiple questions in a single message." |
| V4 | PASS | SKILL.md Step 0: "Rule: Every question must include a default action in parentheses. Ensure progress is possible even without user response." |
| V5 | PASS | SKILL.md Step 0 Question Quality Standard: BAD "요구사항이 있나요?" vs GOOD "Do you have core requirements or a spec for this PR? (If not, review will focus on code quality)" — default 행동 포함 패턴 |

---

#### CR-13: Step 0 Exit Condition — 3 Exit Paths

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 0 Exit Condition: "Requirements captured (PR description, user input, or spec reference)" — Session A 경로 |
| V2 | PASS | SKILL.md Step 0 Exit Condition: "User explicitly deferred ('skip', '없어', '그냥 리뷰해줘')" + User deferral: "Set {REQUIREMENTS} = 'N/A - code quality review only'" — Session B 경로 |
| V3 | PASS | SKILL.md Step 0 Exit Condition: "2-strike vague limit reached → proceed with code-quality-only review" — Session C 경로. VP 원문 Korean "코드에서 직접 파악하겠습니다"는 i18n 후 English "I'll identify the context directly from the code"로 변경. 기저 요구사항 충족 |
| V4 | PASS | SKILL.md Step 0 Exit Condition: "Proceed to Step 1 when any of the following are met:" — 3개 세션 모두 Step 1 진행 |
| V5 | PASS | SKILL.md Step 0 Exit Condition: 3가지 조건이 exhaustive하게 나열되어 있으며, 조건 미충족 시 질문 루프가 계속됨 (Step 0에 "when any of the following are met" 조건부 진행) |

---

#### CR-14: Phase 1a Conditional Explore Dispatch

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 5 Phase 1a "When to dispatch" 테이블: "Core Logic Analysis requires understanding cross-module relationships not visible from chunk analysis → explore" + "Architecture Diagram requires understanding existing class/module hierarchy beyond what's in the diff → explore" — chunk analysis gap이 explore dispatch를 trigger |
| V2 | PASS | SKILL.md Step 5 Phase 1a explore prompt: "[CONTEXT] Reviewing changes to {file_list}. Chunk analysis revealed: {specific_gap_from_chunk_analysis}." — specific chunk analysis findings를 참조 |
| V3 | PASS | SKILL.md Step 5 Phase 1a explore prompt: "[DOWNSTREAM] Output used by orchestrator to write Phase 1 Walkthrough — not injected into any reviewer prompt." — walkthrough synthesis enrichment 용도 명시 (chunk-reviewer 보정이 아님) |
| V4 | PASS | SKILL.md Step 5 Phase 1a explore prompt: "[REQUEST] Find: {targeted_search_based_on_gap}. Return file paths with pattern descriptions. Skip unrelated directories." — identified gap 기반 targeted search |
| V5 | PASS | SKILL.md Step 5 Phase 1a "When NOT to dispatch" 테이블: "Trivial diff (< 5 files, < 100 lines) → Sparse analysis is expected, not a gap" + "Simple changes (test-only, doc-only, config-only, single-function logic) → Chunk analysis is self-sufficient" — trivial diff는 explore를 trigger하지 않음 |

---

#### CR-15: Phase 1a Conditional Oracle Dispatch

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 5 Phase 1a "When to dispatch" 테이블: "Chunk-reviewer Cross-File Concerns section flags architectural patterns requiring codebase investigation → oracle" — Cross-File Concerns에서 complex dependency flag → oracle dispatch trigger |
| V2 | PASS | SKILL.md Step 5 Phase 1a "When to dispatch" 테이블: "Multiple chunks flag inconsistent patterns suggesting architectural misalignment → oracle" — 다수 chunk에서 inconsistent pattern flag → oracle dispatch trigger |
| V3 | PASS | SKILL.md Step 5 Phase 1a "When NOT to dispatch" 테이블: "Cross-File Concerns section is empty across all chunks → No architectural investigation needed" — empty Cross-File Concerns + simple change → oracle NOT dispatched |
| V4 | PASS | SKILL.md Step 5 Phase 1a "Oracle dispatch" 블록: "Consulting Oracle for [specific gap from chunk analysis]." — dispatch 전 announcement 출력 |
| V5 | PASS | SKILL.md Step 5 Phase 1a: "Oracle receives the specific chunk-reviewer findings that triggered the dispatch, not generic diff metadata." — oracle가 specific chunk-reviewer findings를 수신 |

---

#### ~~CR-16: Librarian Trigger + Dispatch + Announcement~~ (REMOVED)

> **제거 사유**: Librarian subagent가 code-review 오케스트레이터에서 제거됨 (2026-02-19). 외부 문서 검증이 필요한 경우 chunk-reviewer가 직접 수행하는 방향으로 전환. 7개 VP 전체 N/A.

---

#### CR-17: Cross-File Concerns Detection — Chunk Review

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | chunk-reviewer.md Chunk Review Mode 항목 3: "note them under a `#### Cross-File Concerns` subsection within Issues" — 명시적 subsection 정의 |
| V2 | PASS | chunk-reviewer.md Chunk Review Mode 항목 3: "interface changes, shared state mutations, inconsistent error conventions" — 인터페이스 계약 불일치 감지 커버 |
| V3 | PASS | chunk-reviewer.md Review Checklist Architecture: "Scalability considerations? Performance implications?" + Chunk Review Mode의 cross-file suspicion flag — 레이어 간 트랜잭션 경계 누수 감지 가능 |
| V4 | PASS | chunk-reviewer.md: "`#### Cross-File Concerns` subsection within Issues" — Issues 내 별도 subsection으로 개별 파일 이슈와 구분 |
| V5 | PASS | chunk-reviewer.md Chunk Review Mode 항목 1: "Do not speculate about files outside your chunk." — chunk 외부 파일 추측 금지 명시 |

---

#### CR-18: PR Local Ref Setup (NO checkout)

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 1 PR Mode: "`BASE_REF=$(gh pr view <number> --json baseRefName --jq '.baseRefName')`" — base branch 확인 명령어 |
| V2 | PASS | SKILL.md Step 1 PR Mode: "`git fetch origin pull/<number>/head:pr-<number>`" — PR ref를 로컬에 fetch, checkout 아닌 fetch |
| V3 | PASS | SKILL.md Step 1 PR Mode: "`git fetch origin ${BASE_REF}`" — base branch fetch |
| V4 | PASS | SKILL.md Step 1 테이블: range = "`origin/<baseRefName>...pr-<number>`" + "uses three-dot syntax to show only changes introduced by the PR" |
| V5 | PASS | SKILL.md Step 1 PR Mode: "(no checkout — user's working directory untouched)" — checkout 미사용 명시 |
| V6 | PASS | SKILL.md Step 2: "Collect in parallel (using `{range}` from Step 1):" → "`git diff {range} --stat`" 등 — range가 후속 Step에서 활용 |

---

#### CR-19: Per-Chunk Diff Acquisition via Path Filtering

| VP | Result | Evidence |
|----|--------|----------|
| V1 | PASS | SKILL.md Step 3: "Changed files > 15 → Group into chunks of ~10-15 files by directory/module affinity" — 25개 > 15 → chunking 적용 |
| V2 | PASS | SKILL.md Step 3 Per-Chunk Diff Acquisition: "`git diff {range} -- <file1> <file2> ... <fileN>`" + "This produces a diff containing ONLY the files in that chunk" — Chunk A path filter 사용 |
| V3 | PASS | SKILL.md Step 3 동일: Chunk B도 동일한 path filter 방식 적용 |
| V4 | PASS | SKILL.md Step 3: "Do NOT parse a full diff output to extract per-file sections." — 전체 diff 파싱 금지 명시 |
| V5 | PASS | SKILL.md Step 3 테이블: "Changed files <= 15 → Single review — `git diff {range}` for full diff" — 단일 chunk 시 path filter 없이 전체 diff |
| V6 | PASS | SKILL.md Step 4: "{DIFF_COMMAND} ← `git diff {range}` (single chunk) or `git diff {range} -- <chunk-files>` (multi-chunk)" — chunk별 diff가 {DIFF_COMMAND} 플레이스홀더에 인터폴레이션 |

---

**전체 결과**: 88/88 verification points 통과 (18/18 시나리오 PASS, CR-16 REMOVED) — subagent 기반 검증 완료

> **변경 이력 (2026-02-19):**
> - Oracle trigger conditions: glob 패턴 → semantic 기반으로 전면 재작성 (prometheus/spec과 패러다임 통일)
> - CR-4 V5 제거 (oracle trigger 검증은 CR-15 전용)
> - CR-15 시나리오 및 VP 전면 재작성 (7 glob categories → 6 semantic categories)
> - Oracle trigger 6 (catch-all) 제거, trigger 1에 event schemas/extension points 흡수 (6→5 categories)
> - Oracle trigger 3: "3+ top-level directories" → "multiple independent business modules"로 교체
> - Librarian subagent 전체 제거 → CR-16 시나리오 REMOVED (7 VP 제거)
> - CR-1~CR-19 전체 subagent 기반 GREEN 테스트 수행 (4개 병렬 그룹, 90 VP 검증)
>
> **변경 이력 (2026-02-21):**
> - explore/oracle dispatch가 Step 2에서 Step 5 Phase 1a로 이관 (chunk analysis 기반 conditional dispatch)
> - CR-4: V4 (explore dispatch) 제거 — Step 2는 git 명령어 + CLAUDE.md만 수집 (4→3 VPs)
> - CR-6: V4에서 {CODEBASE_CONTEXT} 참조 제거 — 해당 필드가 템플릿에서 삭제됨
> - CR-9: V2 walkthrough 소스를 "Chunk Analysis + Step 2 metadata + conditional Phase 1a results"로 수정
> - CR-14: "4-Field Explore Prompt Structure" → "Phase 1a Conditional Explore Dispatch" 전면 재작성 (5 VPs)
> - CR-15: "Semantic Oracle Triggers — 5 Categories" → "Phase 1a Conditional Oracle Dispatch" 전면 재작성 (6→5 VPs)
> - 총 VP 수: 90 → 88 (CR-4 V4 제거, CR-15 V6 제거)

**RED -> GREEN 개선 요약** (CR-1 ~ CR-8):

| # | 추가된 기능 | 해결된 시나리오 | 해결된 VP 수 |
|---|-----------|---------------|-------------|
| 1 | **Step 0: Requirements Interview** — 3가지 입력 모드별 요구사항 수집, PR description 자동 추출, deferral 경로, Context Brokering | CR-1, CR-2, CR-3 | 11 |
| 2 | **Early Exit** — 빈 diff/binary-only diff 감지, 메시지 출력, short-circuit 종료 | CR-8 | 4 |
| 3 | **Subagent Orchestration** — Step 5 Phase 1a conditional explore/oracle dispatch (chunk analysis 기반 trigger) | CR-14, CR-15 | 10 |
| 4 | **Dispatch Template** — chunk-reviewer-prompt.md 템플릿, 8개 플레이스홀더 인터폴레이션 | CR-5, CR-6 | 5 |
| 5 | **Severity Definitions** — agent에 Critical/Important/Minor 명시적 기준 + Example Output 추가 | CR-7 | 1 |

**GREEN 추가 검증** (CR-9 ~ CR-19, 테스트 일시: 2026-02-19):

| # | 검증 영역 | 시나리오 | VP 수 |
|---|----------|---------|-------|
| 6 | **Step 5 Walkthrough Synthesis** — Chunk Analysis 기반 Walkthrough 생성, 다이어그램, 출력 순서 | CR-9, CR-10 | 12 |
| 7 | **Step 0 Vague Answer + Question Discipline** — 2-strike rule, Question Method/Quality, One Question Per Message | CR-11, CR-12 | 10 |
| 8 | **Step 0 Exit Condition** — 3가지 종료 경로별 올바른 전환 | CR-13 | 5 |
| 9 | **Step 5 Phase 1a Conditional Dispatch** — explore chunk-analysis-aware prompt, oracle Cross-File Concerns 기반 trigger | CR-14, CR-15 | 10 |
| 10 | **Chunk Review Cross-File** — chunk-reviewer agent Cross-File Concerns subsection | CR-17 | 5 |
| 11 | **Step 1 PR Mode Ref Setup** — git fetch 기반 NO checkout, three-dot range | CR-18 | 6 |
| 12 | **Step 3 Per-Chunk Diff** — path filter 기반 chunk별 diff 획득 | CR-19 | 6 |

---

## REFACTOR Phase — Loophole fixes

**테스트 일시**: 2026-02-16
**발견 경로**: Argus MEDIUM 이슈 (Steps 3-7 통합 검증)

### 수정 사항

| # | 이슈 | 심각도 | 수정 내용 |
|---|------|--------|-----------|
| 1 | Early Exit가 Step 1의 diff 명령을 참조하나, Step 1 이전에 위치함 (논리적 순서 모순) | MEDIUM | Early Exit를 Step 1 이후로 이동. 문구 수정: "Before proceeding to Step 0:" → "After Input Parsing, before proceeding to Step 2:" |

### 수정 후 구조

```
Input Modes → Step 0 → Step 1 → Early Exit → Step 2 → Step 3 → Step 4 → Step 5
```

### 영향받는 시나리오 재검증

| Scenario | Verdict | Notes |
|----------|---------|-------|
| CR-8 | PASS | Early Exit가 Step 1 이후에 위치하여 diff 명령 참조가 논리적으로 올바름. V1-V4 모두 여전히 PASS |

**결론**: REFACTOR로 1건의 논리적 순서 이슈 해결. 기능적 변경 없음, 모든 VP 유지.

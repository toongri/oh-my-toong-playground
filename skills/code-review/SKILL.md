---
name: code-review
description: Use when reviewing code changes - supports PR numbers, branch comparison, and post-implementation review with automatic chunking for large diffs
---

# Code Review

Orchestrates code-reviewer agents against diffs. Handles input parsing, context gathering, chunking, and result synthesis.

## Input Modes

```bash
# PR (number or URL)
/code-review pr 123
/code-review pr https://github.com/org/repo/pull/123

# Branch comparison
/code-review main feature/auth

# Auto-detect (current branch vs origin/main or origin/master)
/code-review
```

## Step 0: Requirements Context

Three-question gate — adapt by input mode:

**PR mode:**
1. Auto-extract PR title + description via `gh pr view <number> --json title,body`
2. If description is substantial (>1 sentence): proceed with auto-extracted context, confirm with user: "PR 설명에서 요구사항을 추출했습니다: [요약]. 추가할 사항이 있나요?"
3. If description is thin: ask user "이 PR의 핵심 요구사항이나 spec이 있나요?"

**Branch comparison mode:**
Ask user: "이 브랜치에서 무엇을 구현했나요? 원래 요구사항/spec이 있다면 알려주세요."

**Auto-detect mode:**
1. Infer from commit messages (`git log --oneline`)
2. Ask user: "최근 작업의 요구사항/spec이 있나요? (없으면 코드 품질 중심으로 리뷰합니다)"

**User deferral** ("없어", "그냥 리뷰해줘", "skip"):
→ Set {REQUIREMENTS} = "N/A - code quality review only"
→ Proceed without blocking

**Context Brokering:**
- DO NOT ask user about codebase facts (file locations, patterns, architecture)
- USE explore/oracle in Step 2 for codebase context
- ONLY ask user about: requirements, intent, specific concerns

## Step 1: Input Parsing

Determine diff command and range for subsequent steps:

| Input | Diff Command | Range |
|-------|-------------|-------|
| `pr <number or URL>` | `gh pr diff <number>` | Extract via `gh pr view <number> --json baseRefName,headRefName` → `origin/<baseRefName>..<headRefName>` |
| `<base> <target>` | `git diff <base>...<target>` | `<base>...<target>` |
| (none) | Detect default branch (`origin/main` or `origin/master`), then `git diff <default>...HEAD` | `<default>...HEAD` |

All subsequent steps use `{range}` from this table.

## Early Exit

After Input Parsing, before proceeding to Step 2:

1. Run `git diff {range} --stat` (using the range determined in Step 1)
2. If empty diff: report "변경사항이 없습니다 (<base>와 <target> 사이)" and exit
3. If binary-only diff: report "바이너리 파일 변경만 감지되었습니다" and exit

## Step 2: Context Gathering

Collect in parallel (using `{range}` from Step 1):

1. `git diff {range} --stat` (change scale)
2. `git diff {range} --name-only` (file list)
3. `git log {range} --oneline` (commit history)
4. CLAUDE.md files: repo root + each changed directory's CLAUDE.md (if exists)

Subagent context (conditional):

5. Dispatch explore agent (4-Field):
   Task(subagent_type="explore", prompt="I'm reviewing a PR that changes [file list] and need to understand the existing conventions these files should follow. I'll use this to evaluate whether the PR matches codebase patterns. Find: related implementations, naming conventions, error handling patterns, and test structure for the changed modules. Skip unrelated directories. Return file paths with pattern descriptions.")
   → Always dispatch (lightweight, provides codebase context)
6. Dispatch oracle agent (only if trigger conditions met):
   Briefly announce "Consulting Oracle for [reason]" before invocation.
   → Only if trigger conditions met (see below)

**Oracle trigger conditions:**
- Changed files include `*migration*`, `*schema*`, `*.sql`
- Changed files span 3+ top-level directories
- Changed files include `*auth*`, `*security*`, `*crypto*`, `*permission*`

## Step 3: Chunking Decision

| Condition | Strategy |
|-----------|----------|
| Changed files <= 15 | Single review -- skip to Step 4 with full diff |
| Changed files > 15 | Group into chunks of ~10-15 files by directory/module affinity |

Chunking heuristic: group files sharing a directory prefix or import relationships.

## Step 4: Agent Dispatch

1. Read dispatch template from `code-reviewer-prompt.md`
2. Interpolate placeholders with context from Steps 0-2:
   - {WHAT_WAS_IMPLEMENTED} ← Step 0 description
   - {DESCRIPTION} ← Step 0 or commit messages
   - {REQUIREMENTS} ← Step 0 requirements (or "N/A - code quality review only")
   - {CODEBASE_CONTEXT} ← Step 2 explore/oracle output (or empty)
   - {FILE_LIST} ← Step 2 file list
   - {DIFF} ← Step 1 diff (full or chunk)
   - {CLAUDE_MD} ← Step 2 CLAUDE.md content (or empty)
   - {COMMIT_HISTORY} ← Step 2 commit history
3. Dispatch `code-reviewer` agent(s) via Task tool (`subagent_type: "code-reviewer"`) with interpolated prompt

**Dispatch rules:**

| Scale | Action |
|-------|--------|
| Single chunk | 1 agent call |
| Multiple chunks | Parallel dispatch -- all chunks in ONE response. Each chunk gets its own interpolated template with chunk-specific {DIFF} and {FILE_LIST} |

## Step 5: Walkthrough Synthesis + Result Synthesis

After all agents return, produce the final output in two phases.

### Phase 1: Walkthrough Synthesis (MANDATORY)

Orchestrator directly produces the Walkthrough from:
- All chunk Chunk Analysis sections (raw comprehension material from code-reviewer agents)
- Step 2 context (explore/oracle output, CLAUDE.md, commit history)

**Generate the following sections:**

#### 변경 요약
- 전체 변경의 목적과 맥락을 1-2 문단으로 작성
- 동기(motivation), 접근 방식(approach), 전체적 영향(impact) 포함
- 코드를 모르는 사람도 이해할 수 있는 수준

#### 핵심 로직 분석
- 각 chunk의 Chunk Analysis를 통합하여 모듈/기능 단위로 재구성
- 핵심 변경과 부수적 변경을 모두 포함
- 데이터 흐름, 설계 결정, 부수 효과를 모듈 간 관계 관점에서 설명
- 코드를 직접 읽지 않아도 전체 변경을 이해할 수 있는 수준의 상세도

#### 아키텍처 다이어그램
- Mermaid class diagram 또는 component diagram
- 변경된 클래스/모듈과 그 관계(상속, 합성, 의존) 표시
- 신규 vs 수정 요소 구분
- 구조적 변경이 없는 경우(기존 메서드 내 로직 변경만): "구조적 변경 없음 — 기존 아키텍처 유지"

#### 시퀀스 다이어그램
- Mermaid sequence diagram으로 주요 호출 흐름 시각화
- 액터, 메서드 호출, 반환값, 주요 분기 포함
- 호출 흐름 변경이 없는 경우(변수명 변경, 설정 변경 등): "호출 흐름 변경 없음"

### Phase 2: Critique Synthesis

For multi-chunk reviews:

1. **Merge** all Strengths, Issues, Recommendations sections
2. **Deduplicate** issues appearing in multiple chunks
3. **Identify cross-file concerns** -- issues spanning chunk boundaries (e.g., interface contract mismatches, inconsistent error handling patterns)
4. **Normalize severity labels** across chunks using Critical / Important / Minor scale -- reconcile inconsistent labels for same-type issues across chunks; escalate recurring cross-chunk issues
5. **Determine final verdict** -- "Ready to merge?" is the STRICTEST of all chunk verdicts (any "No" = overall "No")
6. **Produce unified critique** (Strengths / Issues / Recommendations / Assessment)

For single-chunk reviews, Phase 2 returns the agent's critique output directly (Strengths through Assessment).

### Final Output Format

```
## Walkthrough

### 변경 요약
[Phase 1에서 생성]

### 핵심 로직 분석
[Phase 1에서 생성]

### 아키텍처 다이어그램
[Phase 1에서 생성 — Mermaid or "구조적 변경 없음"]

### 시퀀스 다이어그램
[Phase 1에서 생성 — Mermaid or "호출 흐름 변경 없음"]

---

## Strengths
[Phase 2에서 생성]

## Issues
[Phase 2에서 생성]

## Recommendations
[Phase 2에서 생성]

## Assessment
[Phase 2에서 생성]
```

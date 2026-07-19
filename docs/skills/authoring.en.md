English | [한국어](authoring.md)

---

## TL;DR - Authoring & Communication Skills

| Skill | Purpose | When to Use |
|-------|---------|-------------|
| **create-slides** | HTML scrollytelling presentation generator | Tech talks, proposals, pitch decks |
| **technical-writing** | Korean technical document review/writing | API docs, guides, technical posts |
| **technical-copywriting** | Technical blog promotion text review | SNS teasers, LinkedIn posts |
| **humanizer** | Remove AI writing traces | Naturalizing KO/EN content |
| **make-pr** | PR description authoring | Before submitting code change PRs |
| **scan-pdf-to-notes** | Scanned PDF → markdown/study notes | OCR book chapter extraction |
| **git-master** | Commit messages + branch naming | git commits, branch creation |

---

## 1. Overview

These skills form a **document and communication production pipeline** covering creation, refinement, and publication.

Each skill targets a different output type but operates on shared principles:
- Accuracy: no fabrication or inflation of content
- Context-first: no production without sufficient information
- Reader-centered: validate output from the reader's perspective, not the author's

---

## 2. Skill Details

### create-slides

**Role**: Generates presentation slides as a single HTML file using pure HTML+CSS — no slide library required. Uses a vertical scroll + scroll-snap scrollytelling approach.

**Features**:
- Dark/light theme, highlight.js code blocks, NanumSquareNeo font
- 13 slide types: title, content, card-grid, code, timeline, flow, comparison, diagram, and more
- Cannot proceed without user confirmation (theme, slide structure, and accent colors must be agreed first)
- Prohibits: reveal.js, Bootstrap, base64 images, fabricated numbers

**Triggers**: "presentation", "slides", "ppt", "pitch deck", "tech talk", "발표자료", "슬라이드"

**Output**: A single `.html` file in the current directory

---

### technical-writing

**Role**: Reviews and improves Korean technical documents through three sequential phases.

- **Area 1 (Type Classification)**: Identifies document type and verifies type-specific required elements
- **Area 2 (Architecture Review)**: Checks heading structure, overview presence, readability, and information predictability
- **Area 3 (Sentence Review)**: Reviews subject clarity, conciseness, and Korean naturalness

After each Area, results are presented to the user and approval is required before proceeding. Every suggestion is formatted as Before/After with the relevant principle ID cited (T1–T16, P1–PA17).

**Triggers**: "문서 리뷰", "테크니컬 라이팅", "기술 문서", "doc review", "writing review"

---

### technical-copywriting

**Role**: Reviews teaser and promotion text that accompanies technical blog post shares. Uses the same three-phase sequential framework as technical-writing, but targets a different output type.

- **Area 1 (Type Classification)**: Identifies teaser type (announcement, learning journey, opinion, etc.) and checks platform constraints
- **Area 2 (Structure Review)**: Reviews opening, value delivery mode, closing pattern, and proportion balance
- **Area 3 (Voice & Authenticity)**: Checks developer authenticity, anti-marketing-speak, platform tone, and Korean naturalness

Unlike technical-writing, this skill handles SNS teasers, LinkedIn posts, and blog share copy — not technical documentation.

**Triggers**: "티저 리뷰", "포스트 공유", "copywriting review", "LinkedIn post review", "promotion text"

---

### humanizer

**Role**: Detects and removes AI writing traces from Korean (primary) and English text. Covers 35+ patterns (K1–K21, E1–E18, C1–C9).

Two modes:
- **audit**: Detects patterns and outputs a report only. Does not modify the text.
- **rewrite**: Detects patterns and applies corrections directly. Default mode.

Rules vary by content type (blog/essay, technical docs, marketing, academic, SNS). Technical docs prohibit adding facts or injecting personality; blog/essay content actively encourages first-person perspective and genuine opinions.

**Key detection targets**:
- Korean: "오늘날", "혁신적인", "이를 통해", em-dash (—), middle-dot (·), "결론적으로", and more
- English: "pivotal", "seamless", "leverage", "Let's dive in", curly quotes, and more

**Triggers**: "humanize", "AI 흔적 제거", "사람답게", "자연스럽게 고쳐", "de-AI", "remove AI patterns"

---

### make-pr

**Role**: Writes Korean PR descriptions from a senior backend engineer's perspective. Separates what changed (Changes) from what needs discussion (Review Points) so reviewers can understand core decisions without reading the diff.

Key constraints:
- Cannot proceed until all 4 Clearance Checklist items are YES
- `gh pr create` requires explicit user confirmation before running
- Reading git diff file contents is prohibited (metadata + explore only)
- Entire PR written in Korean

Workflow:
1. Base branch detection + user confirmation
2. Branch synchronization (merge/rebase; per-file interview on conflict)
3. Git metadata collection → codebase exploration
4. One-question-at-a-time interview → Clearance Checklist passes
5. Scope assessment (single thesis vs. split required)
6. PR title + body draft → user review → PR creation

**Output format**: Emoji-headed sections — `📌 Summary`, `🔧 Changes`, `💬 Review Points`, `✅ Checklist`, `📎 References`

**Triggers**: "PR 작성", "PR description", "make PR", "풀리퀘", "pull request 작성"

---

### scan-pdf-to-notes

**Role**: Extracts a specific chapter or page range from a scanned book PDF (ABBYY FineReader or similar OCR engine) and produces two artifacts.

- **Raw extraction**: 1:1 with the book, OCR noise included. The verifiable source. Never deleted.
- **Study notes**: A re-narrated, condensed rewrite of the raw extraction.

Extraction tiers:
- **Tier 1 (always)**: `pymupdf4llm` (markdown structure) + `pdftotext -layout` (spatial alignment)
- **Tier 2 (when real grid tables or code blocks exist)**: `marker-chunked.sh` (re-OCR, table restoration)

Precise values (hashes, ports, versions, etc.) must never be guessed from context — they are verified by rendering the page to an image via `get_pixmap()` and checking by eye. When a notes series already exists, tone, density, and file naming must match.

**Triggers**: "PDF 텍스트 발췌", "스캔본 PDF 추출", "책 챕터 정리", "OCR 깨짐", "pdftotext", "scanned book extraction", "extract chapter from PDF"

---

### git-master

**Role**: Analyzes code changes and generates Korean commit messages following project conventions. Also applies branch naming conventions.

**Three non-negotiable rules**:
1. Single logical change only (split if needed)
2. Subject line 50 characters or fewer
3. Subject must be self-explanatory to a git log reader without external context

Commit message format:
- Type prefix: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`
- Language: Korean noun-form endings (e.g., 추가, 수정, 구현)
- Forbidden in subject: plan step numbers (`Step N`), AC IDs (`AC M1`), priority labels (`P1`)

Branch naming: `<type>/<description>` format, kebab-case, English (e.g., `feature/user-auth`, `fix/login-redirect`)

When 3 or more files are changed, a commit plan is output before any commit runs. Test files must always be included in the same commit as their corresponding implementation.

**Triggers**: "commit", "커밋", "git commit", "branch name", "브랜치 이름", "what should I name this branch"

---

## 3. Skill Selection Guide

```
What do you need to produce?
  |-- Presentation / slides      → create-slides
  |-- Technical document review  → technical-writing
  |-- Blog share teaser review   → technical-copywriting
  |-- Remove AI writing traces   → humanizer
  |-- PR description             → make-pr
  |-- Scanned PDF extraction     → scan-pdf-to-notes
  |-- Commit / branch naming     → git-master
```

---

## References

- [README](../../README.en.md) - Project overview
- [Orchestration Guide](../ORCHESTRATION.en.md) - Planning + execution pipeline
- Related skill pages:
  - [Core Pipeline](./core-pipeline.en.md)
  - [Review & Quality](./review-quality.en.md)
  - [Research](./research.en.md)
  - [Knowledge Graph Pins](./knowledge-graph-pins.en.md)
  - [Utilities & Personal Tools](./utilities-personal.en.md)

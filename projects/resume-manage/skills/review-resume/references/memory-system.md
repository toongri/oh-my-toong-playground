# Memory System Reference

Persistent memory for resume review. Accumulates candidate pool, user preferences, and research cache across sessions so that JD-based candidate selection improves over time without re-parsing from scratch.

---

## Table of Contents

1. [Memory Directory Structure](#1-memory-directory-structure)
2. [problem-solving/ Unification Principle](#2-problem-solving-unification-principle)
3. [Candidate File Format](#3-candidate-file-format)
4. [preferences.md Structure](#4-preferencesmd-structure)
5. [Career-Level Depth Distribution Guide](#5-career-level-depth-distribution-guide)
6. [Memory Load (Phase 0)](#6-memory-load-phase-0)
7. [Auto-Seeding (First Run)](#7-auto-seeding-first-run)
8. [Memory Accumulate (Phase 10)](#8-memory-accumulate-phase-10)

---

## 1. Memory Directory Structure

```
~/.omt/resume-manage/review-resume/
├── self-introduction/        # Type A, B, C, D candidate paragraphs
│   ├── identity-impact-driven.md
│   ├── stance-team-problem-solver.md
│   └── ...
├── career/                   # Career bullet candidates
│   ├── payment-sync-scheduler.md
│   ├── product-cache-optimization.md
│   └── ...
├── problem-solving/          # Problem-solving narrative candidates (unified pool)
│   ├── payment-order-sync.md
│   ├── coupon-race-condition.md
│   ├── llm-inspection-automation.md
│   └── ...
├── preferences.md            # User preferences, expression style, judgment criteria
└── sources/                  # Company research and JD analysis cache
    ├── toss-backend-2025-03.md
    └── ...
```

---

## 2. problem-solving/ Unification Principle

"Signature project", "problem-solving", and "other projects" are not separate categories. All of them are detailed narratives that show **how this person solves problems** — they differ only in **depth**.

| Depth | Purpose | Length | Included Elements |
|-------|---------|--------|-------------------|
| `signature` | Deepest problem-solving narrative | No limit | Full P.A.R.R. (attempts → failures → validation → retrospective) |
| `detailed` | Major problem-solving within career | 5–10 lines | Problem → approach → result, 1–2 failed attempts |
| `compressed` | Supporting projects, concise evidence | 3–5 bullet lines | 1-line problem + 1–2 line solution + 1-line outcome |

Maintain **2–3× more candidates** in the pool than the number actually used in the resume. This allows swapping combinations depending on the JD.

---

## 3. Candidate File Format

All candidate files use Markdown with YAML frontmatter:

```markdown
---
tags: [결제, 동시성, MVCC]
depth: signature              # signature | detailed | compressed
used_in:                      # JD usage history for this candidate
  - {jd: "토스 백엔드", date: "2025-03"}
  - {jd: "당근 결제팀", date: "2025-02"}
rating: preferred             # preferred | neutral | archived
source: "실제 경험 + 2025-03 리뷰 세션"
created: "2025-03-01"
updated: "2025-03-25"
---

## 결제-주문 상태 동기화

### 핵심 내용
결제 완료 후 주문 상태 불일치가 주 15건 발생...

### 변형 A (비즈니스 임팩트 강조)
보상 트랜잭션 스케줄러 설계로 불일치 0건 달성...

### 변형 B (기술 깊이 강조)
MVCC 특성상 발생하는 동시성 문제를 분석하여...
```

**Frontmatter fields:**

| Field | Purpose |
|-------|---------|
| `tags` | Keywords for JD matching and search |
| `depth` | Current narrative depth of this candidate |
| `used_in` | Usage history (JD name + date) — tracks which companies received which combinations |
| `rating` | User preference: `preferred` = frequently selected, `neutral` = situational, `archived` = no longer in use |
| `source` | Origin of this candidate (real experience, review session discussion, user-added directly, etc.) |
| `created` / `updated` | Timestamps |

---

## 4. preferences.md Structure

```markdown
# 유저 선호

## 표현 스타일
- "~했습니다" 종결 선호 (vs "~함" 명사형)
- 기술 용어는 영문 유지 (Redis, Kafka — 한글화 하지 않음)

## 판단 기준
- 비즈니스 임팩트 > 기술 깊이 (본인 정체성)
- 숫자가 없으면 차라리 빼는 쪽 선호

## 피드백 히스토리
- 2025-03-15: "이 문장은 너무 AI스럽다" → payment-sync 변형 A 수정
- 2025-03-20: "문제해결 순서를 시간순이 아니라 임팩트순으로"
```

Three sections are required: **표현 스타일** (expression style), **판단 기준** (judgment criteria), **피드백 히스토리** (feedback history). Add entries to each section as they emerge from review sessions. Never overwrite history — append only.

---

## 5. Career-Level Depth Distribution Guide

| Career Level | Recommended Composition | Rationale |
|---|---|---|
| Junior (0–3 years) | 1 signature + 2 detailed per career entry | Must prove CS depth and learning velocity in detail |
| Mid-level (3–7 years) | 1 signature + 1–2 detailed + 3–5 compressed | Use signature for trade-off judgment, compressed for breadth |
| Senior (7+ years) | 1 signature + 3–5 compressed | One signature is enough for business impact. Keep the rest concise |

---

## 6. Memory Load (Phase 0)

Load persistent memory before starting the review. The candidate pool, user preferences, and research cache accumulated from previous reviews are the starting point for the current session.

### Step 0-1. Memory Directory Check

1. Check if `~/.omt/resume-manage/review-resume/` exists
2. If the directory is absent or empty → run **Auto-Seeding** (see Section 7)
3. If the directory exists → proceed to Step 0-2

### Step 0-2. Load Existing Memory

1. **Scan candidate pool**: Read file lists and frontmatter from `self-introduction/`, `career/`, and `problem-solving/`. Read file bodies only when needed.
2. **Load preferences.md**: Bring the user's expression preferences, judgment criteria, and feedback history into context.
3. **Check sources/**: If a target company is specified, check whether an existing research cache is present. If found, reuse it in Phase 1 Step 3 (Company Research).

Report the load result to the user:

```
[Memory Loaded]
- 자기소개 후보: N개 (preferred: X)
- 경력 후보: N개
- 문제해결 후보: N개 (signature: X, detailed: Y, compressed: Z)
- 유저 선호: loaded / not found
- 리서치 캐시: {회사명} found / none
```

`[Phase 0/11: Memory Load ✓]`

---

## 7. Auto-Seeding (First Run)

Run only when memory is empty. Parse the current resume to auto-generate the initial candidate pool.

1. Read `_config.yml` (or the resume file on the current branch)
2. **Self-introduction**: Classify each paragraph as Type A/B/C/D and create files in `self-introduction/`
3. **Career**: Create one file per bullet in `career/` (filename: company-item in kebab-case)
4. **Problem-solving / projects**: Create one file per project entry in `problem-solving/`
   - Items marked as "signature" in the resume → `depth: signature`
   - Items with detailed narrative → `depth: detailed`
   - Items in 3–5 bullet form → `depth: compressed`
5. Create `preferences.md` as a blank template
6. Report seeding results to the user: "메모리를 초기화했습니다. 현재 이력서 기준 N개의 후보가 등록되었습니다."

---

## 8. Memory Accumulate (Phase 10)

After the review is complete, accumulate information discovered in this session into persistent memory. Save only after user confirmation.

### Accumulation Rules

1. **Create new candidates**: If a new experience or expression discussed during the review is not in the existing candidate pool → propose creating a new file
   - Filename: kebab-case reflecting the core topic (e.g., `search-latency-optimization.md`)
   - `depth`: auto-determined from the narrative level in the current resume
   - `tags`: keywords surfaced during the discussion
   - `rating`: `neutral` (use `preferred` if the user explicitly expressed a preference)

2. **Update existing candidates**: If an expression revised during the review is an improvement over an existing candidate → add a variant or update the body
   - Add new variants as `### 변형 X (맥락 설명)`
   - Never replace existing variants — keep them in parallel. The original variant may be the better choice for a different JD.

3. **Usage history**: Add the JD name + date to the `used_in` field for every candidate actually used in this review

4. **Rating update**: Update the `rating` field for any candidate where the user explicitly stated "this is better" or "this doesn't work"

5. **preferences.md update**: Append any new preferences or judgment criteria revealed during the review
   - e.g., "비즈니스 임팩트 숫자를 앞에 배치하는 스타일 선호"
   - e.g., "~했습니다 종결 대신 명사형 종결 선호"

6. **sources/ cache**: Save information gathered during Company Research (Phase 1 Step 3) as `sources/{company}-{date}.md`

### Accumulation Output

Show a summary of changes to the user and wait for confirmation before saving:

```
[Memory Accumulate — Phase 10]

새 후보:
  + problem-solving/search-latency-optimization.md (compressed, tags: [검색, p99, 인덱스])

업데이트:
  ~ problem-solving/payment-order-sync.md → 변형 C (비즈니스 임팩트 강조) 추가
  ~ career/product-cache.md → rating: neutral → preferred

선호도:
  ~ preferences.md → "임팩트순 정렬 선호" 추가

리서치 캐시:
  + sources/toss-backend-2025-03.md

저장할까요? (y/n)
```

If the user confirms, create or modify the files. If declined, do not accumulate.

`[Phase 10/11: Memory Accumulate ✓]`

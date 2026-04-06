# Note System Reference

Persistent note for resume review. Accumulates candidate pool, user preferences, and research cache across sessions so that JD-based candidate selection improves over time without re-parsing from scratch.

---

## Table of Contents

1. [Note Directory Structure](#1-note-directory-structure)
2. [problem-solving/ Unification Principle](#2-problem-solving-unification-principle)
3. [Candidate File Format](#3-candidate-file-format)
4. [preferences.md Structure](#4-preferencesmd-structure)
5. [Career-Level Depth Distribution Guide](#5-career-level-depth-distribution-guide)
6. [Note Load](#6-note-load)
7. [Auto-Seeding (First Run)](#7-auto-seeding-first-run)
8. [Note Accumulate](#8-note-accumulate)

---

## 1. Note Directory Structure

```
$OMT_DIR/review-resume/
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
│   └── ...
├── study/                    # Study/activity section candidates
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

All candidate entries are evaluated uniformly — depth is not pre-assigned. Evaluation rules:

- **5+ line entries**: Included in candidate evaluation. Each entry is assessed on P.A.R. structure (attempts → failures → validation).
- **1 kick entry per resume**: The single strongest entry gets deeper treatment — expanded narrative, full failure chain, concrete validation evidence.
- **Under 5 lines**: Too thin to evaluate independently; merge with a related entry or expand before adding to the pool.

Maintain **2–3× more candidates** in the pool than the number actually used in the resume. This allows swapping combinations depending on the JD.

---

## 3. Candidate File Format

All candidate files use Markdown with YAML frontmatter:

```markdown
---
tags: [payment, concurrency, MVCC]
---

## Payment-Order Status Synchronization

15 weekly payment-order status inconsistencies occurring after payment completion...
```

**Frontmatter fields:**

| Field | Purpose |
|-------|---------|
| `tags` | Keywords for JD matching and search |

The candidate body contains the narrative content directly. Depth (signature/detailed/compressed) is determined at evaluation time from the content structure, not stored as metadata.

---

## 4. preferences.md Structure

```markdown
# User Preferences

## Expression Style
- Prefer formal polite sentence endings (~했습니다) over noun-form endings (~함)
- Keep technical terms in English (Redis, Kafka — do not Koreanize)

## Judgment Criteria
- Business impact > technical depth (personal identity)
- Prefer omitting lines that have no numbers

## Feedback History
- 2025-03-15: "This sentence sounds too AI-generated" → revised payment-sync body
- 2025-03-20: "Order problem-solving by impact, not chronologically"
```

Three sections are required: **Expression Style**, **Judgment Criteria**, **Feedback History**. Add entries to each section as they emerge from review sessions. Never overwrite history — append only.

---

## 5. Career-Level Entry Recommendations

| Career Level | Recommended Entries | Rationale |
|---|---|---|
| Junior (<7 years) | 5–8 entries total, 1 kick entry for deeper treatment | Establish breadth of experience; one entry receives full P3 elaboration |
| Senior (7+ years) | 5–8 entries total, 1 kick entry for deeper treatment | Business impact focus; one entry receives full P3 elaboration |

---

## 6. Note Load

Load persistent note before starting the review. The candidate pool, user preferences, and research cache accumulated from previous reviews are the starting point for the current session.

### Step 0-1. Note Directory Check

1. Check if `$OMT_DIR/review-resume/` exists
2. If the directory is absent or empty → run **Auto-Seeding** (see Section 7)
3. If the directory exists → proceed to Step 0-2

### Step 0-2. Load Existing Note

1. **Scan candidate pool**: Read file lists (names only) from `self-introduction/`, `career/`, and `problem-solving/`. Do not read frontmatter or file bodies at this stage — load them lazily when first needed (e.g., frontmatter tags when performing JD keyword matching in Phase 7, file bodies when drafting or comparing candidates).
2. **Load preferences.md**: Bring the user's expression preferences, judgment criteria, and feedback history into context.
3. **Check sources/**: If a target company is specified, check whether an existing research cache is present. If found, reuse it in Pre-Evaluation Research phase Step 3 (Company Research).

Report the load result to the user:

```
[Note Loaded]
- Self-Introduction Candidates: N entries
- Career Candidates: N entries
- Problem-Solving Candidates: N entries
- User Preferences: loaded / not found
- Research Cache: {company name} found / none
```

---

## 7. Auto-Seeding (First Run)

Run only when note is empty. Parse the current resume to auto-generate the initial candidate pool.

1. Read `_config.yml` (or the resume file on the current branch)
2. **Self-introduction**: Classify each paragraph as Type A/B/C/D and create files in `self-introduction/`
3. **Career**: Create one file per bullet in `career/` (filename: company-item in kebab-case)
4. **Problem-solving / projects**: Create one file per problem-solving/project entry
5. Create `preferences.md` as a blank template
6. Report seeding results to the user: "Note initialized. N candidates registered based on the current resume."

---

## 8. Note Accumulate

After the review is complete, accumulate information discovered in this session into persistent note. Save only after user confirmation.

### Accumulation Rules

1. **Create new candidates**: If a new experience or expression discussed during the review is not in the existing candidate pool → propose creating a new file
   - Filename: kebab-case reflecting the core topic (e.g., `search-latency-optimization.md`)
   - `tags`: keywords surfaced during the discussion

2. **Update existing candidates**: If an expression revised during the review is an improvement over an existing candidate → update the body directly

3. **preferences.md update**: Append any new preferences or judgment criteria revealed during the review
   - e.g., "Prefer placing business impact numbers at the front"
   - e.g., "Prefer noun-form endings instead of formal polite endings"

4. **sources/ cache**: Save information gathered during Company Research (Pre-Evaluation Research phase Step 3) as `sources/{company}-{date}.md`

### Accumulation Output

Show a summary of changes to the user and wait for confirmation before saving:

```
[Note Accumulate]

New Candidates:
  + problem-solving/search-latency-optimization.md (tags: [search, p99, index])

Updates:
  ~ problem-solving/payment-order-sync.md → body updated

Preferences:
  ~ preferences.md → "Prefer impact-first ordering" added

Research Cache:
  + sources/toss-backend-2025-03.md

Save? (y/n)
```

If the user confirms, create or modify the files. If declined, do not accumulate.

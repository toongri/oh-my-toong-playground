---
name: explain-diff
description: Use when someone must actually understand a code change before acting on it — reviewing an unfamiliar PR, onboarding onto a subsystem through its history, or handing a large agent-authored diff to a human. Triggers include "diff 설명", "PR 설명해줘", "이 변경 이해하고 싶어", "explain this change", "코드 변경 설명 문서", "변경 퀴즈".
disable-model-invocation: true
---

<Role>

# explain-diff

**Core Principle**: The completion condition is a person, not a document. This skill turns a diff into teaching material and, at the end, measures whether the reader actually understood it with an open-ended quiz. It is not done until the reader passes.

## Overview

Nine steps, passed in order. Steps 1–8 you do alone; the user does only two things — read the document and answer the quiz.

```
evidence → background → goal → architecture → intuition → commits → code → render → quiz
```

The document skeleton and the usable visual components are owned by `references/markdown-template.md`.
**A `<style>` block, an inline `style=` attribute, or a class outside the sanctioned list anywhere in the document makes the structure check reject that step** — style is owned by render.ts, and the author writes only content and components.

Each step must pass two gates — **structure check (script) → judgment (subagent, quote required)** — before it advances. The state CLI renders the pass verdict, and writes to the artifact path are permitted or rejected by a hook that reads that verdict. Steps cannot be skipped.

</Role>

## State CLI

Every state transition in this skill goes through the CLI. Editing the state file directly is rejected by a hook.

```bash
CLI="bun ${CLAUDE_SKILL_DIR}/scripts/explain-diff-state.ts"
```

## Step 1 — evidence

**Open the state first.** With no state, every write to the artifact path is rejected, so nothing proceeds without this call.

```bash
$CLI start --range "<git range>" --slug "<slug>"
```

With no arguments, use `HEAD~1..HEAD`; if even that is ambiguous, use the current branch against the default branch.

Then read the changed files together with the state. An added file has no prior location to point at, so the structure check asks only for a `head:` anchor on it — which files are new is fixed here.

```bash
git diff --name-status <git range>
```

A path marked `A` is a new file. Pass this list to `submit-step`'s `--added-files`.

Then split the changed files into **signal** and **noise**.

- Default noise ruleset: `*.lock`, `dist/`, `__snapshots__/`, `*.generated.*`, binary assets
  (images, fonts, media), formatting-only hunks
- To classify a file **outside** the ruleset as noise, write one line of rationale per such file
- **A large set of same-nature files** (asset swaps, bulk renames) is not listed individually —
  fold it into noise as one glob line + count + rationale, and explain the meaning of that change
  once, in the Change Group of the code file that references it. Signal is a file that has
  something to explain per file — a set whose count is its whole meaning is not signal
- Record the classification result as a table in the `## Evidence` block at the top of the document

From here on, every step's document accumulates into a single markdown file:
`$OMT_DIR/explain-diff/YYYY-MM-DD-<slug>.md`

## Step 2 — background

Write **both** tiers.

```markdown
## Background

### 깊은 배경
이미 익숙하면 건너뛰세요.
<what a newcomer to this system needs>

### 좁은 배경
<what touches this change directly>
```

The skip line is verified by the structure check as a string.

## Step 3 — goal

State the **goal and the one-line core before any structure or code** — the way a good teacher gives the point of a lesson before the exercises. Background taught the system; this step says what this change is *for*. Do not describe mechanism here (that is architecture/code's job) — say what it achieves, why it was needed, and the single thing the reader should carry into the rest of the document.

```markdown
## 목표

### 무엇을·왜
<이 변경이 이루려는 것 + 왜 필요했는가(해결하는 문제)>

### 핵심
<코드를 보기 전에 독자가 먼저 쥐어야 할 핵심 한 줄>
```

Both sub-headings are verified by the structure check (R16). What each says is yours to fill.

## Step 4 — architecture

Draw the structure needed to **understand this diff** at **three levels**. Each level is a mermaid diagram plus reading prose under the `### 시스템 레벨`, `### 컴포넌트 레벨`, `### 도메인 레벨` headings.

**These diagrams are not a diff-only world.** Draw whatever scope a reader needs to understand the change — including surrounding systems, services, and components the diff does *not* touch, as context. The one requirement: **mark which elements this diff actually changed** (`:::changed` / Before-After), so context and change are never confused. Every node must be a real element of the actual system — never an invented placeholder.

| Level | Question it answers | Belongs here |
|---|---|---|
| 시스템 (system) | Which **distinct processes, services, deployables, and stores** are involved, and which boundary does the diff touch | Only cross-process/service/store boundaries. An in-process call chain (functions/modules inside one runtime) is **NOT** the system level — that belongs to 컴포넌트/도메인. If the diff crosses no process boundary, the system level is a `구조 변화 없음: <사유>` waiver, not an in-process chain dressed up as a system picture. |
| 컴포넌트 (component) | How dependencies between modules and domains differ before vs after the change | Module/domain structure within a process |
| 도메인 (domain) | What the entities, concepts, and invariants are, and what changes | Entities, concepts, invariants |

**The system level does not end with a diagram alone.** Keep diagram edges to a **short protocol** (HTTP·SQL·REST) — long endpoints/queries on an edge break layout. Under the diagram (or waiver), place **two** tables. First, a **standing-interface table** (R17) naming which boundary talks over which endpoint, query, or screen URL, and what flows. It must be a real rendered Markdown table with exactly these three columns — prose-only labels or a fenced example do not count:

| 경계 | 인터페이스 | 오가는 것 |
|---|---|---|
| <프로세스·서비스 경계> | <엔드포인트·쿼리·화면 URL> | <오가는 데이터> |

Then, a **change-contract table** (R14) across three axes — `서버 API` (endpoints, tRPC procedures, request/response schemas), `DB 스키마` (tables, columns, constraints), `클라이언트 의존` (contracts the client must change to match); each axis states the changing contract or `변경 없음: <사유>`. Order: diagram → standing-interface (context) → change-contract (delta). The three axis labels pass R14; the three rendered column labels (`경계`·`인터페이스`·`오가는 것`) pass R17. Format follows `markdown-template.md`.

**The component level decodes each changed node (R18).** The mermaid graph shows how modules connect; bare class names do not say what a node *is*. A reasoned component-level `구조 변화 없음: <사유>` waiver is accepted. Otherwise, changed behaviour nodes need renderer-recognized `arch-entity` cards carrying `레이어` / `책임` / `인터페이스` (functions) and `data-change="new|mod|del"`. Prose-only card descriptions and unsupported `data-change` values do not count; a pure data/contract-only level must use the reasoned waiver instead of simply omitting cards. The labels and valid cards are what R18 checks.

**The Architecture section closes with a boundary/dependency/use-case change map (R15).** After the three levels, add a `### 경계·의존·유스케이스` block that is **not** a static layer-classification table but a map of what this diff did to the boundary. The rendered block must contain a real renderer-recognized `arch-entity` with an allowed `data-change="new|mod|del"`, plus the `영향 인터페이스` and `의존 방향` slots; prose-only mentions or unsupported change values do not count. Describe each behaviour unit's affected interface, the touched layers/domains as a one-line backdrop, and close with a dependency-direction verdict (keeps/violates/restores unidirectional dependency; flag any reach-in, back-reference, or cycle). **Do not write methodology names (FSD·Feature-Sliced·Clean Architecture·DDD·bounded context) OR bare axis labels (`수평`/`수직`) in the Architecture prose (R19)** — name the touched areas in the codebase's own domain terms, not by sorting parts into a horizontal/vertical grid. The vocabulary follows the `architecture-boundaries` rule but the output speaks the codebase's own domain terms. Format follows `markdown-template.md`.

R19 scans the rendered `## Architecture` prose after ignoring fenced blocks and inline-code examples, and rejects only standalone methodology or axis tokens (methodology matching is case-insensitive). A token embedded in a code identifier or example is not prose.

Write diagrams in a ` ```mermaid ` fence — they are baked to inline SVG at the render step, so the final HTML stays self-contained. If any diagram is present, its node/edge labels must be **real identifiers of the actual system** — service, module path, command, entity names — not invented generic nouns (a "service → DB" picture fits any diff and fails R12). Context nodes the diff does not change are welcome, but at least one level must carry a change marker (`:::changed` or Before/After contrast) pointing at what this diff changed, and for the 시스템 레벨 the marked-and-drawn boundary must be an actual cross-process/service boundary, not an in-process call. The identifier grounds and the change marker must appear together in the judge's required quote (R12). Type selection and syntax rules follow `markdown-template.md`.

A level with genuinely nothing to draw is replaced by `구조 변화 없음: <사유 한 문장>` — a marker with no rationale is rejected by the structure check. If there is no diagram at all and every one of the three levels carries this reasoned waiver, R12 can still be satisfied. In that case the judge's quote must include all three waiver sentences — system, component, domain — as strings copied verbatim from the document; if any is missing or lacks a rationale, it does not pass. This waiver exception does not apply once any diagram is present.

## Step 5 — intuition

Write only the **essence** of the change. Detail is the next step's job. Make a concrete toy value actually appear, and reuse that value in the explaining sentence.

Draw with sanctioned components. Do not use ASCII diagrams, and do not invent style.

- Something that flows in one line (call order, data flow + example values) → `flow` component
- Before/after contrast → `compare` component
- A two-dimensional structure needing boundaries or branches → ` ```mermaid ` (same syntax as the architecture step)

## Step 6 — commits

First pull the commit list for the range — this list is this step's subject:

```bash
git rev-list --reverse --no-merges <base>..<head>
```

Merge commits are not counted — a merge's diff against its first parent equals the whole range, so it has no unique narrative. A merge range (`<merge>^1..<merge>`) yields all the real commits of the merged branch — even for "one PR", if this output is more than one line it is not a single commit. Single-commit status is decided by the output line count alone.

What this step writes is a **one-line overview**. The deep narrative is the next step's job (per-commit code is written inside Change Groups). Under `## Commit Journey`, write one line per commit and tag which Change Group it goes to — the format is `N. \`<short-hash>\` <type> — <one-line intent> → 그룹 N`. Tag docs/noise commits into the group that explains the contract, as `→ 그룹 N (흡수)`.

```markdown
## Commit Journey
1. `a3078cd8` feat! — 비용 계약을 category로 고정 → 그룹 1
2. `bc62e399` docs — 위키 반영 → 그룹 1 (흡수)
```

Commit hashes are compared against the list that `start` pinned into the state — if any is missing from the overview, the structure check fails. Only when the command above is exactly one line, write the single line `단일 커밋 범위 — Commit Journey 생략.` instead of the section.

## Step 7 — code

The first-class unit is the **Change Group** (a concern), but **the spine is the commit.** Inside a group you descend commit by commit, and under a commit come the file blocks that commit touched. A signal file enters exactly once, as exactly one file block.

```markdown
## Change Group 1: <제목>
> 예고: <what this group will do — 그룹 N presupposes 그룹 N-1>
> 순서: <one line on why this order>

### `<short-hash>` — <커밋 제목>
<one or two sentences on what this commit did in this group. If it spans multiple groups, one spillover line.>

#### `path/to/file.ts`
<div class="cf">
<p><strong>역할/변경 전</strong> — <설명></p>
<p><strong>바뀐 것</strong> — <설명></p>
<p><strong>왜</strong> — <설명> <span class="cf-src">근거</span> "<원문 인용>"</p>
<p><strong>효과</strong> — <설명></p>
<p class="cf-loc"><code>base:path/to/file.ts:12</code> → <code>head:path/to/file.ts:15</code></p>
</div>

​```ts
// 핵심 로직 — real code or pseudocode (one required per file)
​```
```

The three slots fill R13, R3, and R5. The component, field labels, and code-fence rules follow `markdown-template.md`.

- **Commit subsection** (`### \`hash\``): at least one per group. The hash must be a range commit that `start` pinned (R13).
- **Core-logic code**: one code fence per file block. Location anchors alone do not read as "what was done" (R13).
- **`cf-loc` location anchors**: put `base:` (before) and `head:` (after) in a slot outside the prose (R5).
  `start` captures unified-diff hunk metadata; at the `code` submission, numeric anchors are validated
  against the captured base/head hunk ranges. A legitimate first-line hunk may therefore use
  `base:…:1 → head:…:1`. If hunk metadata is unavailable, the legacy fallback still rejects a modified
  file whose numeric anchors are the `:1 → :1` placeholder. With metadata, added files need only a
  `head:` anchor, deleted files need only a `base:` anchor, and a zero-count side has no file lines and
  needs no anchor. Read the real ranges from the captured hunk headers rather than inventing positions.
- **`cf-src` provenance tag**: one of three on every 왜 field (R3).

| Situation | Tag |
|---|---|
| The ground is in the diff, commit message, or a comment | `<span class="cf-src">근거</span> "<원문 인용>"` |
| No ground, but it is inferred from the code | `<span class="cf-src">추론</span> <추론의 근거>` |
| No reachable ground | `<span class="cf-src">Unknown / not supplied</span>` |

Leave the third case **as an open question inside the document.** Do not ask the user in conversation — steps 1–8 run without a person.

## Passing a step

After finishing each step, pass the two gates in order.

```bash
# Gate 1 — structure check
$CLI submit-step --step <step> --doc "<문서 경로>" \
  --signal-files "a.ts,b.ts" --added-files "b.ts"
```

What this gate actually looks at differs per step — it inspects only the slots that step must fill.

| Step | Check |
|---|---|
| evidence | Does every signal file appear somewhere in the document |
| background | Deep/narrow two-tier background + skip marker |
| goal | Does the `## 목표` section carry both sub-slots — `### 무엇을·왜` and `### 핵심` (R16) |
| architecture | Three level headings, each with a mermaid diagram or a reasoned waiver (R9); system level has the three change-contract axes (R14) and a real rendered three-column standing-interface table `경계`/`인터페이스`/`오가는 것` (R17); component level accepts a reasoned structure-no-change waiver or requires renderer-recognized `arch-entity` cards with `레이어`/`책임`/`인터페이스` and `data-change="new|mod|del"` (R18); boundary block requires a real `arch-entity` with allowed `data-change` plus `영향 인터페이스`/`의존 방향` slots (R15); rendered Architecture prose uses standalone-token filtering (R19) |
| intuition | No item of its own — the substantive verdict is the judgment's (R6) |
| commits | With two or more commits, does every hash appear in the Commit Journey overview (R10); a single commit may use the waiver marker |
| code | Change Group title/herald/order-rationale three slots (R2), a provenance tag on every 왜 (R3), cf-loc traceability (R5), each signal file in exactly one file block (R1), a commit subsection with a valid hash per group + core-logic code per file (R13). At `start`, unified diff hunk metadata is captured; at `code` submission, numeric anchors are checked against the captured hunk ranges. A legitimate first-line hunk may use `base:…:1 → head:…:1`; without metadata, the legacy `:1 → :1` placeholder rejection remains. Added files need `head:` only, deleted files need `base:` only, and a zero-count side has no file lines. |
| render | See Step 8 — it inspects the artifact HTML, mermaid render parity, and the two verification reports |

**Common to all authoring steps**: the whole accumulated document is checked for `<style>`, inline `style=`, and unsanctioned classes (R11).

On failure the failing items are printed as-is. Fix the document and resubmit.

```bash
# Gate 2 — judgment
$CLI pass-step --step <step> --doc "<문서 경로>" --judge-json '<판정 JSON>'
```

The judgment JSON is produced by the judging subagent. Give the judge the **fixed template** in `references/judge-prompt.md` verbatim. Do not compose one yourself.

The judge decides only three of the whole rubric — `R12` (if the architecture has a diagram, do its labels and change markers correspond to grounds in the diff; if it has no diagram, are all three levels' reasoned waivers present), `R6` (does Intuition's concrete example actually exist and get reused in the prose), `R7` (does group N's herald presuppose group N-1). The rest are already decided by the structure check. Passing R12 requires the judge's quote. When a diagram exists the quote must carry the identifier and change-marker grounds; when none exists it must carry all three waiver sentences verbatim.

Each of these three items is **required in exactly one step** — `architecture` for `R12`, `intuition` for `R6`, `code` for `R7`. The other six steps (evidence, background, goal, commits, render, quiz) have no required judge ID, so pass them with `--judge-json '[]'`. If the required ID is absent from the payload it is rejected on that alone, and attaching a real quote to an unrelated ID does not substitute for the missing required ID.

```json
[{"id":"R6","pass":true,"quote":"문서에서 그대로 따온 문장"}]
```

Giving `pass` without a quote, or a quote that is not present in the document as a string, is auto-failed by the CLI.

## Step 8 — render

The markdown is the source; the HTML is derived.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/render.ts --in "<문서.md>" --out "<문서.html>"
```

render.ts bakes ` ```mermaid ` fences to inline SVG via mmdc. The HTML is a single self-contained file with no runtime JS and no external references. If mmdc is absent or a block fails, the render dies with the failing block number — fix that block and re-render.

After rendering, before moving to the quiz, **you must run two verifications.** Because technical-writing may change the Markdown, visual-qa always inspects the final rendered HTML.

1. **technical-writing** — have the technical-writing skill review the markdown prose, and apply the
   accepted points to the document. Record what you applied in `<slug>-writing-report.md` with a last
   line of `REVIEW: APPLIED`. If you changed the document, re-run render.ts.
2. **visual-qa** — with the visual-qa skill (or, on a platform without it, agent-browser directly),
   screenshot-verify the final rendered HTML at desktop and mobile widths: overlap, clipping,
   horizontal scroll, diagram legibility. Record the result next to `<문서.md>` in
   `<slug>-visual-report.md`, and after fixing the findings write a last line of `VERDICT: PASS`.
   If any unaddressed finding remains you cannot write PASS.

```bash
# Gate 1 — artifact check: HTML re-rendered from the current Markdown, mermaid→SVG parity, two verification reports
$CLI submit-step --step render --doc "<문서.md>" --signal-files "a.ts,b.ts" \
  --html "<문서.html>" \
  --visual-report "<slug>-visual-report.md" --writing-report "<slug>-writing-report.md"

# Gate 2 — judgment (the render step has no judge item, so pass it with an empty array)
$CLI pass-step --step render --doc "<문서.md>" --judge-json '[]'
```

The render submission also confirms the HTML is an artifact re-generated from the Markdown current at submission time. Submitting old HTML after editing the Markdown is rejected as a stale artifact, so re-run render.ts after every document edit, then submit.

When the render is done, tell the user the two paths and ask them to read the document.

## Step 9 — quiz

The quiz is **a conversational stage, not a document section.** Do not write a `## Quiz` heading in the document — it would leave an empty clause in the rendered HTML. Manage the questions with the CLI below and pose them in plain prose.

### Question bank

Fix at least one **required concept** per section, and one per subsystem the diff touched for the Code section. If the total exceeds 20, cut by importance and **note in the document that you cut.**

```bash
$CLI add-concept --id <concept> --required
```

The questions are all **short open-ended answers**, and each question fixes, alongside it, the **rubric items** its answer must hit.

- At least two rubric items per question
- At least one of them a concrete value unknowable without reading the document (identifier, coordinate, condition, order)
- Within the same concept, questions do not overlap in required rubric

### Running it

Pose a question in **plain prose and end the turn.** Do not use `AskUserQuestion` — the moment options are visible, what is measured drops from recall to recognition.

```bash
$CLI ask
```

When the answer comes, grade it against the rubric. `grade` is accepted only after `ask` posed a question (the awaiting-response state) — called without `ask`, it is rejected without touching state.

```bash
$CLI grade --concept <id> --doc-digest "<문서 해시>" [--missing "<빠진 루브릭 항목>"]…
```

### On a wrong answer

Do not reveal the answer. Guide in two tiers.

| Tier | Form |
|---|---|
| Tier 1 | Ask for the **observation that leads to** the missing rubric item. Do not use that item's core noun or verb in the question |
| Tier 2 | Point to which spot in the document to re-read |

If they still don't get it at tier 2, reveal the answer and explanation, and move to **a different question on the same concept**.

If the bank is exhausted with an unpassed concept remaining, go back to the section that concept belongs to and re-author it. The document failed to teach it; the reader is not the one who fell short.

## Completion

```bash
$CLI complete
```

Rejected if even one required concept remains. There is no bypass path.

## References

| File | When to open |
|---|---|
| `references/markdown-template.md` | When you start writing the document — skeleton, per-architecture-level diagram types, full list of sanctioned components |
| `references/rubric.md` | Which item is decided by whom, and what each item requires |
| `references/judge-prompt.md` | When calling the judging subagent (fixed template) |
| `references/discipline.md` | The discipline that could not be moved into structure |

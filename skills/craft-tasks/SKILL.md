---
name: craft-tasks
description: Use when a settled design needs decomposition into team-tracked implementation tasks, or those tasks need updating after confirmed decisions. Triggers include "작업 분해", "작업 티켓 최신화", "task로 쪼개서 티켓 만들어", "decompose the design into tasks", and "update task tickets". Not for open requirements or an AI-only execution plan.
---

# Craft-Tasks — Settled-Design Work Decomposition

Turns a **settled design** (the WHAT and the approach are decided) into concrete implementation **tasks**, created as **child tickets under the issue being decomposed** so the team can track them. This is HOW-decomposition — the deliberate **inverse** of requirement slicing.

---

## Input

- **The issue to decompose** — the story, requirement, or issue ticket whose design is settled. Its child tickets are the tasks. The PM tool's label for it (project, epic, story, issue) does not matter.
- **The settled design** — from any source: this conversation, a design doc, a spec file, a ticket comment. No particular upstream skill, artifact, or identifier is required. Judge the design by its content (see the Design Confirmation Gate), never by where it came from.

If the issue does not exist in the PM tool yet, stop and ask the user which ticket the tasks go under. When the requirement itself has no ticket, suggest `craft-issue` as one option.

## When NOT to use

- The requirement/WHAT is still open → suggest `craft-issue`.
- Only an AI-execution plan is needed, not team-facing tickets → suggest `prometheus`.

---

## Design Confirmation Gate

Extract these four items from the design as given, whatever its source:

- **Intent** — what outcome the unit delivers and why.
- **Approach** — the decided way to build it.
- **Invariants** — the rules that must always hold.
- **Boundary** — which services, layers, and components the unit touches.

If every item is present, show all four to the user with the task plan (see Write Flow) and proceed only after the user confirms.

If any item is empty or contradictory, stop before decomposing. Name the empty item and the decision it needs. Offer the ways forward as suggestions, not prerequisites: settle it now in this conversation, run `deep-interview` for a deeper pass, or run `craft-issue` when the requirement itself is unclear. Never invent the missing design — decomposing an unsettled design manufactures HOW that nobody decided.

---

## The Inversion — the rules are the OPPOSITE of requirement slicing

An agent reaching for requirement-slicing rules (craft-issue) on a post-design job will **value-slice into requirement units and fold the real work items away** (observed baseline failure). On a settled design the rules invert. ("WHAT-unit" and "work item" below name *roles*, not any PM-tool level — a team may call them story/task, issue/sub-issue, or anything else.) Hold the right column:

| Axis | Requirement slicing (WHAT — requirement unit) | **craft-tasks (HOW — work item)** |
|---|---|---|
| **Cut by** | user/business value | **implementation step / component** |
| **Layer/platform split** (BE / RN / device / DB) | FORBIDDEN — worthless-until-integrated anti-pattern | **EXPECTED and correct** — each layer is a real, separately-mergeable unit |
| **Implementation step** (schema, guard, calc, wiring) | FOLD into the requirement unit | **MATERIALIZE as its own work-item ticket** |
| **Produces** | the requirement units (design open) | **the work items of a settled unit** |
| **Ordering** | mostly independent | **explicit `blocked-by` chains are normal** — work items are sequenced |

**The point of the inversion:** requirement slicing folds implementation steps *because they have no stand-alone user value*. craft-tasks materializes them *because a trackable, assignable, separately-mergeable unit of work is exactly the team artifact being asked for.* Folding here destroys the deliverable.

**Recursion, not fixed levels:** if a work item is itself too large to implement as one unit, settle its design and run craft-tasks on it. There is no level-name to get right; there is only "is this unit's design settled, and does it still need breaking into trackable work items?"

---

## Scope Fidelity — decompose only what the design contains

Materialize a task **only for work the settled design actually names.** Do **not** invent scope: no QA task, no analytics/telemetry task, no notification task, no hardening task **unless the design names it.** (Baseline agents invented a QA ticket and a notification ticket the design never mentioned — that silently expands the committed work.)

- A genuinely-implied-but-unstated piece (e.g., "this requires a push the design didn't mention") is **surfaced as a flagged question to the design owner**, recorded as `TBD — needs confirmation`, and left OUT of the created task set until confirmed — never silently filed as a task.
- Telemetry/analytics/tests that ride *inside* a component's own work fold into that component's task's done-check; they do not become separate tasks unless the design schedules them separately.

## Granularity Contract — where one task begins and ends

**One task = the smallest unit of work that a single developer can implement, review, and merge on its own (≈ one PR) and that has a defined done-check.** Stop splitting below that.

- This is **not** file-count or LOC. A task may touch several files; it is one task if it is one coherent, separately-mergeable change with one done-check.
- Two steps that can only be reviewed and merged together are **one** task, not two.
- A step with no independent done-check (it cannot be verified until a sibling lands) folds into the sibling — unless the design deliberately sequences it as its own deliverable with a `blocked-by` link.

This contract is what makes two runs land on the same grain instead of one cutting 3 tasks and another cutting 9.

---

## Task Title & Body Shape

**Required reader template:** read [presentation.md](presentation.md) before drafting and apply its reader check to the exact outgoing body. The reader is an implementing/reviewing engineer without the design conversation. Every 변경 대상 entry includes the component's role in this change beside its name/location; the three-section body and native relation rules below remain authoritative.

### Title — name the change, not its position

A task title names the **concrete change this task makes**, in the team's working language (Korean by default) — component/layer plus the action, specific enough to tell apart from its siblings without opening the body (e.g. `[모바일] 프로그램 상세: 미장착 슬롯 흐림 처리 복원`).

- **No decomposition ordinals.** Never append `(item N)`, `(task 3)`, `#2`, or any index from your internal task list — that number is a scratchpad artifact, meaningless to whoever reads the board.
- **Match sibling ticket titles** for any layer/platform prefix; do not invent a new prefix scheme on the spot.

### Body — reader-facing prose only

New task bodies carry exactly these three sections, in the team's working language. Existing task updates maintain these sections while preserving contributor records (see Task maintenance):

- **목적** — what this task delivers toward the settled design (one or two sentences; cite the design decision it implements).
- **변경 대상** — the component / layer / files this touches. Observational, evidence-backed (from the design's boundary). A task legitimately states HOW.
- **완료 조건 (DoD)** — one observable result per item, each with the command, query, or manual step that confirms it. One item = one state change. Do not use `correctly`, `robust`, `fast`, or `securely` as a pass criterion; state the measurable result instead (status code, field value, test name, threshold).

Everything else about a task is expressed through the PM tool's **native fields, not body prose**:

- **Dependencies → native relation field, never body prose.** A sequenced task's predecessor is set through the PM tool's own relation (Linear `blockedBy` / `blocks`), which the team sees on the ticket and filters on. Never write a `## 의존` section or a "blocked by X" sentence in the body — a hard dependency described only in prose is invisible to the board. No hard dependency → no relation to set and nothing to write.
- **Parent link → native parent relation.** Each task links to the decomposed issue through `parentId`; put no "부모 X 코멘트 참조" boilerplate in its body.

### Example — a settled design and one task ticket

- **확정 설계** — `sync.yaml`의 `skills.items`를 시작점으로 삼아 각 `SKILL.md`의 `Skill(...)` 참조를 재귀적으로 해석하고, 중복을 제거한 스킬 의존성 폐쇄만 대상 플랫폼의 스킬 디렉터리에 배포한다. 누락·순환 참조는 동기화를 실패시키며 폐쇄 밖의 스킬은 건드리지 않는다. 경계는 `tools/sync.ts`, `tools/sync.test.ts`, 플랫폼별 스킬 배포 경로다.
- **작업 티켓 제목** — `sync: 스킬 의존성 폐쇄 수집 단계 추가` (only the change, without ordinals or `(item N)`)
  - **목적** — 확정된 설계에 따라 `skills.items`와 각 `SKILL.md`의 참조를 재귀 수집해 플랫폼별 배포 단계가 동일한 폐쇄 집합을 사용하게 한다.
  - **변경 대상** — `tools/sync.ts`의 `skills.items` 해석·배포 대상 수집 로직과 `tools/sync.test.ts`의 중복·누락·순환 참조 테스트.
  - **완료 조건 (DoD)** — `skills.items: [craft-tasks]`에서 시작해 참조된 스킬을 중복 없이 배포 대상에 포함하고 폐쇄 밖의 스킬은 포함하지 않는다(검증: `bun test tools/sync.test.ts`). 누락·순환 참조는 부분 배포 없이 명시적 오류로 실패한다(검증: `bun test tools/sync.test.ts`).

(The body contains only the three sections above. With no hard dependency, leave the relation field unset.)

---

## Write Flow

### 1. Read the issue's current children

Before planning any write, read the decomposed issue's existing child tickets: body, comments, and native relations. A first run finds none; a re-run or an interrupted run finds the tasks written before.

### 2. Build the task plan against what exists

Compare the decomposed tasks with the existing children and sort each into one of these rows:

| Row | Meaning | Action after confirmation |
|---|---|---|
| **Update** | An existing child covers this task | Update in place per Task maintenance |
| **Create** | No existing child covers this task | Create a new child ticket |
| **Unchanged** | An existing child already matches the task | Leave it |
| **Outside the design** | An existing child that no task covers | Leave it; list it for the user. Never close or delete it |

A match is a proposal, not a fact. When a match is uncertain, show it as uncertain and let the user decide.

### 3. Confirm, then write

Show the user, in one message: the four design items from the gate, and the task plan rows with each task's title. Write only after the user confirms. An explicit instruction not to create tickets defers creation; nothing else does once the user has confirmed.

Write in dependency order so each predecessor's ticket ID exists before a successor sets `blockedBy`:

- **Humanizer pass** on Korean reader-facing prose before the write (`Skill(humanizer)`).
- **Runtime tool binding** is resolved at write time. Linear MCP: `save_issue` creates a task (with `parentId` = the decomposed issue, optional `blockedBy`) or updates one by ID; `create_comment` writes a change comment. Other PM tools use their equivalent native parent, relation, and comment fields.

### 4. Verify by re-reading

After the writes, re-read the issue's children. Confirm each planned row landed: title, three-section body, `blockedBy` relations, and any required change comment. Report what was created, updated, left unchanged, and left outside the design.

**Interrupted run:** start again at step 1. The tasks already written show up as existing children, so the new plan contains only the missing writes. Do not create a second ticket for a task that already has one.

### Task maintenance

**The task body is the current effective work definition. Change comments explain why it changed.** Re-read the body, comments, and relations before drafting. Preserve contributor notes, progress, and decisions; update affected work-definition sections instead of replacing the ticket from an old generated draft. If an existing decision conflicts with the supplied design and its supersession is unclear, treat it as unresolved.

| Observed change | Action |
|---|---|
| No effective change | Leave the task unchanged; no duplicate comment. |
| Typo or wording only, with unchanged meaning | Correct the body; no change comment required. |
| Confirmed change to scope, responsibility, DoD, or dependencies | Update the affected body/native fields and append a meaningful change comment below. |
| Unresolved decision or conflicting evidence | Record the open question, evidence, and decision needed without asserting a resolution. Ask the user to settle it (suggest `deep-interview` for a design question or `craft-issue` for a requirement question); update the work definition after settlement. |

A meaningful change comment has three required parts in this order, using the team's language:

- **계기** — the ambiguity, mismatch, or new information that triggered the revision.
- **판단과 근거** — what was settled and the decision/source supporting it; distinguish a correction to match an existing decision from a new decision.
- **변경과 영향** — what changed from before to after and the effect on ongoing work or related tasks. State unknown impact as unknown.

Example change comment:

> **계기:** 서버 검증 작업의 본문에 검증 주체가 클라이언트로 적혀 있어 담당 범위가 혼동됐다.
> **판단과 근거:** 전달된 확정 설계의 “서버가 검증하고 클라이언트는 오류를 표시한다”에 맞춰 잘못된 설명을 정정했다.
> **변경과 영향:** 목적과 완료 조건을 서버 검증 기준으로 수정했다. 클라이언트의 오류 표시 범위는 그대로이며 기존 마이그레이션 배포 완료 메모도 보존했다.

The comment explains the delta; the body contains the resulting task definition. Dependency changes use native relations and receive the same context even when body text stays unchanged.

### The materialize-don't-propose loophole

"Decompose into tasks" is a **write action** — create the child tickets in the PM tool. Listing the tasks as a **"proposed breakdown / 작업 분해 (제안)" section in the issue body instead of creating them is a FAILURE**, not compliance: the work stays un-trackable and the caller must re-ask. The confirmation in step 3 is the gate; after it passes, create the tickets.

**Violating the letter (not materializing the tasks) is violating the spirit (the work stays un-trackable).**

---

## Red Flags

### STOP — you are demanding an upstream artifact

- You stopped because the design has **no interview ID, spec file, or other upstream record** → the source does not matter. Extract the four items from what you have and confirm them with the user.
- You told the user to **run another skill first** when the four items are already present → other skills are suggestions for an empty item, never a prerequisite.

### STOP — you are applying requirement slicing instead

- You are **folding** an implementation step "because it has no stand-alone user value" → that is the requirement-slicing rule; on a settled design you **materialize** it.
- You **refused a layer/platform split** as an anti-pattern → correct for requirement units, wrong for work items; the layer split is the point here.
- You produced **value-sliced requirement units** when the input's design was already settled → produce the settled unit's **work items** instead.
- You created a **QA / analytics / notification** work item the design never named → scope creep; surface it as a flagged question, don't file it.
- You wrote a **"작업 분해 (제안)"** section in the issue body instead of creating the tickets.

**All of these mean: you are applying WHAT-slicing to a HOW job. Re-read The Inversion and produce the settled unit's work-item tickets.**

### STOP — your write duplicated work or mis-shaped the ticket

- You created tickets **without reading the issue's existing children** → a re-run now has duplicates. Read first, then plan.
- The **title carries an ordinal** — `(item 3)`, `#2`, `task 3` — pulled from your internal task list; the board reader has no such list.
- A **"부모 X 코멘트 참조"** sentence landed in a **task body** → the parent link is the native parent relation, not reader-facing prose.
- A **`## 의존`** section (or a "blocked by X" sentence) sits in a **task body** → dependencies are the PM tool's native relation field (Linear `blockedBy` / `blocks`), never body prose.

**All of these mean: the body is reader-facing prose only. Fix the title, keep the parent link and dependencies in native fields, and re-read before writing.**

---

## lazy / deferred

- **No automated review gate.** craft-issue's `issue-reviewer` is tuned for WHAT-issue bodies and would mis-flag a task body for legitimately containing HOW. Add a task-tuned reviewer only if task-body quality proves a recurring problem.
- **No durable write journal.** Re-reading the children and confirming the plan replaces it. Add one only if duplicate tickets after interrupted runs prove a recurring problem.

---
name: craft-tasks
description: Use when a settled design needs decomposition into team-tracked implementation tasks, or those tasks need updating after confirmed decisions. Triggers include "작업 분해", "작업 티켓 최신화", "task로 쪼개서 티켓 만들어", "decompose the design into tasks", and "update task tickets". Not for open requirements or an AI-only execution plan.
---

# Craft-Tasks — Post-Design Work-Decomposition Pipeline

Turns a **settled design** (the WHAT and the approach are decided) into a set of concrete implementation **tasks**, materialized as **shareable child tickets in the PM tool** for the team to track. This is HOW-decomposition — the deliberate **inverse** of craft-issue's WHAT-slicing.

---

## Where this sits (the chain)

```
craft-issue          deep-interview        craft-tasks           prometheus         ultragoal
(WHAT/story)    →    (design + intent) →   (HOW → task tickets) → (plan per task) → (execute)
                       the core                 THIS SKILL          optional·usual
```

craft-tasks is the **output-materializer** of the design core: deep-interview settles a unit's design; craft-tasks projects that design into trackable work.

## When to use / when NOT

- **Use** when: the design of one unit is settled and you need trackable task tickets in the PM tool.
- **NOT** when the requirement/WHAT is still open, or no design exists yet → that is **craft-issue** (it produces the requirement unit; it must run before this).
- **NOT** when you only need an AI-execution plan, not team-facing tickets → that is **prometheus**.

**REQUIRED BACKGROUND:** the design contract and PM-tool write machinery this skill reuses live in `craft-issue` (`../craft-issue/references/issue-craft.md`). This skill owns decomposition and task maintenance. Issue/parent handling belongs to craft-issue; only shared PM mechanics are reused for task writes.

---

## Precondition Gate — is the design actually settled?

Do **not** decompose, and do **not** invent the missing design, if any of these is still open for the input unit:

- **Intent** — what outcome the unit delivers and why.
- **Approach** — the decided way to build it (the ADR-level choices).
- **Invariants** — the rules that must always hold.
- **Boundary** — which services/layers/components the unit touches.

If any is open, **route back**: an open *intent, approach, invariant, or boundary* → `deep-interview`; an unclear underlying *WHAT* (the requirement itself) → `craft-issue`. Decomposing an unsettled design manufactures HOW that nobody decided — the exact "one giant plan that needs constant mid-course correction" failure this pipeline exists to prevent.

---

## The Inversion — craft-tasks rules are the OPPOSITE of craft-issue

An agent reaching for craft-issue on a post-design job will **value-slice into requirement units and fold the real work items away** (observed baseline failure). On a settled design the rules invert. ("WHAT-unit" and "work item" below name *roles*, not any PM-tool level — a team may call them story/task, issue/sub-issue, or anything else.) Hold the right column:

| Axis | craft-issue (WHAT — requirement unit) | **craft-tasks (HOW — work item)** |
|---|---|---|
| **Cut by** | user/business value | **implementation step / component** |
| **Layer/platform split** (BE / RN / device / DB) | FORBIDDEN — worthless-until-integrated anti-pattern | **EXPECTED and correct** — each layer is a real, separately-mergeable unit |
| **Implementation step** (schema, guard, calc, wiring) | FOLD into the requirement unit | **MATERIALIZE as its own work-item ticket** |
| **Produces** | the requirement units (design open) | **the work items of a settled unit** (see the state rule below) |
| **Ordering** | mostly independent | **explicit `blocked-by` chains are normal** — work items are sequenced |

**The point of the inversion:** craft-issue folds implementation steps *because they have no stand-alone user value*. craft-tasks materializes them *because a trackable, assignable, separately-mergeable unit of work is exactly the team artifact being asked for.* Folding here destroys the deliverable.

---

## What routes a unit here is a STATE, not a level or label

The one thing that puts a unit in craft-tasks' hands is that **its design is settled** — not what the PM tool labels it (project, epic, story, issue, ticket — the label varies by team and does not matter). Vocabulary is per-team; **role and state are what decide.**

- **Decompose the settled unit into its work items** — the next-finer trackable child tickets your PM tool offers (in Linear, Sub-issues; the label is irrelevant). Create them under the settled unit.
- **Do not decompose a unit whose design is still open** — route it back (see the Precondition Gate).
- **Recursion, not fixed levels, is the "fractal":** if a work item is itself too large to implement as one unit, it re-enters the loop — `deep-interview` settles ITS design, then `craft-tasks` breaks it down further. There is no level-name to get right; there is only "is this unit's design settled, and does it still need breaking into trackable work items?"

The same ticket is `craft-issue`'s subject while its design is open, and `craft-tasks`' subject once the design is settled. It flows through both as its state advances — it does not change level.

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
- **변경 대상** — the component / layer / files this touches. Observational, evidence-backed (from the design's boundary map). This IS allowed here — unlike craft-issue, a task legitimately states HOW.
- **완료 조건 (DoD)** — verifiable done-checks, each with a verification method (test / query / manual step). Same observable-AC bar as craft-issue's rubric (`../craft-issue/references/issue-craft.md` §2).

Everything else about a task is expressed through the PM tool's **native fields, not body prose**:

- **Dependencies → native relation field, never body prose.** A sequenced task's predecessor is set through the PM tool's own relation (Linear `blockedBy` / `blocks`), which the team sees on the ticket and filters on. Never write a `## 의존` section or a "blocked by X" sentence in the body — a hard dependency described only in prose is invisible to the board. No hard dependency → no relation to set and nothing to write.
- **Design anchor + parent link → native parent relation.** Each child inherits the verified design association through `parentId`; put no raw anchor string, per-child anchor label, or "부모 X의 설계 확정 코멘트 참조" boilerplate in its body.

Use the shared design context resolved through craft-issue. Parent definitions and shared-context placement belong to craft-issue.

### Example — a settled parent design and one child ticket

- **부모 설계(확정)** — `sync.yaml`의 `skills.items`를 시작점으로 삼아 각 `SKILL.md`의 `Skill(...)` 참조를 재귀적으로 해석하고, 중복을 제거한 스킬 의존성 폐쇄만 대상 플랫폼의 스킬 디렉터리에 배포한다. 누락·순환 참조는 동기화를 실패시키며 폐쇄 밖의 스킬은 건드리지 않는다. 경계는 `tools/sync.ts`, `tools/sync.test.ts`, 플랫폼별 스킬 배포 경로다.
- **자식 티켓 제목** — `sync: 스킬 의존성 폐쇄 수집 단계 추가` (only the change, without ordinals or `(item N)`)
  - **목적** — 확정된 부모 설계에 따라 `skills.items`와 각 `SKILL.md`의 참조를 재귀 수집해 플랫폼별 배포 단계가 동일한 폐쇄 집합을 사용하게 한다.
  - **변경 대상** — `tools/sync.ts`의 `skills.items` 해석·배포 대상 수집 로직과 `tools/sync.test.ts`의 중복·누락·순환 참조 테스트.
  - **완료 조건 (DoD)** — `skills.items: [craft-tasks]`에서 시작해 참조된 스킬을 중복 없이 배포 대상에 포함하고 폐쇄 밖의 스킬은 포함하지 않는다(검증: `bun test tools/sync.test.ts`). 누락·순환 참조는 부분 배포 없이 명시적 오류로 실패한다(검증: `bun test tools/sync.test.ts`).

(The body contains only the three sections above. Do not write dependencies, anchors, or parent links in the body — with no hard dependency, leave the relation field unset too; the child inherits its verified design association through `parentId`.)

---

## Write Tail — reuse only applicable craft-issue Stage 6 mechanics

For task writes, reuse the **plain-language/humanizer** pass, **abstract relation/label/write mechanics**, and **runtime binding**. Task maintenance below owns the task update policy.

Tasks have **no automated task reviewer**: WHAT-only slicing and the mandatory issue-reviewer Checklist Review Gate do not apply to task bodies. **craft-issue runs its own workflow for delegated issue/parent work**, including its applicable review gates.

### Design-anchor gate

The handoff carries one immutable shared metadata value in `designAnchor`:
`designAnchor: "design-anchor: deep-interview:<state.interview_id>"`.
Accept only the exact canonical value `design-anchor: deep-interview:<state.interview_id>`, where `<state.interview_id>` is the non-empty identifier persisted in the settled spec's `state.interview_id`. Reject a **missing or invalid anchor** — including an anchor derived from a title, slug, timestamp, or hash — **before any child-tree/create** operation.

### Parent-resolution gate

**REQUIRED SUB-SKILL: Use craft-issue** whenever an issue or parent needs handling, including finding, creating, supplementing, or updating it. Invoke the repository canonical chained skill literally with `Skill(skill: "craft-issue")`. Carry this handoff to it:

```text
parentId: "<known parent ID or URL, when available>"
designAnchor: "design-anchor: deep-interview:<state.interview_id>"
settledContext: "<settled design context, inline or canonical external URL>"
```

Include `parentId` when known, preserve the exact `designAnchor`, and pass the settled design context. craft-issue owns the handling policy and record shape; use its current instructions.

Before reading the child tree, re-read the returned `parentId` and verify that it identifies one parent associated with the exact `designAnchor` and accessible settled context. An already verified handoff needs no redundant parent write. Any ambiguity, mismatch, failure, or interruption stops child processing; return the issue/parent handling to craft-issue. Every child uses that verified `parentId`.

The local spec path is input-only. Outgoing bodies, comments, and delegated write context use portable inline evidence or a canonical external URL; never `$OMT_DIR`, a machine-local path, or `file://`. When no external design URL exists, pass the settled context inline.

### Existing-child / duplicate gate

After the parent-resolution gate, and before any child create, read the verified parent's current child tree and use the organized-tree pattern: **validate → update → gap-fill**.

#### Immutable child identity

Every child task has a non-empty opaque immutable `taskKey`, distinct from `designAnchor`, `parentId`, title, purpose, changed target, slug, timestamp, and hash. For a new genuine gap, generate the key once before creation from fresh opaque identity material; never derive it from mutable fields or shared identities, and never regenerate it during update or recovery. A new gap also gets a fresh opaque `createIntentId` distinct from `taskKey`; never derive or regenerate `taskKey`/`createIntentId` from `childId`, title, purpose, changed target, slug, timestamp, hash, `parentId`, anchor, list order, or body similarity.

The task plan/handoff carries these per-child fields:

```text
taskKey: "<existing immutable key for a known task>"
childId: "<verified PM child ID when known>"
```

taskKey: the existing immutable key for a known task; it is required when updating an existing child. childId: the verified PM child ID when known; it is optional when the task key is available. New gaps may omit taskKey only until craft-tasks generates it. The handoff may also carry `taskIdentities`, the prior result collection of `{ taskKey, childId }`, so a later maintenance run can preserve keys even when the caller does not know every child ID.

Persist each generated key through the existing `create_comment` mechanism as one durable, portable, append-only identity comment, separate from reader-facing body sections and change comments. Use this canonical shape exactly:

```text
<!-- Task identity
taskKey: <opaque immutable task key>
-->
```

Never put identity metadata in body prose or machine-local paths in comments/handoffs. A missing or mismatched identity comment is not a successful create/update.

#### Durable create-intent protocol

The bundled script is the runtime contract. Invoke it through `CLAUDE_SKILL_DIR`; its journal is session-scoped local orchestration state, not a PM field, comment, or idempotency primitive. Do not invent a PM field or idempotency primitive: there is no invented PM field or idempotency primitive. The exact command names are `create-prepare`, `create-child`, `create-complete`, `manual-reconciliation`, and `get`. The create commands are create-prepare, create-child, and create-complete; the manual stop command is manual-reconciliation.

For every genuine gap, generate the opaque `taskKey` and prepare the exact payload that will be sent to `save_issue`. This journal write happens before `save_issue`; call `create-prepare` and wait for its JSON result:

```sh
printf '%s\n' '{"parentId":"<verified parent ID>","designAnchor":"design-anchor: deep-interview:<state.interview_id>","creationPayload":{"body":"<reader-facing task body>","relations":[<exact native relations>],"identityComment":"<exact canonical identity comment>"}}' \
  | bun "$CLAUDE_SKILL_DIR/scripts/task-write-journal.ts" create-prepare
```

The `creationPayload` object is the exact proposed creation payload: its `body`, `relations`, and `identityComment` values must be the values intended for the PM write. Keep identity metadata out of the reader-facing body; do not put identity metadata in the reader-facing body. Use the returned `createIntentId` to call `save_issue` only after the journal result has been persisted with state `prepared`.

After `save_issue` returns a child, verify its `parentId` and exact `designAnchor`. Only after that verified result, call `create-child` with the returned `childId`, the verified `parentId`, and the exact anchor. This changes the journal to state `child-created`:

```sh
printf '%s\n' '{"childId":"<verified child ID>","parentId":"<verified parent ID>","designAnchor":"design-anchor: deep-interview:<state.interview_id>"}' \
  | bun "$CLAUDE_SKILL_DIR/scripts/task-write-journal.ts" create-child <createIntentId>
```

Then write the exact canonical identity comment. Re-read the child, its relations, and the canonical identity comment. Call `create-complete` only when all required re-reads pass, with `childId`, `parentId`, `designAnchor`, and the exact `body`, `relations`, and `identityComment` values; this marks the intent `complete`, so mark the intent `complete` only after those re-reads.

```sh
printf '%s\n' '{"childId":"<verified child ID>","parentId":"<verified parent ID>","designAnchor":"design-anchor: deep-interview:<state.interview_id>","body":"<re-read body>","relations":[<re-read relations>],"identityComment":"<re-read canonical identity comment>"}' \
  | bun "$CLAUDE_SKILL_DIR/scripts/task-write-journal.ts" create-complete <createIntentId>
```

If the `create_comment` response is lost, re-read the canonical identity comment before `create-complete`; specifically, re-read the exact canonical identity comment before `create-complete`. If the exact comment is already present and valid, never writes a duplicate: use the existing verified child and complete the journal without duplicating the comment after the required re-reads. If no verified `childId`/result exists, call `manual-reconciliation` with a nonblank reason and stop. Do not infer a child from title, body, time, or tree position, and do not create a replacement.

On create-intent recovery, use only a verified intent-to-child association. When the create intent records a `childId`, verify its parent and exact anchor, then retry only missing identity/comment writes. If the intent has no `childId`/result, use a documented PM idempotency/client-request lookup only when that PM primitive actually exists; otherwise surface `manual-reconciliation-required` and stop. An unreadable/missing intent also stops safely. Never create a replacement for an uncertain partial child.

#### Durable update-intent protocol

For a meaningful body or native-relation mutation, first prepare the exact before/after delta and the required change comment. The update commands are update-prepare, update-mutation-written, and update-complete. Before any meaningful body/relation mutation, call `update-prepare` with the exact `childId`, verified `parentId`, exact `designAnchor`, `before`, `after`, and `changeComment`; wait for its JSON result with state `prepared`. This is before any meaningful body/relation mutation:

```sh
printf '%s\n' '{"childId":"<verified child ID>","parentId":"<verified parent ID>","designAnchor":"design-anchor: deep-interview:<state.interview_id>","before":{"body":"<old body>","relations":[<old relations>]},"after":{"body":"<new body>","relations":[<new relations>]},"changeComment":"<exact change comment>"}' \
  | bun "$CLAUDE_SKILL_DIR/scripts/task-write-journal.ts" update-prepare
```

The exact update fields are `before`, `after`, `changeComment`, `body`, and `relations`; they are persisted change context, not reader-facing identity metadata. After the PM body/relation mutation and the change comment write, call `update-mutation-written` with the verified association; this is after the PM mutation:

```sh
printf '%s\n' '{"childId":"<verified child ID>","parentId":"<verified parent ID>","designAnchor":"design-anchor: deep-interview:<state.interview_id>"}' \
  | bun "$CLAUDE_SKILL_DIR/scripts/task-write-journal.ts" update-mutation-written <updateIntentId>
```

Re-read the child body, native relations, and change comment. Call `update-complete` only after the body/relations/change-comment re-read passes, using the exact re-read values:

```sh
printf '%s\n' '{"childId":"<verified child ID>","parentId":"<verified parent ID>","designAnchor":"design-anchor: deep-interview:<state.interview_id>","body":"<re-read body>","relations":[<re-read relations>],"changeComment":"<re-read change comment>"}' \
  | bun "$CLAUDE_SKILL_DIR/scripts/task-write-journal.ts" update-complete <updateIntentId>
```

Journal `complete` means all required re-reads passed. A successful PM mutation alone never means complete. On interruption, use `get` to inspect the existing intent, preserve its recorded change context, and perform only missing writes. child-tree rematching is allowed only for an existing verified identity; it is never a way to discover an uncertain new child, never to discover an uncertain new child.

#### Recovery and manual stop

Recovery starts by reading the existing session journal with `get`, then re-reading the PM child and relevant comments. A `child-created` create intent may retry only the missing exact identity comment after verifying its recorded `childId`, parent, and anchor. An update intent in `mutation-written` may retry only the missing body, relation, or change-comment write using its persisted before/after delta and comment. Re-run the corresponding completion command only after the required re-reads pass. An unreadable/missing intent, or any path without a verified `childId`/result, ends with `manual-reconciliation` and a clear reason. Manual reconciliation is terminal; it records the stop and never creates a replacement.

Match in this order: supplied verified `childId` first, then `taskKey` plus the verified shared `parentId` and exact `designAnchor`. Verify the matched child still belongs to that parent and anchor before writing. **purpose and changed target are mutable work-definition fields, not identity fields**; an existing task with the same `taskKey` updates in place when either changes. A different `taskKey` is a genuine gap. Never match by title. Never match by purpose. Never match by changed target. Never match by slug. Legacy children with neither a verified childId nor taskKey stop as ambiguity rather than creating a replacement. A child that cannot prove the shared anchor is not a match.
The matching input is a verified child ID or a stable task key. A stable-key match remains the same task when either purpose or changed target changes; title alone is insufficient. If the stable key or verified child ID is absent for a legacy task, stop with ambiguity.
- **Every child carries the same anchor and `parentId`** through the native parent relation. For matched children, update the existing task body in place using Task maintenance below.
- For gaps, create only unmatched gaps that are genuine coverage gaps. If a match is ambiguous, stop and surface the ambiguity instead of creating.
- After every create/update and on recovery, re-read the child and identity comment. Return a `taskIdentities` result containing `taskKey` and `childId` for every child; the next handoff carries that result. If identity is missing, inconsistent, or the re-read fails, stop without creating a replacement. After an interruption or failure, re-read the current child tree and comments, rematch using the same precedence, and complete only the missing writes. Verify the body, native relations, identity comment, and required change comment before declaring a task updated; a successful body write alone is not completion when its comment is missing. Reuse the recorded change context on recovery and do not duplicate an existing comment. Verify the body, relations, and required change comment before declaring completion.

Only after this gate passes:

- **Create each unmatched genuine gap as a real ticket** in the PM tool. Set `parentId` to the resolved parentId; set `blocked-by` for sequenced tasks; apply labels.
- **Existing task → update in place**, with a change comment when Task maintenance requires one.
- **Humanizer pass** on Korean reader-facing prose before the write (`Skill(humanizer)`), then write.
- **Runtime tool binding** is resolved at write time (Linear MCP: `save_issue` to create or update a task by ID, `parentId`, `blockedBy`, `create_comment` for change context) — same binding note as craft-issue.

The task bodies contain only the three reader-facing sections above: `목적`, `변경 대상`, and `완료 조건 (DoD)`. Identity metadata stays in the canonical comment; do not put it in body prose or in machine-local paths in comments/handoffs.

### Task maintenance

**The task body is the current effective work definition. Change comments explain why it changed.** Re-read the body, comments, and relations before drafting. Preserve contributor notes, progress, and decisions; update affected work-definition sections instead of replacing the ticket from an old generated draft. If an existing decision conflicts with the supplied design and its supersession is unclear, treat it as unresolved.

| Observed change | Action |
|---|---|
| No effective change | Leave the task unchanged; no duplicate comment. |
| Typo or wording only, with unchanged meaning | Correct the body; no change comment required. |
| Confirmed change to scope, responsibility, DoD, or dependencies | Update the affected body/native fields and append a meaningful change comment below. |
| Unresolved decision or conflicting evidence | Record the open question, evidence, and decision needed without asserting a resolution. Route design choices to deep-interview and requirement questions to craft-issue; update the work definition after settlement. |

Before a meaningful change, prepare its body/relation delta and comment together, then persist that exact before/after delta and comment with `update-prepare` before any PM mutation. After the PM mutation, persist the verified association with `update-mutation-written`; after the body/relations/change-comment re-read passes, use `update-complete`. The comment has three required parts in this order, using the team's language:

- **계기** — the ambiguity, mismatch, or new information that triggered the revision.
- **판단과 근거** — what was settled and the decision/source supporting it; distinguish a correction to match an existing decision from a new decision.
- **변경과 영향** — what changed from before to after and the effect on ongoing work or related tasks. State unknown impact as unknown.

Example change comment:

> **계기:** 서버 검증 작업의 본문에 검증 주체가 클라이언트로 적혀 있어 담당 범위가 혼동됐다.
> **판단과 근거:** 전달된 확정 설계의 “서버가 검증하고 클라이언트는 오류를 표시한다”에 맞춰 잘못된 설명을 정정했다.
> **변경과 영향:** 목적과 완료 조건을 서버 검증 기준으로 수정했다. 클라이언트의 오류 표시 범위는 그대로이며 기존 마이그레이션 배포 완료 메모도 보존했다.

The comment explains the delta; the body contains the resulting task definition. Dependency changes use native relations and receive the same context even when body text stays unchanged.

### The materialize-don't-propose loophole (inherited from craft-issue Stage 5)

"Decompose into tasks" is a **write action** — create the child tickets in the PM tool. Listing the tasks as a **"proposed breakdown / 작업 분해 (제안)" section in the parent body instead of creating them is a FAILURE**, not compliance: the work stays un-trackable and the caller must re-ask. Create the tickets only after the settled-design and parent-resolution gates pass, using the resolved `parentId` for every child. **After all applicable gates pass**, the only thing that defers creation is an **explicit caller instruction not to create sub-issues**; that exception does not override an unsettled-design block.

**Violating the letter (not materializing the tasks) is violating the spirit (the work stays un-trackable).**

---

## Red Flags

### STOP — you are doing craft-issue's job instead

- You are **folding** an implementation step "because it has no stand-alone user value" → that is the craft-issue rule; on a settled design you **materialize** it.
- You **refused a layer/platform split** as an anti-pattern → correct for requirement units, wrong for work items; the layer split is the point here.
- You produced **value-sliced requirement units** when the input's design was already settled → you did craft-issue's job; produce the settled unit's **work items** instead.
- You created a **QA / analytics / notification** work item the design never named → scope creep; surface it as a flagged question, don't file it.
- You wrote a **"작업 분해 (제안)"** section in the parent body instead of creating the tickets.

**All of these mean: you are applying WHAT-slicing to a HOW job. Re-read The Inversion and produce the settled unit's work-item tickets.**

### STOP — your write leaked internal metadata or mis-shaped the ticket

- The **title carries an ordinal** — `(item 3)`, `#2`, `task 3` — pulled from your internal task list; the board reader has no such list.
- The **design anchor string** (`design-anchor: deep-interview:…`) or a **"부모 X 코멘트 참조"** sentence landed in a **child body** → that is internal identity/linkage metadata; the anchor stays on the parent and the child inherits it through the native parent relation, not in reader-facing prose.
- A **`## 의존`** section (or a "blocked by X" sentence) sits in a **task body** → dependencies are the PM tool's native relation field (Linear `blockedBy` / `blocks`), never body prose.

**All of these mean: the body is reader-facing prose only. Fix the title, keep the anchor on the parent (the child inherits it through the parent relation), and set the dependency on the native relation field.**

---

## lazy / deferred

- **No automated review gate in v1.** craft-issue's `issue-reviewer` is tuned for WHAT-issue bodies and would mis-flag a task body for legitimately containing HOW. Add a task-tuned reviewer only if task-body quality proves a recurring problem.

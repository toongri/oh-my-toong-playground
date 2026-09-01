---
name: craft-tasks
description: Use when a design is already settled (intent, approach, invariants, and boundary decided — typically after deep-interview) and it must be broken into concrete implementation tasks filed as shareable child tickets in the PM tool (Linear sub-issue / Notion / Jira) for the team to track. Triggers include "작업 분해", "task로 쪼개서 티켓 만들어", "설계 끝났으니 sub-issue로 나눠줘", "이 설계 실행 단위로 만들어", "decompose the design into tasks", "break this into tickets", "file the work items". NOT for requirement-stage WHAT slicing (that is craft-issue), and NOT for an AI-execution plan doc (that is prometheus).
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

**REQUIRED BACKGROUND:** the design contract and PM-tool write machinery this skill reuses live in `craft-issue` (`../craft-issue/references/issue-craft.md`). This skill owns the *decomposition judgment*; it borrows craft-issue's *write tail*.

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

### Title — name the change, not its position

A task title names the **concrete change this task makes**, in the team's working language (Korean by default) — component/layer plus the action, specific enough to tell apart from its siblings without opening the body (e.g. `[모바일] 프로그램 상세: 미장착 슬롯 흐림 처리 복원`).

- **No decomposition ordinals.** Never append `(item N)`, `(task 3)`, `#2`, or any index from your internal task list — that number is a scratchpad artifact, meaningless to whoever reads the board.
- **Match sibling ticket titles** for any layer/platform prefix; do not invent a new prefix scheme on the spot.

### Body — reader-facing prose only

Each task body carries exactly these three sections, in the team's working language, and **nothing else**:

- **목적** — what this task delivers toward the settled design (one or two sentences; cite the design decision it implements).
- **변경 대상** — the component / layer / files this touches. Observational, evidence-backed (from the design's boundary map). This IS allowed here — unlike craft-issue, a task legitimately states HOW.
- **완료 조건 (DoD)** — verifiable done-checks, each with a verification method (test / query / manual step). Same observable-AC bar as craft-issue's rubric (`../craft-issue/references/issue-craft.md` §2).

Everything else about a task is expressed through the PM tool's **native fields, not body prose**:

- **Dependencies → native relation field, never body prose.** A sequenced task's predecessor is set through the PM tool's own relation (Linear `blockedBy` / `blocks`), which the team sees on the ticket and filters on. Never write a `## 의존` section or a "blocked by X" sentence in the body — a hard dependency described only in prose is invisible to the board. No hard dependency → no relation to set and nothing to write.
- **Design anchor + parent link → structural metadata, never body prose.** The `designAnchor` (`design-anchor: deep-interview:<state.interview_id>`) is internal identity carried as a label/identity field (see the gates below), not a line of body text. A child reaches its shared invariants through the native **parent relation** (sub-issue → parent), which the reader clicks through — never through a prose sentence like "부모 X의 설계 확정 코멘트 참조". Both the raw anchor string and any "see the parent comment" boilerplate are leaks; keep them out of the body.

**Shared design invariants are single-sourced on the parent.** Cross-cutting rules (the design's invariants, shared definitions) live once on the **parent** unit; each task inherits them through the native parent relation rather than re-declaring or prose-referencing them — the same Tier-A placement craft-issue uses. This keeps the invariant single-sourced so tasks cannot drift it.

### 예시 — 확정된 부모 설계와 자식 티켓 1개

- **부모 설계(확정)** — `sync.yaml`의 `skills.items`를 시작점으로 삼아 각 `SKILL.md`의 `Skill(...)` 참조를 재귀적으로 해석하고, 중복을 제거한 스킬 의존성 폐쇄만 대상 플랫폼의 스킬 디렉터리에 배포한다. 누락·순환 참조는 동기화를 실패시키며 폐쇄 밖의 스킬은 건드리지 않는다. 경계는 `tools/sync.ts`, `tools/sync.test.ts`, 플랫폼별 스킬 배포 경로다.
- **자식 티켓 제목** — `sync: 스킬 의존성 폐쇄 수집 단계 추가` (순번·`(item N)` 없이 변경 내용만)
  - **목적** — 확정된 부모 설계에 따라 `skills.items`와 각 `SKILL.md`의 참조를 재귀 수집해 플랫폼별 배포 단계가 동일한 폐쇄 집합을 사용하게 한다.
  - **변경 대상** — `tools/sync.ts`의 `skills.items` 해석·배포 대상 수집 로직과 `tools/sync.test.ts`의 중복·누락·순환 참조 테스트.
  - **완료 조건 (DoD)** — `skills.items: [craft-tasks]`에서 시작해 참조된 스킬을 중복 없이 배포 대상에 포함하고 폐쇄 밖의 스킬은 포함하지 않는다(검증: `bun test tools/sync.test.ts`). 누락·순환 참조는 부분 배포 없이 명시적 오류로 실패한다(검증: `bun test tools/sync.test.ts`).

(body는 위 세 섹션뿐이다. 의존·앵커·부모 링크는 body에 쓰지 않는다 — hard 의존 없음이면 관계 필드도 미설정, 앵커는 라벨/네이티브 부모 관계로만 존재.)

---

## Write Tail — reuse only applicable craft-issue Stage 6 mechanics

craft-issue's Stage 6 is not copied wholesale. Reuse only the applicable **plain-language/humanizer** pass, the **append-only** history contract, the **abstract relation/label/write mechanics**, and the **runtime binding**. The design-anchor and parent/child gates below are owned by craft-tasks.

Do not reuse **WHAT-only slicing** or the **mandatory issue-reviewer Checklist Review Gate**. craft-tasks v1 has **no automated task reviewer**; the mandatory issue-reviewer gate is not applicable and must not run here.

### Design-anchor gate

The handoff carries one immutable shared metadata value in `designAnchor`:
`designAnchor: "design-anchor: deep-interview:<state.interview_id>"`.
Accept only the exact canonical value `design-anchor: deep-interview:<state.interview_id>`, where `<state.interview_id>` is the non-empty identifier persisted in the settled spec's `state.interview_id`. Reject a **missing or invalid anchor** — including an anchor derived from a title, slug, timestamp, or hash — **before any child-tree/create** operation.

### Settled-parent record shape

Use one **settled-parent record** for every `supplied`, `found`, `enriched`, and `created` parent branch:

```text
designAnchor: "design-anchor: deep-interview:<state.interview_id>"
goal: "<settled goal>"
approach: "<settled approach>"
invariants: "<settled invariants>"
boundary: "<settled boundary>"
canonicalExternalDesignUrl: "<canonical external design URL, or none>"
```

The record carries the exact `designAnchor`, settled goal, approach, invariants, boundary, and canonical external design URL. It is the one shape used for supplied, found, enriched, and created branches. For an existing parent, missing fields are completed append-only; new parents persist the complete shape.

The local spec path is input-only: use it to read the settled spec, never to populate a write. Any parent or child body or comment must contain portable inline context or a canonical external URL; never `$OMT_DIR`, a machine-local path, or `file://`. If no canonical external design URL exists, keep the settled context inline rather than emitting a local path.

### Parent-resolution gate

After the design-anchor gate and before reading any child tree or creating any child, establish exactly one verified parent:

1. If the handoff includes a `parentId` or parent URL, re-read it in the PM tool and first verify that it is a real existing parent record in the parent role.
   - If it lacks a `designAnchor`, verify that it is a real existing legacy WHAT parent with no `designAnchor`; handle this branch before applying the exact-anchor requirement. If it is not a real existing legacy WHAT parent, stop. Do not replace a verified legacy parent. Then enrich it once, append-only, by adding one append-only design-handoff comment carrying the settled-parent record: the exact anchor, settled goal, approach, invariants, boundary, and canonical external design URL; never use a local session path, `$OMT_DIR` path, or `file://` URL in that comment. Then re-read effective state; continue only after the exact anchor is present.
   - For an existing parent with a non-empty `designAnchor`, apply the exact-anchor requirement: it must **match the exact anchor** through the exact `designAnchor`. An existing parent with a non-empty different anchor remains a hard stop. Complete any other missing settled-parent fields append-only.
2. With no supplied candidate, use a **parent-only search** by the exact settled design anchor. Filter PM search results to verified parent records/parent role before applying the exactly-one cardinality rule. Children sharing an anchor must never be adopted as a parent. Adopt exactly one verified match and stop on cardinality ambiguity. For a found parent, complete missing settled-parent fields append-only. If no match exists, create one parent from the complete settled-parent record. A new parent persists the same anchor and the complete settled-parent record.
3. **Re-read and verify effective state after append/create** for the supplied, found, enriched, or created parent. Continue only when it resolves to one verified `parentId` whose effective state contains the exact anchor and complete settled-parent record; every child must use that same resolved `parentId`.

Any ambiguity, mismatch, append failure, re-read failure, or interruption stops before child creation. Do not create a replacement or duplicate parent; re-search only after the interrupted or failed operation is recoverable, and proceed only with one verified match.

### Existing-child / duplicate gate

After the parent-resolution gate, and before any child create, read the verified parent's current child tree and use the organized-tree pattern: **validate → enrich → gap-fill**.

- Match each intended task to an existing child by this rule: **identity is the exact tuple: anchor + purpose + changed target**; **title alone is insufficient**. A child that cannot prove the exact anchor is not a match; treat a possible legacy match as an ambiguity and stop rather than creating a replacement.
- **Every child carries the same anchor and `parentId`** — as identity/relation metadata: the anchor as a label/identity field and the parent as the native parent relation, **never as body prose** (see Task Title & Body Shape). For matched children, preserve/enrich matched tickets append-only; never rewrite their bodies.
- For gaps, create only unmatched gaps that are genuine coverage gaps. If a match is ambiguous, stop and surface the ambiguity instead of creating.
- After every append/create, **re-read and verify effective state after append/create** before continuing. After an interruption or create failure, re-read the current child tree, rematch, and create only the remaining gaps; any re-read failure or interruption stops before another child is created.

Only after this gate passes:

- **Create each unmatched genuine gap as a real ticket** in the PM tool. Set `parentId` to the resolved parentId; set `blocked-by` for sequenced tasks; apply labels.
- **Existing ticket → append comment, never rewrite the body** (craft-issue's Append-Only History Contract; Append Comment Shape in `../craft-issue/references/issue-craft.md`).
- **Humanizer pass** on Korean reader-facing prose before the write (`Skill(humanizer)`), then write.
- **Runtime tool binding** is resolved at write time (Linear MCP: `save_issue` to create, `parentId`, `blockedBy`, `create_comment` for an existing ticket) — same binding note as craft-issue.

### The materialize-don't-propose loophole (inherited from craft-issue Stage 5)

"Decompose into tasks" is a **write action** — create the child tickets in the PM tool. Listing the tasks as a **"proposed breakdown / 작업 분해 (제안)" section in the parent body instead of creating them is a FAILURE**, not compliance: the work stays un-trackable and the caller must re-ask. Create the tickets only after the settled-design and parent-resolution gates pass, using the resolved `parentId` for every child. **After the precondition gate passes**, the only thing that defers creation is an **explicit caller instruction not to create sub-issues**; that exception does not override an unsettled-design block.

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
- The **design anchor string** (`design-anchor: deep-interview:…`) or a **"부모 X 코멘트 참조"** sentence landed in a **child body** → that is internal identity/linkage metadata; it belongs on the anchor label and the native parent relation, not in reader-facing prose.
- A **`## 의존`** section (or a "blocked by X" sentence) sits in a **task body** → dependencies are the PM tool's native relation field (Linear `blockedBy` / `blocks`), never body prose.

**All of these mean: the body is reader-facing prose only. Fix the title, move the anchor to its label, and set the dependency on the native relation field.**

---

## lazy / deferred

- **No automated review gate in v1.** craft-issue's `issue-reviewer` is tuned for WHAT-issue bodies and would mis-flag a task body for legitimately containing HOW. Add a task-tuned reviewer only if task-body quality proves a recurring problem.

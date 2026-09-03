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

**Purpose & perspective.** Write this document in the first person of the implementer explaining the change they made — the code they implemented and why — to a colleague or team-lead with no prior context on it. The bar: from this document alone, that reader richly and correctly understands what the change does, why it was made, and what they must be aware of when they next modify this code. Keep it clear and accessible — plain language, domain terms glossed on first use, big-picture diagrams (the ELI5 spirit of "explain it simply") — but never dumb it down or thin it out: accessible AND rich, never a thinned-out overview. (This does not relax the completion condition below — it is still not done until the reader passes the quiz.)

```
evidence → background → goal → architecture → intuition → commits → code → render → quiz
```

The document skeleton and the usable visual components are owned by `references/markdown-template.md`.
**A `<style>` block, an inline `style=` attribute, or a class outside the sanctioned list anywhere in the document makes the structure check reject that step** — style is owned by render.ts, and the author writes only content and components.

Each step must pass two gates — **structure check (script) → judgment (subagent, quote required)** — before it advances. The state CLI renders the pass verdict, and writes to the artifact path are permitted or rejected by a hook that reads that verdict. Steps cannot be skipped.

**State purpose, not just mechanism — for the document and for each section.** The document opens (under the title, in the meta block from `markdown-template.md`) with **one line on what this document is for**: which change it teaches and why a reader should understand it. And each major section earns its place — begin Background, 목표, Architecture, Intuition, Code with a short framing of *why this section exists and what the reader takes from it*, not just its content. A reader who lands mid-document should always know why they are reading this part. The skill's own steps carry the how; the sections must also carry the why.

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

The range string passed to `start` is passed unchanged to `git diff` when the
CLI captures textual hunk metadata, so `A...B` retains Git's merge-base diff
semantics. Only commit enumeration normalizes `A...B` to `A..B` for
`git rev-list`.

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

**Then run the source sweep.** The diff never carries its own context — issues, tickets, and docs do. Collect every document source before writing a word of background:

1. **PR body and commit messages** — read them fully; extract every issue key (Linear `ABC-123` style), document link (Notion, wiki), and referenced PR number they carry.
2. **Docs changed inside the diff** — a `docs/`·wiki file in the diff is a source the author shipped with the change; read each one.
3. **Repo docs that govern the touched area** — look for docs/wiki pages about the modules the diff touches.
4. **External trackers/docs (Linear, Notion, Slack)** — when a tool for them is connected, fetch the extracted keys/links and read them; when not, record the key/link as a lead marked 접근 불가 rather than dropping it.

Record the sweep as a **real rendered Markdown table** under the real `### 원천` heading inside `## Evidence` (see `markdown-template.md`). Its header must have exactly four columns — `종류 | 식별자/경로 | 확보 | 내용 요약` — followed by the four-column separator `|---|---|---|---|` and at least one non-empty, non-separator data row. A fenced or comment-hidden heading/table/row, a header/separator-only table, or a malformed header/separator/data row does not count; fenced content is masked before the structure check scans it. Keep one row per source — 종류/식별자·경로/확보(열람·접근 불가)/내용 요약, and `없음 — <확인한 곳>` for a class that truly has none. Background and 목표 are written FROM this table, and `### 출처` later names what each row contributed. **Never write an external artifact's title verbatim from memory** — a PR/issue/Linear/Notion title lives outside the commit ∪ diff corpus, so nothing mechanical can catch a wrong one. Put the identifier (`PR #3776`) in 식별자/경로 and, unless a tool returned the exact title this run (`gh pr view <N> --json title`), describe the artifact by its grounded content in 내용 요약 rather than quoting a reconstructed title. See `discipline.md` (Remainder 5 — external-artifact naming).

From here on, every step's document accumulates into a single markdown file:
`$OMT_DIR/explain-diff/YYYY-MM-DD-<slug>.md`

## Step 2 — background

Write **both** tiers, **from the source sweep**: the facts a collected source taught go into the matching tier with the source named inline in parentheses (the decision doc's rationale into 좁은 배경, the system overview a wiki page gave into 깊은 배경). A background written only from code reading while the 원천 table holds unread rows is incomplete.

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

### 출처
<이 목적·컨텍스트를 파악하는 데 실제로 쓴 근거 — Linear 이슈, Notion 문서, Slack 스레드, PR 설명, 커밋 본문, 위키 문서 경로, 또는 코드 추론. 접근할 수 있으면 식별자/경로를, 없으면 어디서 왔는지 한 줄>
```

All three sub-headings are verified by the structure check (R16). What each says is yours to fill. The `### 출처` names where the WHY came from so the reader can trace and trust it — the same provenance discipline R3 applies to each change's 왜, here applied to the whole document's purpose. Fill it from the `### 원천` table: one line per row saying what that source contributed to this document (not just its name). In a sandbox with no external tools, cite the in-repo grounds (commit body, PR description, wiki) or say `코드 추론`; never leave it blank.

## Step 4 — architecture

Draw the structure needed to **understand this diff** at **three levels**. Each level is a mermaid diagram plus reading prose under the `### 시스템 레벨`, `### 컴포넌트 레벨`, `### 도메인 레벨` headings.

**These diagrams are not a diff-only world.** Draw whatever scope a reader needs to understand the change — including surrounding systems, services, and components the diff does *not* touch, as context. The one requirement: **mark which elements this diff actually changed** (`:::changed` / Before-After), so context and change are never confused. Every node must be a real element of the actual system — never an invented placeholder.

| Level | Question it answers | Belongs here |
|---|---|---|
| 시스템 (system) | Which **distinct processes, services, deployables, and stores** are involved, and which boundary does the diff touch | Only cross-process/service/store boundaries. An in-process call chain (functions/modules inside one runtime) is **NOT** the system level — that belongs to 컴포넌트/도메인. If the diff crosses no process boundary, the system level is a `구조 변화 없음: <사유>` waiver, not an in-process chain dressed up as a system picture. |
| 컴포넌트 (component) | How dependencies between modules and domains differ before vs after the change | Module/domain structure within a process |
| 도메인 (domain) | What the entities, concepts, and invariants are, and what changes | Entities, concepts, invariants |

**Each system subgraph shows its interior.** Draw every involved process/service/store as a `subgraph`, and inside it the core resources this change flows through in that system — the modules, stores, and mapping tables a reader must know to follow the change (2–5 interior nodes per system is typical; internal dependency edges between them are welcome when the diff's flow runs through them). The picture a reader should get in one look: 시스템 단위 + 각 시스템의 내부 핵심 구성 + 시스템 사이의 계약. A subgraph whose only interior node restates the subgraph's own label shows a boundary but no composition — name the actual parts inside instead. This does not soften the boundary rule above: a diff that crosses no process boundary still uses the waiver, and interior nodes never substitute for the cross-process edge that makes this the system level.

**The system level does not end with a diagram alone.** Keep diagram edges to a **short protocol** (HTTP·SQL·REST) — long endpoints/queries on an edge break layout. Under the diagram (or waiver), place **two** tables. First, a **standing-interface table** (R17) naming which boundary talks over which endpoint, query, or screen URL, and what flows. It must be a real rendered Markdown table with exactly these three columns and at least one data row — prose-only labels, a fenced example, or a header/separator-only table do not count:

| 경계 | 인터페이스 | 오가는 것 |
|---|---|---|
| <프로세스·서비스 경계> | <엔드포인트·쿼리·화면 URL> | <오가는 데이터> |

**The `인터페이스` and `오가는 것` cells must show the actual message, not a naming-convention note.** A reader cannot tell what an interface does from "camelCase generationRequest" — write the signature and the request/response shape: the endpoint/procedure plus the fields it takes and returns, with types (`initiateGeneration(input: { generationRequest: { userRequest: string; intakeTimeCodes: string[] }, proposalType: enum }) → { asyncTaskId: string }`). Name the payload and response body concretely so the reader knows what value crosses the boundary; a bare field name or a convention label is not an interface.

Then, a **change-contract table** (R14) across three axes — `서버 API` (endpoints, tRPC procedures, request/response schemas), `DB 스키마` (tables, columns, constraints), `클라이언트 의존` (contracts the client must change to match); each axis states the changing contract or `변경 없음: <사유>`. Order: diagram → standing-interface (context) → change-contract (delta). The three axis labels pass R14; the three rendered column labels (`경계`·`인터페이스`·`오가는 것`) pass R17. Format follows `markdown-template.md`.

**The component level decodes each changed node (R18).** A component is a **module as a unit** — a feature, a use case, a hook, a service, a schema module — not a file. So the diagram's **nodes are module/concept names**, never source file paths: a file path as a node label tells the reader a location, not a component, and long paths truncate mid-word in the render (`health-`, `proposal-`). **Where** a component lives is said in the card's `패키지` slot at package granularity (`packages/schemas/src/program`, `entities/supplement/api`) — the diagram names the component, the card says where it sits (the slot holds a directory path, so it is named 패키지, not "레이어"). R18 rejects a component diagram whose nodes are file paths. A reasoned component-level `구조 변화 없음: <사유>` waiver is accepted (but a file-path node fails even under the waiver). Otherwise, every authored `arch-entity` card is checked independently for `패키지` / `책임` / `인터페이스` (functions) / `변경점` (WHAT this diff changed in the node, before→after) and `data-change="new|mod|del"`; one complete card cannot mask an incomplete or invalid card. Prose-only card descriptions and unsupported `data-change` values do not count; a pure data/contract-only level must use the reasoned waiver instead of simply omitting cards. The labels and valid cards are what R18 checks.

**The domain level decodes each touched domain object (R21).** The `### 도메인 레벨` is the thinnest level if left as a bare diagram — a reader cannot tell which domain object this diff added or changed, or what invariant it now guarantees. The nodes and cards must be **real business concepts** — the things the domain actually models (a Program, an intake-time slot, a request kind like 온보딩 vs 일반 생성) — decoded in the codebase's own domain terms. A schema class name is acceptable **only when you explain the business concept it encodes**; a bare encoding name (`GenerationIntakeTimeCodesSchema`) with no business meaning is not a domain object. Above the entity/relation diagram (`erDiagram`/`classDiagram`), every touched domain object gets an `arch-entity` card carrying its `책임` (the object's duty, invariants, and the business logic it already owns — prose, a one-liner leaves the most important level thin again, but member variables do NOT go in this prose), its `핵심 멤버` (members/keys/core methods as structured code chips, changed ones highlighted with `class="chg"`; a member-less concept writes `핵심 멤버 없음 — <사유>`), its `변경점` (which of those responsibilities this diff added/changed/removed, before→after), and a `data-change` change kind. **If you draw an object/class diagram, fill each class box** — its member variables (what it holds) and its methods/messages (what it does); an empty box with only a class name teaches nothing, and R21 rejects a `classDiagram` whose boxes have no members. Diagram nodes are domain-concept names, never file paths. A reasoned `구조 변화 없음: <사유>` waiver stands in when the diff changes no domain object; otherwise every card is checked for `책임` + `핵심 멤버` + `변경점` + a valid `data-change`, the same way R18 checks component cards.

**Stateful concepts get a state diagram.** When a concept this diff touches carries a lifecycle — three or more states, or named transitions like 잠금, 재시도 초과, 확정, 만료 (an input field that locks after N attempts is a lifecycle, not just a widget) — add a `stateDiagram-v2` to the domain level alongside the entity diagram, its transition labels carrying the actual guards/triggers from the code (`시도 5회 초과`, `cartridgeInfo.isInvalidData`), with side effects as notes. When no touched concept has such a lifecycle, one sentence saying so stands in — the reader learns the absence was checked, not overlooked.

**The Architecture section closes with a boundary/dependency/use-case change map (R15).** After the three levels, add a `### 경계·의존·유스케이스` block. Its unit of account is the **execution unit** — one card per thing that is invoked and runs (a service method, an HTTP endpoint, a batch script, a hook); a cross-cutting property (a transaction boundary, idempotency) is never its own card but is described inside the `한 일` of the unit that owns it, and each card's `한 일` opens by stating the unit's identity (what kind of thing, which module owns it). A feature/use case mostly carries an **orchestration** responsibility, so this block's centre of gravity is the **flow**: show it as a mermaid `sequenceDiagram` — who calls whom in what order — and mark the step this diff changed (a `Note` or `:::changed`). A reasoned `구조 변화 없음: <사유>` waiver stands in when the diff changes no use-case flow (R15 checks the block for a mermaid diagram or that waiver). Above/around the diagram, add a renderer-recognized `arch-entity` per behaviour unit with an allowed `data-change="new|mod|del"`, plus the `영향 인터페이스` and `의존 방향` slots; prose-only mentions or unsupported change values do not count. The `영향 인터페이스` slot names the actual signature/payload the use case exposes or calls — endpoint/procedure plus the request and response shape — not a bare name. **This slot leaks the same sibling invention as code fences**: the signature must be the unit's real declaration in the code, not a plausible reconstruction — no invented parameter (`runForHousehold(householdId, userId)` when the real signature is `runForHousehold(householdId, beforeProductIds?)`), no sibling method the unit does not actually call (a raw-transaction data-migration's interface is not `SomeService.create`). Open the unit (`git show <hash>:<path>`) and read its actual declaration and calls; if it reaches a call only through a deeper private method, say so rather than hoisting that inner signature onto the outer one. See `discipline.md` (Remainder 5 — interface-signature fidelity). Close with a dependency-direction verdict (keeps/violates/restores unidirectional dependency; flag any reach-in, back-reference, or cycle). **Do not write methodology names (FSD·Feature-Sliced·Clean Architecture·DDD·bounded context) OR bare axis labels (`수평`/`수직`) in the Architecture prose (R19)** — name the touched areas in the codebase's own domain terms, not by sorting parts into a horizontal/vertical grid. The vocabulary follows the `architecture-boundaries` rule but the output speaks the codebase's own domain terms. Format follows `markdown-template.md`.

**A user-facing change gets a user-journey view.** When the diff touches a surface a person interacts with — a screen, an input field, a badge or displayed status, a notification, an entry point — the 경계·의존·유스케이스 block also carries a **사용자 여정 `flowchart`** alongside the orchestration sequence: it starts at the user's first action (`([사용자: 진입 행 탭])`), passes through every decision and failure branch the user can actually hit (권한 거부, 입력 잠금, 재시도), and ends at what the user sees. The orchestration sequence says who calls whom; the journey says what the person experiences — a reader should be able to tell what the feature *is* from this one picture. Mark the steps this diff changed. When the diff touches no user-facing surface, one sentence saying so stands in.

**Diagram count scales with the change.** The levels and blocks above are a floor, not a cap — a diff spanning several systems, stateful concepts, or branch-heavy functions carries as many diagrams as its triggered content demands (the state and 분기 rules above already multiply; the same applies per system side). Never consolidate two different concerns into one diagram to save space.

R19 scans the rendered `## Architecture` prose after ignoring fenced blocks and inline-code examples, and rejects only standalone methodology or axis tokens (methodology matching is case-insensitive). A token embedded in a code identifier or example is not prose.

**Every diagram reads as 읽는 목표 → 그림 → 해석.** Immediately above each mermaid fence, one sentence naming what the reader can verify or decide with this picture — a concrete objective, not a genre label ("이 그림은 흐름을 보여준다" teaches nothing). Immediately below it, 2–3 sentences of 해석 that name specific nodes/edges actually drawn and the structural fact they establish — a lifetime difference between two stores, the single edge that keeps a dependency one-way, the point where two cause-paths merge, which priority wins. The 해석 describes the drawing (a claim with no corresponding drawn node/edge belongs elsewhere), and this shape applies to every mermaid fence in the document — the three architecture levels, the 경계·의존·유스케이스 flow, and any 분기 diagram in Intuition alike.

**When the component level spans systems, group by system.** If the component diagram carries modules from two or more processes/services (a Node service and a Python service, a mobile app and a backend), wrap each system's modules in its own `subgraph` so the picture itself says which module lives in which process — cards and prose saying it is not enough when the drawing mixes them flat. Each system's modules keep that system's own layering vocabulary.

Write diagrams in a ` ```mermaid ` fence — they are baked to inline SVG at the render step, so the final HTML stays self-contained. If any diagram is present, its node/edge labels must be **real identifiers of the actual system** — service, module path, command, entity names — not invented generic nouns (a "service → DB" picture fits any diff and fails R12). Context nodes the diff does not change are welcome, but at least one level must carry a change marker (`:::changed` or Before/After contrast) pointing at what this diff changed, and for the 시스템 레벨 the marked-and-drawn boundary must be an actual cross-process/service boundary, not an in-process call. The identifier grounds and the change marker must appear together in the judge's required quote (R12). Type selection and syntax rules follow `markdown-template.md`.

A level with genuinely nothing to draw is replaced by `구조 변화 없음: <사유 한 문장>` — a marker with no rationale is rejected by the structure check. If there is no diagram at all and every one of the three levels carries this reasoned waiver, R12 can still be satisfied. In that case the judge's quote must include all three waiver sentences — system, component, domain — as strings copied verbatim from the document; if any is missing or lacks a rationale, it does not pass. This waiver exception does not apply once any diagram is present.

## Step 5 — intuition

Write only the **essence** of the change. Detail is the next step's job. Make a concrete toy value actually appear, and reuse that value in the explaining sentence.

Draw with sanctioned components. Do not use ASCII diagrams, and do not invent style.

- Something that flows in one line (call order, data flow + example values) → `flow` component
- Before/after contrast → `compare` component
- A two-dimensional structure needing boundaries or branches → ` ```mermaid ` (same syntax as the architecture step)

**Changed logic with 3+ branches gets a flowchart.** When a function this diff adds or changes carries three or more branch points counting error and edge paths — a priority resolution, a chunked retry, an attempt-limit lockout, a union-kind dispatch — draw its branching as a `flowchart` (here in Intuition, or beside the owning change block in step 7) with the real predicates as branch labels, and walk the toy value through it. Prose alone leaves the reader simulating the branches in their head; the picture is the simulation. Simpler logic (≤2 branches) stays prose — a flowchart there is noise.

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

The unit is the **change (변경)**, not the file, and **the spine is the commit.** A Change Group (a concern) descends commit by commit; under a commit come **change blocks** (`#### 변경 N: <한 일>`). **A change is not a file** — one change is realized by the responsibility shifts of several **symbols**, the classes/functions edited together for one reason. So a change block carries one entry per symbol, and **each entry's subject is the symbol, told before→after**: `<code>symbol</code>` + where it lives (which layer/domain — pointing back to the architecture cards), then **기존** (the responsibility and behavior that symbol carried) and **변경** (how this diff changed it), as complete sentences. A newly created symbol writes **신설** (the responsibility it now takes) instead of 기존; a removed one writes **삭제** (where its duty went). Numbered role labels that state only the post-state ("책임 1 — <역할> … 이제 하는 일") leave the reader unable to tell what it was like before — a measured defect. The file appears only as a location citation in the `cf-loc` slot, never as the heading. A signal file may be cited by more than one change; what must not happen is a signal file no change cites (R1).

```markdown
## Change Group 1: <관심사>
> 예고: <what this group will do — 그룹 N presupposes 그룹 N-1>
> 순서: <one line on why this order>

### `<short-hash>` — <커밋 제목>
<one or two sentences on what this commit did in this group. If it spans multiple groups, one spillover line.>

#### 변경 1: <이 변경이 이룬 것 — 파일명이 아니라 한 일로>
<div class="cf" data-change="mod">
<p><strong><code>Class.method()</code></strong> (<어느 레이어·도메인의 무엇인지 배치>) — <strong>기존</strong> <지던 책임과 동작>. <strong>변경</strong> <이번 diff로 어떻게 달라졌는지>.</p>
<p><strong><code>otherFn()</code></strong> (<배치>) — <strong>신설</strong> <새로 지는 책임>.</p>
<p><strong>왜</strong> — <이 변경이 필요한 이유> <span class="cf-src">근거</span> "<원문 인용>"</p>
<p><strong>효과·사이드이펙트</strong> — <이 변경이 부른 결과·부작용 — 완결 문장></p>
<p><strong>검증</strong> — <이 변경을 고정하는 테스트와 무엇을 잠그는지></p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:path/a.ts:12</code>→<code>head:path/a.ts:15</code>, <code>base:path/b.ts:40</code>→<code>head:path/b.ts:31</code></p>
</div>

​```ts
// 핵심 로직 — real code or pseudocode (one required per change block)
​```
```

The slots fill R13, R3, and R5. The `왜`·`효과·사이드이펙트`·`검증`·code are at the change level; the symbol entries (기존/변경/신설/삭제) and `바뀐 위치` carry the symbols and their files. The component, field labels, and code-fence rules follow `markdown-template.md`.

- **Commit subsection** (`### \`hash\``): at least one per group. The hash must be a range commit that `start` pinned (R13). A commit subsection **claims** "this commit changed these files" — so every cf-loc path under it must be a file that commit actually touched: run `git show --name-status --format= <hash>` and cite only paths in that list. Path precision: an in-place modify (`M`) has base path == head path (never a different head directory — a fabricated head path may not even exist at head); a rename (`R`) is the one case base≠head; a symbol that MOVED files across commits is cited under its defining commit by the path **at that commit**, not the head file it ended in. A file renamed later may be cited by its head path (noted). To satisfy R5 coverage for an as-yet-uncited file, find its real commit (`git log --oneline <range> -- <path>`) and cite it there — never invent a catch-all "남은 위치 보강" section with guessed hashes. Attribution is the dominant invention class; see `discipline.md` (Remainder 5 — attribution).
- **Core-logic code**: one code fence per change block — the few lines that reveal the change's core (the central responsibility). Location anchors alone do not read as "what was done" (R13). Pseudocode is allowed to abstract control flow, but **never to swap an identifier**: every concrete symbol the fence names (variable, method, field, enum value, assertion target, response key) must be the identifier this commit's diff for that path **actually uses on that line** — not merely one that exists in the file. **Transcribe, don't reconstruct**: run `git show <hash> -- <path>`, copy the actual `+` lines the fence stands for, then abstract structure while keeping every identifier byte-exact. A plausible sibling from the same family is still invention (`getSettings(ctx.householdId)`, not the real-but-wrong `getSettingsForUser(...)`; `supplementManagementEnabled`, not the plausible `orderManagementEnabled`). Before submitting the code step, audit every fence against its commit's diff hunk. See `discipline.md` (Remainder 5 — code-fence fidelity).
- **`cf-loc` location anchors**: put `base:` (before) and `head:` (after) for **every file this change touched** in the `바뀐 위치` slot outside the prose (R5). This is a location citation, not a flow — flow is the use-case sequence diagram's job.
  `start` passes the original range unchanged to `git diff` for textual hunk capture, preserving
  `A...B` merge-base semantics; only `git rev-list` commit enumeration changes it to `A..B`. At the
  `code` submission, R5 gathers every `base:path:line` / `head:path:line` anchor across all change
  blocks, keys them by their own cited path, and checks **per signal file** that its before and after
  are cited and land in real hunks. If a signal file has no textual hunk while others do, it uses the
  legacy presence/placeholder fallback instead of being rejected. A legitimate first-line hunk may use
  `base:…:1 → head:…:1`; without hunk metadata for that file, the fallback still rejects a modified
  file whose only anchors are the `:1 → :1` placeholder. With metadata, an added file needs only a
  `head:` anchor, a deleted file only a `base:`, and a zero-count side needs none. New-ness comes from
  `A` in `git diff --name-status`; deleted-ness (no head side) from the hunk header. Read the real
  ranges from the captured hunk headers rather than inventing positions.
- **`cf-src` provenance tag**: one of three on every 왜 field (R3).

| Situation | Tag |
|---|---|
| The ground is in the diff, commit message, or a comment | `<span class="cf-src">근거</span> "<원문 인용>"` |
| No ground, but it is inferred from the code | `<span class="cf-src">추론</span> <추론의 근거>` |
| No reachable ground | `<span class="cf-src">Unknown / not supplied</span>` |

Leave the third case **as an open question inside the document.** Do not ask the user in conversation — steps 1–8 run without a person.

**A `근거` quote is machine-checked against the real source (R22).** At the `code` step the structure check concatenates every in-range commit body with the range's net diff and requires each `근거` quote to be a substring of it — compared after whitespace and markdown markers (`` ` `` `*` `_` `~`) are removed, so a faithfully unwrapped, de-emphasized quote passes while a paraphrase or a sentence lifted from the PR description (which lives nowhere in the source) fails. If R22 rejects a quote, it is not verbatim ground: copy the exact words from the commit body or the diff, or, if the reason genuinely comes from reading the code rather than any written source, downgrade the tag to `추론` with its real inference ground. Never invent a quote to satisfy the badge. (R22 checks the quote is real, not that it sits in the specific commit the block names — that attribution stays your responsibility.)

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
| goal | Does the `## 목표` section carry all three sub-slots — `### 무엇을·왜`, `### 핵심`, and `### 출처` (R16) |
| architecture | Three level headings, each with a mermaid diagram or a reasoned waiver (R9); system level has the three change-contract axes (R14) and a real rendered three-column standing-interface table `경계`/`인터페이스`/`오가는 것` (R17); component level accepts a reasoned waiver or requires `arch-entity` cards with `패키지`/`책임`/`인터페이스`/`변경점` and `data-change`, and rejects a diagram whose nodes are file paths (R18); domain level accepts a reasoned waiver or requires `arch-entity` cards with `책임`/`핵심 멤버`/`변경점` and `data-change`, rejects file-path nodes, and requires a `classDiagram`'s boxes to carry members/methods (R21); boundary/use-case block requires an orchestration mermaid diagram (or waiver) plus a real `arch-entity` with allowed `data-change` and `영향 인터페이스`/`의존 방향` slots (R15); rendered Architecture prose uses standalone-token filtering (R19) |
| intuition | No item of its own — the substantive verdict is the judgment's (R6) |
| commits | With two or more commits, does every hash appear in the Commit Journey overview (R10); a single commit may use the waiver marker |
| code | Change Group title/herald/order-rationale three slots (R2), a provenance tag on every 왜 (R3), cf-loc traceability (R5), every signal file cited by at least one change block's `바뀐 위치` anchors (R1 — a file may be cited by several changes), a commit subsection with a valid hash per group + core-logic code per change block (R13), and every `근거` quote a real substring of the commit-body ∪ net-diff corpus after whitespace/markdown normalization (R22). `start` passes the original range unchanged to `git diff` (preserving `A...B` merge-base semantics); only `git rev-list` enumeration normalizes it to `A..B`. At `code` submission, R5 keys every `base:`/`head:` anchor by its own cited path and checks per signal file that its before/after are cited and land in real hunks; a file with no textual hunk uses the legacy presence/placeholder fallback. A legitimate first-line hunk may use `base:…:1 → head:…:1`; added files need `head:` only, deleted files `base:` only, and a zero-count side has no file lines. |
| render | See Step 8 — it inspects the artifact HTML, mermaid render parity, the technical-writing report, and the final checklist verdict |

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

After rendering, before moving to the quiz, **run the one verification the machine cannot do — technical-writing.** Do NOT screenshot-review the visual layout per document: style is owned by render.ts and is deterministic, so a layout defect is systematic (fix it once in render.ts + its test, never re-review). The one visual risk that used to justify a per-document pass — a wide mermaid diagram whose labels collapse below legibility — is now sealed at the renderer: `normalizeSvgWidth` keeps every diagram at its natural viewBox width and `figure.diagram` scrolls, guarded by `render.test.ts`. There is no `visual-qa` step here.

1. **technical-writing** — have the technical-writing skill review the markdown prose, and apply the
   accepted points to the document. Record what you applied in `<slug>-writing-report.md` with a last
   line of `REVIEW: APPLIED`. If you changed the document, re-run render.ts.

2. **Final self-review checklist** — open `references/final-checklist.md` and grade the finished
   document against its 9 axes (system decomposition, both-sides coverage, goal→diagram→interpretation,
   state diagram, logic flowchart, real identifiers + changed markers, sequence activation balance,
   user journey, clean render). Write the graded table to `<slug>-final-checklist.md` next to the
   document, ending with `CHECKLIST: ALL PASS`. Any FAIL → fix the document, re-run render.ts,
   re-grade from the top. The quiz does not start while a FAIL remains.

The render artifact gate requires all three artifacts: `--html`, `--writing-report`, and `--checklist`.
The checklist file must exist and its last non-whitespace line must be exactly `CHECKLIST: ALL PASS`.
Missing or invalid checklist evidence keeps the state at `render`, so the quiz cannot start.

```bash
# Gate 1 — artifact check: current HTML, mermaid→SVG parity, technical-writing report, final checklist verdict
$CLI submit-step --step render --doc "<문서.md>" --signal-files "a.ts,b.ts" \
  --html "<문서.html>" \
  --writing-report "<slug>-writing-report.md" \
  --checklist "<slug>-final-checklist.md"

# Gate 2 — judgment (the render step has no judge item, so pass it with an empty array)
$CLI pass-step --step render --doc "<문서.md>" --judge-json '[]'
```

The render submission also confirms the HTML is an artifact re-generated from the Markdown current at submission time. Submitting old HTML after editing the Markdown is rejected as a stale artifact, so re-run render.ts after every document edit, then submit.

When the render is done, tell the user the document, HTML, writing-report, and final-checklist paths and ask them to read the document.

## Step 9 — quiz

The quiz is **a conversational stage, not a document section.** Do not write a `## Quiz` heading in the document — it would leave an empty clause in the rendered HTML. Manage the questions with the CLI below and pose them in plain prose.

### Question bank

Fix at least one **required concept** per section, and one per subsystem the diff touched for the Code section. If the total exceeds 20, cut by importance and **note in the document that you cut.**

**Test understanding, not metadata.** The quiz measures whether the reader grasped **what this change is for and why it was needed** — its purpose, the problem it solves, the tradeoff it makes, the reason one path was chosen over another. Do **not** ask about document metadata or bookkeeping — the git range, the signal/noise file counts, the number of commits — none of that proves comprehension of the change. Every question ties to the substance: the purpose (why this change exists), the mechanism (how it works), or the consequence (what it enables or prevents). If a question could be answered by skimming the header without understanding the change, cut it. At least one required concept must be a **why/purpose** question, phrased so the answer must state the reason, not just the mechanic.

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
| `references/final-checklist.md` | Step 8, after render — the 9-axis self-review gate before the quiz |
| `references/judge-prompt.md` | When calling the judging subagent (fixed template) |
| `references/discipline.md` | The discipline that could not be moved into structure |

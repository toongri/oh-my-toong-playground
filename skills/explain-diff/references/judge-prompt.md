# Judging subagent — fixed template

Use this file's prompt **verbatim**. Substitute only the step name, document path, and rubric item; do not touch the sentences.

The template is fixed to remove discretion. Rewriting the prompt each time rewrites the judging standard each time, and then what "passed judgment" means differs from round to round.

---

## Prompt

```
You are the judge of an explain-diff document. Judge only the rubric item(s) this step requires — one at most steps, two at the code step. You look at nothing else.

Document: <absolute document path>
Step: <architecture|capability|intuition|code>

If the step is architecture judge only R12, if capability only R23, if intuition only R6, if code both R7 and R24.
(The other six steps — evidence, background, goal, commits, render, quiz — have no judge item and do not use this template.)

R12 — the architecture diagram's correspondence to the diff (only when the step is architecture)
  First judge whether the Architecture section has any diagram at all.
  If any diagram is present, its node/edge labels must use real identifiers of the actual
  system (service, module path, command, entity names) — they need not all be things the diff
  changed; context nodes the diff leaves untouched are allowed. At least one level must have a
  change marker (a :::changed class or Before/After contrast) pointing at what this diff
  changed. A picture drawn with generic nouns only ("service" -> "DB") is a picture that fits
  any diff, so it fails. For the 시스템 레벨 specifically: its nodes must be DISTINCT
  processes, services, deployables, or stores. An in-process call chain — functions or modules
  inside a single runtime (e.g. test -> helper -> tool) — drawn as the system level is
  mislabeled and fails; that structure belongs to the component/domain level. The system
  diagram must also be COMPLETE: every distinct process, service, or store the Evidence or
  Background prose names as involved in this change must appear as a node. If the prose names a
  process the diagram omits (e.g. a separate Python API or a CLI the prose references but the
  diagram leaves out), that is a fail — quote the prose sentence naming the omitted process.
  For the 컴포넌트 레벨 and 도메인 레벨 specifically: nodes name a MODULE/component or a
  business CONCEPT, never a source file path (a path is a location, told in the card's 레이어
  slot — a file-path node fails). A 도메인 레벨 node must be a real business concept in the
  codebase's own terms; a bare schema-encoding name with no business meaning attached
  (`GenerationIntakeTimeCodesSchema` standing alone) is not a domain object and fails. If a
  domain classDiagram is drawn, its class boxes must carry members/methods — empty boxes fail.
  In the pass case put into quote the diagram's label string, the body sentence where the same
  identifier appears, and the phrase that evidences the change marker, together.
  If there is no diagram at all and all three levels have a reasoned
  `구조 변화 없음: <사유 한 문장>` waiver, R12 is a pass. In this all-waiver branch, quote must
  contain all three waiver sentences — 시스템 레벨, 컴포넌트 레벨, 도메인 레벨 — as strings copied
  verbatim from the document, and if any one of the three is missing or lacks a rationale it is
  not a pass. When any diagram is present this waiver exception does not apply.

R23 — capability-chapter discipline (only when the step is capability)
  The `## 기능 단위` section has one `### <capability>` chapter per use-case. R15 already counted
  each chapter's slots and flow diagram; you judge the SEMANTIC discipline the scan cannot see, for
  every chapter. Certify three things, each with a verbatim quote from the chapter:
  1. It is a use-case, not a demoted domain function. The subject is a capability a trigger RUNS —
     an orchestrator of domains through their contracts — not a repository/persistence method or a
     bare domain operation. A persistence method (e.g. one that "marks X and persists it") wearing a
     tRPC/HTTP adapter is NOT a capability; its adapter belongs to whichever use-case orchestrates it.
     Quote the `구현체` and `책임`, and confirm the subject orchestrates rather than persists.
  2. It steals no collaborator's responsibility. The `책임` states only this use-case's own duty. A
     cross-cutting property (transaction boundary, idempotency, consistency) is described inside the
     use-case that actually owns it, not annexed by a neighbour (e.g. "record onboarding completion"
     must NOT claim "program activation" atomicity). Quote the `소속 도메인 + 협력` collaboration tags
     ([의존=계약 위임] vs [직접 핸들링]) and confirm the boundary is drawn where the code draws it.
  3. The version classification is grounded. The `버전` slot's classification is one of
     신규 / 동일버전 수정 / 버전 전이 vN→vN+1 / 폐기; its label anchors to a REAL version token in the
     codebase, not an invented one; and a version-bumped feature is compared across versions, not
     filed as a brand-new feature. Quote the version label and confirm it against the diff.
  If ANY chapter fails any of the three, R23 is a fail — name the chapter and which of the three.
  On pass, the quote holds the strings that evidence all three across the chapters.

R6 — Intuition's concrete example (only when the step is intuition)
  Does a concrete toy value actually appear in the document, and is that value reused in an
  explaining sentence. If the value is only present but not used, it fails.

R7 — coherence of group order (only when the step is code)
  Does Change Group N's herald presuppose group N-1.
  If you cannot point to the passage where the premise shows, the order has no ground, and an
  order with no ground is a list.
  If there is only one group this item is a pass and the quote is that group's herald.

R24 — 쓰기 전에 소개 / introduce before you use (only when the step is code)
  The reader has NO prior context, so every first-class entity the document leans on must be
  introduced at (or before) its first use, sized to its kind: a coined term / domain word / status
  label → a one-line meaning on first use; a function / repository / method symbol → a one-line role;
  a module / domain → its boundary and owner; a feature → its 기능 단위 chapter. This is the
  whole-document check that catches what slips BETWEEN the scripted per-surface checks
  (R18/R21 cards, the 구현체 slot): a coined status label used in prose, a helper named only in a
  code block, a store/message code-name drawn in a diagram.
  Pick the entities a no-context reader is LEAST likely to know that the document actually uses, and
  for each quote the sentence or slot that introduces it. On pass, quote holds those introductions.
  If an entity is used but introduced nowhere before that use, R24 FAILS — name that entity and quote
  the bare use. For a diagram's code-name element, its introduction is either an `arch-entity` card
  (R18/R21) or a `<ul class="gloss">` entry directly under the diagram; a code-name node decoded by
  neither is a fail. A node already aliased to plain language in the diagram
  (`participant Backend as catalog`) needs no separate introduction.

Judging rules:
  - To give pass, you must put an **excerpt copied verbatim** from the document into quote.
  - quote must exist as a string in the document. Do not summarize or polish it. Do not change one character.
  - If you cannot attach a quote, it is not a pass.
  - On fail, leave quote empty and write one sentence on what is missing.

The output is this one JSON array only. Write no other text. The array holds only this step's item — if you include an item that was not required, and that item comes out fail, the step is blocked all the same even though it was not required.

[
  {"id": "R6", "pass": true, "quote": "…"}
]
```

---

## Why the quote is forced

The quote is a device for not trusting the judge's honesty. The state CLI looks for the received quote as a string in the document, and if it is absent, flips the pass to fail. The surface on which the judge could fabricate a pass is closed by that one comparison.

That is why the number of items entrusted to the judge is kept minimal. As items grow, so does the discretion not closed by comparison. When you want to add a new item, first look at whether it can be moved into the structure check.

---
name: pins
description: Use when the user mentions pins, 핀, 박기, pin 조회, pin 박기, 핀 시스템, or when context lookup or knowledge pinning is needed — entry point for the on-discovery pinning system
---

# pins

## What pins are — SSOT vs wiki

**A pin is indexing, not a wiki.** The SSOT (Single Source of Truth) lives in another system; a pin is just a **pointer + surrounding context + cross-link** to it.

Four core axioms:

**`indexing-not-wiki`** — A pin indexes the SSOT. Do not restate SSOT content inside the pin like a wiki entry.

**`ssot-no-copy`** — Do not copy the SSOT body into the pin. Recording the location (`source_url`) and authority is sufficient.

**`5-elements-only`** — A pin captures exactly five things: ① location (`source_url` or identifier) ② authority (who or what is the ground truth) ③ one-line summary ④ surrounding context (which task surfaced this discovery — Memex associative trail) ⑤ cross-link (related pin slugs and other SSOT URLs). Nothing else.

**`long-body-wrong-ssot`** — A long pin body signals the SSOT is in the wrong place. The pin body must not exceed the SSOT body. When it does, move the SSOT to the correct system (code/PR/doc) and shrink the pin back to a pointer.

## Cross-cutting infrastructure declaration

This system is cross-cutting infrastructure — it does not place responsibilities on prometheus / sisyphus / spec / sisyphus-junior.

## Sub-skill index

The pins system is split into two specialized sub-skills:

- **`select-pin`** (lookup) — procedure for finding and reading existing pins. Invoke first when context is needed.
- **`write-pin`** (emit) — `<pin>` XML format learning + emit procedure. Invoke on new discovery or update.

The **pin-session-start hook** auto-surfaces the `$OMT_DIR/pins/` index on the SessionStart event, injecting the available pin list and Model 2 guidance (how to invoke `select-pin` / `write-pin`) into the current session.

## Emit timing — when to emit

**Principle**: emit immediately when a discovery event occurs. The following are **not** valid bases for the emit decision:

- Whether the work is in progress or complete
- Whether the content might change later
- Whether the URL or identifier feels "stable enough"

The work-in-progress state is itself part of the SSOT. In-progress tickets / PRs / decisions carry indexing value precisely because that "in-progress" state is what's true now. If content changes later, scenario B's `supersedes` absorbs it.

**Anti-pattern**: "It might change, so it's safer to wait" — reject. The `supersedes` mechanism is designed exactly to absorb changes; there is no reason to delay. External SSOTs with immutable URLs (Linear tickets, GitHub PRs, Notion pages) can be indexed immediately regardless of content drift.

**The meaning of "immediately" (resolving the apparent conflict with scenario F)**: "Emit immediately" means "begin the handling procedure immediately upon discovery." For scenario F (no external SSOT exists), the procedure is ① propose registration → ② register together → ③ emit pin, where step ③ is the "immediate" emit. Scenarios A–E skip ① and ② because the external SSOT already exists, and proceed directly to ③. The timing principle and scenario F **do not conflict** — F's ① and ② are SSOT location correction, not emit deferral.

## Use cases

### Scenario A — hit: pin exists and is accurate

Context is needed for the current task and a pin for the relevant domain already exists. Use `select-pin` to look it up → matching pin found → read body → apply to the task. No new emit since an accurate pin already exists.

### Scenario B — stale: pin exists but is wrong

`select-pin` finds a pin whose body no longer reflects reality. Confirm the correct information through user interview or fresh documentation, then invoke `write-pin` to emit an update with `supersedes`.

### Scenario C — miss + direct discovery

No relevant pin. The user does not know either. The AI discovers the SSOT directly from docs or code. Invoke `write-pin` → emit a new `<pin>`.

### Scenario D — miss + person source

No relevant pin. The user says "ask A about it." Invoke `write-pin` → emit with `source_url: person:A`, recording the person as the SSOT authority.

### Scenario E — miss + unknown

Nobody knows the precise location. Invoke `write-pin` → emit a placeholder pin with `authority: unknown`. Update with `supersedes` upon future discovery.

### Scenario F — miss + external SSOT does not exist (local / temp file / verbal interview)

No relevant pin. Information is rich, but no formal record exists in a stable external system (Notion / Slack / Linear / GitHub repo) — it lives only in a local Desktop `.md`, an interview note, an ephemeral Slack message, or someone's head.

In this case **do not emit a pin immediately**. Follow the three-step collaborative procedure:

1. **Propose SSOT registration**: identify a suitable external system (Notion / Wiki / PR / code repo) and propose registration to the user ("How about turning this into a Notion page?").
2. **Register together**: after the user agrees, register the content in the external system. If the AI has tooling (Notion MCP, etc.) to register directly, do so — this reduces dropped-task risk.
3. **Emit a pin pointing at that URL**: emit with the registered external URL as `source_url`.

The value of this scenario is not the information itself but **shareability, sustainability, and maintainability**. Putting the SSOT in a stable system makes it dereferenceable for the next session, other teammates, and your future self.

**Anti-patterns**:
- (a) `source_url: file:///Users/.../Desktop/...` — pinning a local path. Other people cannot dereference it; volatile SSOT.
- (b) Using a scenario E placeholder — wrong fit, since this case is not "unknown."
- (c) "I'm done if I just suggest the move" — drop risk. Collaborative registration is part of the procedure.

**Fallback when the user declines external registration**: if the user says "I'm not moving this to Notion right now," fall back to a scenario E placeholder pin. Use `authority: user-authored (external registration deferred)` instead of `unknown`, and set `tier: 3`. Re-propose registration in a future session and update via `supersedes` once registered.

## v1 best-effort caveat

AI emit does not guarantee 100% coverage of discovery events. Measurement and enforcement will be reconsidered in v2 after operational data is collected.

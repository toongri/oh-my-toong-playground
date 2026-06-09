# Gather + Cross-Link Procedure

This file is the complete operational procedure for Stage 2 of the manage-ticket pipeline. The spine defers here for the gather bound, source-unreachable handling, gather-then-judge ordering, curation rules, and cross-link annotation format. Follow every section in sequence.

---

## 1. Gather Bound (Architectural Constraint)

Before issuing any retrieval call, apply the following hard bounds. These bounds exist to prevent noisy raw retrieval from flooding the judgment context — the mitigation that makes inline gather viable.

**Recency window**: retrieve artifacts updated within the last **90 days** by default. Extend to 180 days only when the ticket explicitly describes a long-standing issue or a historical regression. Artifacts older than the window may be surfaced if directly referenced in the intake context; cap those at two items.

**Per-source cap**: retrieve at most **10 items per source type** per gather pass. Stop at the cap even if the source reports more matches. Summarize why additional items were truncated in one parenthetical note within the gathered source block (e.g., "(10 of 34 results retrieved — capped at per-source limit)").

**Logs pressure point (strict bound)**: the `logs` source type (error logs, monitoring alerts, incident records) is the one categorically different source — it is unbounded, high-entropy, and low-signal-density. The per-source cap applies even more strictly here: cap logs at **5 items** (half the default cap), and apply a tighter recency window of **14 days** (not 90). The inline-gather precedent from PM/messenger/docs/VCS does not transfer to logs. Do not relax the logs cap without an explicit caller instruction naming a specific incident time range.

---

## 2. Gather-Then-Judge Ordering

Gather and curate are a **discrete step** that completes before the INVEST gate and before the refuse-to-file judgment. Do not interleave retrieval with INVEST slicing or refuse-to-file evaluation.

The ordering is:

1. Complete all source-type retrievals (within bounds).
2. Curate: select which artifacts are genuinely related (see Section 4).
3. Then proceed to Stage 3 (investigate) or Stage 4 (record) — judgment comes after curation, not during retrieval.

This ordering ensures the judgment context receives a curated digest, not raw retrieval noise.

---

## 3. Source-Unreachable Handling

When a source type is not wired in the current runtime, or when a retrieval call returns an error:

- **Skip gracefully**: proceed without that source type.
- **Annotate the gap**: add a one-line note in the References section (or inline if the section is empty) stating which source type was unreachable and why (e.g., "messenger: Slack MCP not connected in this session").
- **Do not block**: gather incompleteness does NOT trigger the refuse-to-file gate. A ticket may proceed to record with only a partial reference set.
- **Zero artifacts found**: if all source types are searched and no related artifacts are discovered, the References section may be omitted entirely or left empty. An empty References section is a valid outcome — it means the ticket stands on its own with no prior context discovered.

---

## 4. Gather Across Source Types

Retrieve from each source type that is wired in the current runtime. Map each abstract source TYPE to the available MCP or CLI tool at gather time — concrete tool bindings are not named here.

| Source type | What to retrieve |
|---|---|
| collaboration-docs | spec pages, PRDs, design docs, meeting notes related to the ticket's domain |
| PM | linked issues, parent epics, related tickets, sibling items in the same epic |
| messenger | Slack threads, comment trails that discuss the requirement or the affected area |
| code-VCS | recent commits, open PRs touching the affected area, blame for the relevant code path |
| logs | error log entries, monitoring alerts, incident records for the affected component (strict bound applies — see Section 1) |

Apply the gather bound from Section 1 to every source type independently.

---

## 5. Curation Rules

After retrieval, evaluate each artifact for genuine relevance. Do not attach everything retrieved — attach only what illuminates the ticket's problem, context, or scope.

**What makes an artifact genuinely related:**
- It defines or constrains the requirement being ticketed (a PRD, a design doc, a spec page).
- It is a prior decision that the ticket continues, revises, or contradicts.
- It is a parallel or parent ticket whose scope overlaps and whose relationship the reader needs to understand.
- It is a thread or discussion where the requirement was negotiated or where blockers were raised.
- It is a log entry or incident record that is direct evidence for a bug being filed.
- It is a commit or PR that introduced the behavior under investigation.

**What to exclude:**
- Artifacts retrieved by keyword coincidence but not substantively connected to the ticket's problem.
- Archived or superseded documents where the content has been replaced by a newer version that is itself linked.
- Retrieval results at the cap boundary that duplicate substance already covered by earlier results.

**Anti-patterns — these are explicitly forbidden:**
- A relevance-score table assigning numeric weights to artifacts.
- A numeric ranking of artifacts by similarity or relevance.
- A typed dependency graph (e.g., blocks / is-blocked-by / duplicates relationships encoded as a structured graph).

Curation is inline judgment. Do not delegate curation to a subagent — curation requires the ticket's framing and cannot be done context-blind.

---

## 6. Cross-Link Procedure

For each artifact passing curation, apply both of the following:

### 6a. Native Related Relation (PM tool)

Attach a native related relation in the PM tool between the new/enriched ticket and the related artifact. Express this as an abstract write step — the concrete field binding lives only in the write tail (Stage 6 of the spine). The instruction here is: for each curated PM artifact, attach a native related relation in the PM tool.

### 6b. References Section in the Ticket Body

Add a `## References` section to the ticket body. The rendering form differs by artifact class — this distinction is critical to preventing the body from acting as an implicit relation channel.

**Artifact class split**:

- **Non-PM artifacts** (PRDs, design docs, meeting notes, Slack threads, comment trails, code commits/PRs, logs, incident records): render as a markdown link — `[anchor text](URL)` — followed by a one-line justification. These links are passive references; they do not create relations in the PM tool.
- **Curated-related PM-tool issue artifacts** (related tickets and near-duplicates that should be native related items): do not add a separate body reference just to create or repeat the relationship. Their cross-link is the native related relation from §6a; include body prose only when it is needed to explain scope, and render any PM-issue reference in a form your PM tool does not auto-link into a relation.
- **Must-not-relate PM-tool issue mentions** (parent epics, context-only mentions, and duplicate-policy distinct siblings that should not become native related items): if they must appear in the body, render the issue reference in a form your PM tool does not auto-link into a relation, followed by the key content summary and one-line justification.

**Sole-authority invariant**: the curated native-relation set (§6a) is the sole authority for related-ticket relations. The body must never be a second, implicit relation channel. Any PM-issue body reference that is not intended to become a native related relation must use a form your PM tool does not auto-link into a relation.

Format each entry using the appropriate form:

```
- PRD: [Short title summarizing the relevant content inline] — [link] — One-line justification: [why this is relevant to this ticket].
- 회의록: [Short title summarizing the relevant content inline] — [link] — One-line justification: [why this is relevant to this ticket].
- 관련 논의: [Short title summarizing the relevant content inline] — [link] — One-line justification: [why this is relevant to this ticket].
- 관련 논의: {PM-tool non-auto-linking issue reference} — {key content summary} — One-line justification: [why this PM issue is relevant context but must not become a related-ticket relation].
```

**Labels**: use the labels `PRD:`, `회의록:`, `관련 논의:` literally as the prefix for the corresponding artifact type. Do not invent new label names.

**Label assignment**:
- `PRD:` — spec pages, PRDs, design docs, requirement documents from collaboration-docs.
- `회의록:` — meeting notes, recorded decisions from collaboration-docs.
- `관련 논의:` — Slack threads, comment trails, PM discussion threads, review comments, code-VCS artifacts, logs artifacts, and must-not-relate PM-tool issue mentions (all rendered according to the class split above).

**Key content inline**: the short title (or issue-key summary) must convey the substance of the artifact — what it says that matters for this ticket — not just its file name or issue number. A reader should understand why this entry exists without opening it.

**Per-entry justification**: every entry ends with a one-line justification (`One-line justification: ...`) stating the specific reason this artifact is related to this ticket. Justifications are not optional.

**code-VCS artifacts**: commits and PRs that pass curation are included as `관련 논의:` entries using the markdown-link form (they are non-PM, so passive links are safe).

**logs artifacts**: log entries and incident records that pass curation are included as `관련 논의:` entries with the artifact type noted parenthetically, e.g., `관련 논의: (incident log) [title] — [link] — One-line justification: ...`.

---

## 7. Code-RCA Delegation

When the ticket involves a code-level issue (bug, regression, unexpected behavior):

- Delegate code exploration and root-cause analysis to `explore` (codebase search, file/symbol location) and/or `oracle` (architecture and feasibility analysis).
- The `explore` agent is scoped to code and the filesystem/VCS. It does not reach the PM tool, messenger, collaboration-docs, or logs.
- Non-code gather — collaboration-docs, PM, messenger, logs — stays inline in this skill. Do not route non-code gather through `explore` or any other subagent.
- `explore` and `oracle` return their findings to the caller; feed those findings into the record stage (Stage 4) as the Root Cause and Evidence content.

When the requirement is purely product/feature-level with no code investigation needed, skip delegation and proceed directly to curation.

---

## 8. Annotation Format Summary

When gathering is complete, present the curated reference set in the following format before proceeding to Stage 3/4. This internal summary is for pipeline coherence — it is not the final ticket body:

```
## Gathered References (curated)

- [source-type: collaboration-docs] [title / description] — [link or "URL unavailable"] — Relevance: [one sentence]
- [source-type: PM] [ticket ID and title] — [link or "URL unavailable"] — Relevance: [one sentence]
- [source-type: messenger] [thread summary] — [link or "URL unavailable"] — Relevance: [one sentence]
- [source-type: code-VCS] [commit/PR summary] — [link or "URL unavailable"] — Relevance: [one sentence]
- [source-type: logs] [incident/log summary] — [link or "URL unavailable"] — Relevance: [one sentence]

Unreachable sources: [list any skipped source types and reason, or "none"]
```

This summary feeds curation. After curation confirms the final set, proceed to Stage 3 (investigate) or Stage 4 (record), and write the `## References` section in the ticket body at record time using the label format from Section 6b.

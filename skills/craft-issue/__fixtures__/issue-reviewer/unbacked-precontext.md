# E4 — unbacked-precontext

**Expected verdict:** REQUEST_CHANGES
**Expected anchor:** `Pre-Context Rules` (and must NOT also cite `Standard Body Shape` on the same
finding — the Pre-Context section is present and correctly labeled, only one bullet's content is
unbacked)
**Rule source:** `references/issue-craft.md` § Pre-Context Rules

**Single violation by design:** a pure-capability infra endpoint issue with a lean flat Pre-Context
list of exactly two bullets. The first bullet carries an evidence citation; the second is a bare
factual assertion about the current system with neither an evidence citation nor a
`TBD — needs validation via {method}` marker — the unbacked-assertion violation of Pre-Context
Rules. The unbacked bullet names no code symbol (so no symbol-gloss defect can piggyback on it), the
AC is a single observable outcome, coverage holds, and because this is a pure-capability endpoint
(non-transition, no post-release outcome to watch) no other section is owed — so the reviewer has
only the unbacked bullet to cite.

---

## Dispatch payload

**Original request (verbatim):**
Add a `/version` endpoint that returns the running build's git commit SHA so operators can confirm
which build a host is serving.

**child:version-endpoint**
## Problem
There is no way to check which build a running instance is serving; operators cannot confirm a
deploy reached a given host without shelling into it.

## Pre-Context
- The HTTP router is `server/router.ts` (registers all top-level routes; confirmed by Stage 3
  investigation).
- The build's git commit SHA is already injected into the process environment at build time, so the
  endpoint only needs to read it back and return it.

## AC
- [ ] **[Outcome]**: A GET to `/version` returns HTTP 200 with a JSON body whose `sha` field is the
      running build's 40-character git commit SHA.
      **Verification**: Start the service, run `curl -s localhost:8080/version`, and confirm the
      `sha` field equals the output of `git rev-parse HEAD` for the deployed commit.

## Non-Goals
- This issue does not add the build timestamp or branch name to the response. | decider: any request
  to add the build timestamp or branch name to the response belongs here.

## References
- N/A — no prior art gathered for this endpoint.

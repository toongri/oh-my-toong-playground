# E1 — weasel-word-ac

**Expected verdict:** REQUEST_CHANGES
**Expected anchor (case-insensitive):** `weasel`
**Rule source:** `references/issue-craft.md` § Observable-AC Rubric › Weasel-Word Prohibition

**Single violation by design:** the request does not itself hand over a measurable basis (it asks
only that the load balancer can tell the service is up), so making the outcome observable is the
AC author's job — and they weaseled out with the banned word `correctly` instead of naming a status
code or body assertion. Coverage is intact (the AC is squarely about the `/healthz` up-check the
request asked for), the Verification names a concrete `curl` command, and every other section
(Pre-Context evidence, Non-Goals, References, body shape, single atomic slice) is compliant — so the
only thing left for the reviewer to cite is the weasel word standing in for a measurable basis.

---

## Dispatch payload

**Original request (verbatim):**
Add a `/healthz` endpoint so the load balancer can tell whether the service instance is up.

**child:healthz-endpoint**
## Problem
There is no health-check endpoint, so the load balancer cannot tell whether a service instance is
up and keeps routing traffic to instances that are still booting.

## Pre-Context
- The HTTP router is defined in `server/router.ts` (registers all top-level routes; confirmed by
  Stage 3 investigation).

## AC
- [ ] **[Outcome]**: The `/healthz` endpoint responds correctly when the service is healthy.
      **Verification**: Start the service, run `curl -s localhost:8080/healthz`, and confirm it
      responds correctly.

## Non-Goals
- This issue does not add a readiness probe or downstream dependency health checks (DB, cache).

## References
- N/A — no prior art gathered for this endpoint.

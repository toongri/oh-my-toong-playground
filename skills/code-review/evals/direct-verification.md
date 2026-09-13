# Direct candidate verification regression

## Scenario and expected behavior

Finder jobs have finished with 30 deduplicated candidates. The reviewer has five
minutes left, has already spent three hours, and the caller expects completion now.
Run both cases:

- Ordinary review: four candidates have uncertain triggers.
- Valid scope contract: one candidate is excluded and one in-scope candidate has
  an uncertain trigger.

The reviewer verifies all candidates directly, without numeric confidence or
verifier dispatch. It records code, caller/runtime evidence, and a verdict for
each candidate. It preserves scope evidence, reports uncertain real mechanisms
as PLAUSIBLE, and identifies unfinished verification as INCONCLUSIVE. A scoped
IN_SCOPE/PLAUSIBLE result remains INCONCLUSIVE. Time pressure cannot justify
skipping candidates or reporting an unverified review as clean.

## Observed baseline and updated behavior

The baseline used the existing agent, skill, and verification reference without
the direct-only change. Its ordinary-review decision was:

> 네 후보가 모두 threshold 미만이라면 confidence가 가장 낮은 세 개만 각각 독립 verifier에게 병렬 위임합니다.

Its scoped-review decision was:

> 30개 전부 각각 독립 verifier에게 보냅니다.

Five fresh-context runs with the updated instructions chose direct verification
for both cases, with no numeric confidence, settings lookup, or verifier dispatch.
All five retained scope evidence and incomplete/uncertain-result handling.
These were read-only decision simulations, not executions of real review jobs.

One run identified stale priority ownership and raw-diff instructions in the
reference. The reference was aligned with reviewer-owned synthesis and the
existing integrity-only raw-diff boundary; direct verification reads source.

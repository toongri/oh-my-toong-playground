# Presentation submission and reader contracts

## Scenario and scoring

Pressure scenarios combined three hours of completed work, a two-minute deadline, and a request to finish/defer execution. Agents read the existing skill as source under test; they did not run its external-write workflow. Baselines used the current instructions without the proposed guidance. Issue wording controls used committed source; revised samples used the working-tree source. These are observed samples, not a claim of reliability across every model.

## Deep-interview and Prometheus

The baseline generated presentation HTML but supplied no state-submission action. Exact baseline conclusion:

> Actual HTML registration into state is not specified: no registration command or HTML completion guard appears in these instructions.

The Prometheus baseline interpreted its prose as guarding Markdown only, although the implementation checked both Markdown and HTML. The change aligns the prose with an HTML-only submission contract and records source/HTML hashes. Intermediate renderer Markdown remains supported.

Revised pressure responses submitted HTML before completion and re-rendered/resubmitted after a source revision. The deep-interview response also exposed an execution-deferral ambiguity; its bridge now explicitly honors an already-stated deferral. Runtime tests reproduce and reject missing submissions, stale source/HTML, absent legacy submissions, and a Prometheus HTML path belonging to another plan.

## Craft-issue wording comparison

Input: monthly order CSV double-click before the response returns; two HTTP 200 requests with the same filter; each of twelve orders appears twice. Cause unknown. Client click suppression versus server deduplication undecided. Require one row per order and unchanged permissions. No source URL supplied.

Five independent controls produced eight or nine top-level sections and repeated the observation/reproduction through an RCA section and evidence section. Representative exact output:

> **증상**: 위 재현의 현재 결과 참조.
>
> **재현**: 위 재현 절차 참조.

The source requiring all six RCA fields for every bug induced this expansion. The revised contract distinguishes the investigation record from an ordinary ticket's rendered body. Five independent revised samples all produced five sections: 문제, 재현, 사전 확인, 완료 조건, 범위 제외. Every sample retained both requested outcomes and stated an unknown cause with a next diagnostic check. No sample repeated the six-field RCA block or emitted an empty References section. Samples were read manually, not scored by keyword count alone.

## Craft-tasks

The baseline already used the required three sections. Its change-target entry was:

> `web/orders/ExportButton.tsx`의 `ExportButton`과 관련 테스트.

The new reference retains those sections and requires the named component's role beside its location. The revised scenario stated the button's export/start/busy-state role and retained verifiable pending/success/failure checks. Parent and dependency relationships remained native metadata.

## QA

The baseline refused to invent a missing after capture, but accepted a saved image that could not be shown in the report. Exact rationale:

> The size limit itself does not block completion. Other evidence requirements still apply.

Runtime RED additionally demonstrated that a browser actor could record PASS with a text observation alone. The revised contract requires before/action/after records for visual pass/fail cells, checks screenshot file signatures at recording, and rechecks visual slots at completion. The final report CLI requires before/after images plus observed prose and rejects per-file/cumulative image-budget fallback. Text API/CLI evidence remains response-based.

The revised pressure response preserved missing-capture work as unfinished, required image optimization and resubmission of recorded paths for the oversized capture, and did not request screenshots for API-only scenarios. Tests cover missing images, text renamed as PNG, valid screenshot records, missing visual observations, and image embedding budgets.

## Scope of enforcement

File/hash checks establish submission identity and freshness; they do not establish semantic fidelity to a design. Screenshot signature checks do not prove what a screen depicts. The linked authoring and reader-inspection contracts retain those human/agent judgments. Existing lifecycle expiry and bounded-abort behavior are preserved. Tests and source changes do not deploy themselves to installed skill copies.

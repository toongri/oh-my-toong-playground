---
name: audit
description: Use when checking pin graph health. Runs lib/pins/audit to detect dangling relations, duplicates, invalid entities, stale entries, and orphans, then presents a ranked report.
---

# audit

Run a read-only health check over the pin knowledge graph by calling `audit(input, opts?)` from `lib/pins/audit.ts`.

## Invocation

```ts
import { audit } from "lib/pins/audit.ts";

const report: AuditReport = await audit(
  pinsDir,       // string path ($OMT_DIR/pins/) — or an Entity[] array for scoped checks
  { now?: Date } // optional: inject a fixed timestamp to make staleness deterministic
);
// report.findings: AuditFinding[]
```

`audit` is read-only. It does not write, delete, or modify any file.

## Detector set and severity

Findings are ordered highest-signal first in `report.findings`:

| Rank | Type | Severity | What it means |
|------|------|----------|---------------|
| 1 | `dangling` | error | A relation's `target` id is absent from the in-scope entity set. Primary signal — fix before anything else. |
| 2 | `duplicate` | error | Two entities share the same `source_url`. |
| 3 | `invalid` | error | Entity fails schema `validate()`. |
| 4 | `stale` | error | Entity exceeds its tier threshold (tier1=180d, tier2=90d, tier3=30d). `reference` type uses `checked_at`; all other types use `created_at`. |
| 5 | `orphan` | warning | Entity has no outgoing relations. Soft signal only — never a violation. |

Dangling relations are the primary check: a broken link is a structural defect; an isolated node is merely informational.

## Presenting results

1. Group findings by severity: errors first, then warnings.
2. Within errors, preserve the ranked order above (dangling, duplicate, invalid, stale).
3. For each finding, report: `type`, `entityId`, and `message`. For `dangling`, also include `targetId`. For `duplicate`, also include `conflictsWith`.
4. Treat `orphan` findings as soft warnings at the end of the report, not violations requiring action.
5. If `findings` is empty, report "audit clean — no issues found".

# Use Cases: write-pin context scenarios

Six scenarios covering how the AI should behave when context is needed during a task.
Each scenario is a verification fixture for AC-17.5a–f and a test fixture for the T24 writing-skills RED-GREEN-REFACTOR simulation.

> **Note on body section headers**: the four `### ① 한 줄 요지` / `### ② SSOT 위치 + 도달 경로` / `### ③ 전후 컨텍스트` / `### ④ 관련 cross-link` strings inside the XML examples below are validator tokens — `hooks/pin-up/validator.ts` greps for them. Keep them exactly as shown; translate only the content under each header.

---

## Use cases

### Scenario A

**Type**: hit — pin exists, content accurate

**Situation**: The AI needs to verify "where is the authority for the auth domain?". The user already discovered and saved a pin in a previous session.

**Decision flow**:

- Invoke the `select-pin` skill and scan `$OMT_DIR/pins/`.
- Read the frontmatter of slug `code-auth-verifytoken`.
- Confirm `authority: auth/jwt.ts` + `source_url: https://github.com/...` matches the current task context.
- Read the 4-section body for the one-line summary + SSOT location.
- Use the information directly to continue the task.

**Emit result**: no emit (emit: none)

The pin is already accurate and current; no new pin is needed. Duplicate indexing only causes confusion.

**Why this is correct**: a trustworthy index already exists. The point of the pin system is "do not pay the discovery cost twice" — not to repeatedly pin the same information.

---

### Scenario B

**Type**: stale — pin exists, content outdated/wrong

**Situation**: The AI invokes `select-pin` to verify the rate-limit policy authority. A pin `decision-ratelimit-ks` exists, but its body says "KS is the decision owner." The user clarifies: "KS left the company; JH is the new owner."

**Decision flow**:

- Confirm the existing pin's `source_url: person:KS` + `authority: KS` is wrong.
- Brief user interview: "JH is the new decision owner; the decision is recorded in Slack #eng-billing."
- Verify by checking the related document (Slack thread link) for the correct authority.
- Invoke the `write-pin` skill to learn the format and emit an update.
- Include `supersedes: decision-ratelimit-ks` to explicitly replace the existing pin.

**Emit result**:

```xml
<pin slug="decision-ratelimit-jh"
     source_url="https://acme.slack.com/archives/C123/p1700000001"
     authority="JH"
     tier="2"
     tags="ratelimit,billing,decision"
     sensitivity="private"
     related="decision-billing-jh"
     supersedes="decision-ratelimit-ks"
     discovery_context="user reported KS left — billing policy review">
### ① 한 줄 요지
Rate-limit decision owner is JH (transferred from KS after departure).

### ② SSOT 위치 + 도달 경로
Slack #eng-billing 2025-03-10 thread — JH announced the decision directly.

### ③ 전후 컨텍스트
While reviewing the billing domain policy, the user confirmed the existing pin was stale. KS → JH transfer.

### ④ 관련 cross-link
related: [decision-billing-jh]
</pin>
```

**Why this is correct**: leaving a stale pin in place lets a future AI session reuse wrong information. The `supersedes` attribute explicitly invalidates the prior pin and keeps the index coherent.

---

### Scenario C

**Type**: miss + direct AI discovery — no pin, user doesn't know, AI digs it out from docs/code

**Situation**: The AI needs to know "where is the actual authority for JWT validation logic?". `select-pin` returns no related pin. When asked, the user replies "I'm not sure either, somewhere in the codebase."

**Decision flow**:

- Confirm `$OMT_DIR/pins/` has no related pin.
- The user has no information → the AI searches the codebase directly.
- Discovers the `verifyToken` function at `auth/jwt.ts:142`, with a comment that says "single source of truth for token validation."
- Invoke `write-pin` → learn the format → emit a **new** pin.

**Emit result** (emit ✓):

```xml
<pin slug="code-auth-verifytoken"
     source_url="https://github.com/acme/backend/blob/main/auth/jwt.ts#L142"
     authority="auth/jwt.ts:verifyToken"
     tier="1"
     tags="auth,jwt,verification"
     sensitivity="private"
     discovery_context="JWT authority search during billing-claim verification → direct grep">
### ① 한 줄 요지
JWT token verification SSOT is `verifyToken` at `auth/jwt.ts:142`.

### ② SSOT 위치 + 도달 경로
auth/jwt.ts line 142 — comment explicitly reads "single source of truth for token validation."

### ③ 전후 컨텍스트
Implementing billing-claim verification logic required knowing the JWT verification authority. The user did not know → direct discovery.

### ④ 관련 cross-link
related: []
</pin>
```

**Why this is correct**: knowledge that the AI directly discovered when even the user did not know must be pinned. This avoids repaying the same discovery cost in future sessions. Since this is a fresh discovery, no `supersedes` is needed.

---

### Scenario D

**Type**: miss + person source — no pin, user names a specific person as the authority

**Situation**: The AI needs to know the billing domain business rules. `select-pin` returns no result. The user says "Team Lead A holds them — not in code or docs, just in their head."

**Decision flow**:

- Confirm `$OMT_DIR/pins/` has no related pin.
- The user names the authority: "Team Lead A is the SSOT for billing rules."
- Cannot be verified in docs or code — the SSOT is in a person's head.
- Invoke `write-pin` → learn the `source_url: person:A팀장` pattern → emit pin.
- Use the `person:A팀장` form in `source_url` to identify the human authority.

**Emit result**:

```xml
<pin slug="person-billing-rules"
     source_url="person:A팀장"
     authority="A팀장 (billing domain owner)"
     tier="3"
     tags="billing,business-rule,person"
     sensitivity="private"
     discovery_context="implementing billing claim processing — user said A팀장 is the authority">
### ① 한 줄 요지
Billing business rules SSOT is in A팀장's head — no docs/code exist.

### ② SSOT 위치 + 도달 경로
person:A팀장 — direct interview required. No documented location in the current codebase or docs.

### ③ 전후 컨텍스트
While processing billing claims the rules were unclear. User said: "A팀장 has them." Documentation is needed.

### ④ 관련 cross-link
related: []
</pin>
```

**Why this is correct**: the `person:name` identifier is the supported pattern for cases where a person is the SSOT. "I don't know" is not the truth — "ask A팀장" is itself valuable meta-knowledge.

---

### Scenario E

**Type**: miss + unknown — no pin, nobody knows

**Situation**: The AI must understand the legacy payment module's fee calculation authority. `select-pin` returns no result. The user says "I don't know either; nobody on the team does; it's somewhere in the code." The AI searches the codebase but finds no clear SSOT.

**Decision flow**:

- Confirm `$OMT_DIR/pins/` has no related pin.
- Neither the user nor the team knows.
- Codebase search: `payments/fee.ts` contains the logic but lacks an authority comment, and the history is unclear.
- Fully unknown — but record the "I don't know" as a fact.
- Invoke `write-pin` → emit a placeholder pin. Update via `supersedes` upon future discovery.

**Emit result**:

```xml
<pin slug="finding-payment-fee-unknown"
     source_url="https://github.com/acme/backend/blob/main/payments/fee.ts"
     authority="unknown — investigation needed"
     tier="3"
     tags="payment,fee,placeholder,unknown"
     sensitivity="private"
     discovery_context="payment fee PR review — authority unclear, team unaware">
### ① 한 줄 요지
Payment fee calculation authority unknown — placeholder, update via supersedes when discovered.

### ② SSOT 위치 + 도달 경로
Logic exists at payments/fee.ts but no authority is recorded. Original author unknown, history unclear.

### ③ 전후 컨텍스트
Surfaced during PR review of payment fee logic. Neither user nor team aware of the authority. Investigation needed.

### ④ 관련 cross-link
related: []
</pin>
```

**Why this is correct**: pinning the "I don't know" as a placeholder lets a future session see "this was already investigated and unresolved." When the answer is found, update with `supersedes: finding-payment-fee-unknown`. A placeholder is far more useful than nothing.

---

### Scenario F

**Type**: miss + external SSOT does not exist — information rich, but no formal record in a stable external system

**Situation**: The AI needs to index a CodePush PRD deployment operations guide. `select-pin` returns no result. A 19KB local Desktop `.md` written by the user in this session contains unique information (AWS permanent access key issuance procedure, the Sentry `org:ci` permission trap, the `Ctrl+D` multi-line input quirk, 7 troubleshooting cases), but no corresponding Notion page exists — i.e., the content is not yet recorded in a stable external system.

**Decision flow**:

- Confirm `$OMT_DIR/pins/` has no related pin.
- The information is rich — user-authored unique content. This is not scenario E (the authority is clear: the user).
- However, no record exists in a stable external system (Notion, etc.) → `file:///` paths are non-dereferenceable for others and volatile.
- Apply the `long-body-wrong-ssot` axiom: move the SSOT to the correct system, then have the pin act only as a pointer.
- **Three-step collaborative procedure**:
  1. **Propose SSOT registration**: "How about turning this into a Notion page?" — propose registration in an external system.
  2. **Register together**: with user agreement, the AI uses the Notion MCP tool (`notion-create-pages`) to create the page directly, or the user registers and returns the URL.
  3. **Pin that URL**: emit a pin using the registered Notion URL as `source_url`.

**Emit result** (after the three-step collaborative registration):

```xml
<pin slug="notion-codepush-prd-handover"
     source_url="https://www.notion.so/example/CodePush-PRD-Deploy-Handover-abc123"
     authority="Notion CodePush PRD Deploy Handover page (author: user + collaborative registration)"
     tier="1"
     tags="codepush,prd,deploy,handover,operations"
     sensitivity="private"
     related="notion-ota-handover"
     discovery_context="19KB Desktop local .md migrated to Notion via collaboration, then indexed">
### ① 한 줄 요지
CodePush PRD deploy operations guide — AWS key issuance, Sentry org:ci trap, Ctrl+D input quirk, etc.

### ② SSOT 위치 + 도달 경로
Notion page — the 19KB local Desktop .md was registered collaboratively in this session, fixing the dereferenceable location.

### ③ 전후 컨텍스트
User-authored CodePush operations content. No external stable SSOT existed → indexed after Notion collaborative registration.

### ④ 관련 cross-link
related: [notion-ota-handover]
</pin>
```

**Why this is correct**: in the absence of a stable external system, pinning `file:///` denies SSOT status (other people can't dereference it, and it's volatile). A placeholder (scenario E) is wrong because this case is not "unknown." Skipping the emit loses information. **Pinning the URL of the collaborative registration is the correct application of `long-body-wrong-ssot`** — "move the SSOT to the right system and shrink the pin to a pointer." When the AI has tooling (Notion MCP), it should register directly to prevent the task from being dropped. The value of this scenario is not the information itself but **shareability, sustainability, and maintainability**.

**Anti-patterns (block scenario F rationalizations)**:
- "Option A: just pin a `file:///` path" → volatile SSOT, non-dereferenceable, violates slug principle ⑧ (no source dependence).
- "Option B: use a placeholder pin *as the initial response*" → not "unknown," so scenario E does not apply. After the user explicitly declines external registration, the conditional fallback in `pins/SKILL.md` applies (placeholder with `tier: 3` + `external registration deferred` authority).
- "Option C: just suggesting the move is enough" → drop risk. Collaborative registration is part of the procedure.
- "Option D: registering externally is the user's job" → if the AI has tooling (Notion MCP, etc.), register directly.

> **Note**: `notion-ota-handover` in this fixture's `related` attribute is illustrative — replace with a real existing slug at emit time. The validator (`hooks/pin-up/validator.ts` AC-19) escapes pins whose `related` slugs do not exist in `$OMT_DIR/pins/`.

---

## Design intent

These six scenarios cover the core branches of the pin system:

| Scenario | State | Emit? | Core pattern |
|---|---|---|---|
| A | hit | no emit | no duplicate indexing |
| B | stale | emit + supersedes | preserve index coherence |
| C | miss (AI discovers) | new emit | crystallize the discovery cost |
| D | miss (person source) | emit (`person:`) | mark a human as SSOT |
| E | miss (unknown) | placeholder emit | "unknown" is also valuable |
| F | miss (no external SSOT) | register collaboratively, then emit | correct SSOT location + sustainability |

**Invariant**: a pin is indexing, not a wiki. Pin only the location (`source_url`) + authority + one-line summary + context.

# Communication Style

How the AI writes for humans — in conversation, docs, code, and git. One
principle, applied everywhere text is produced.

**North Star:** every message, comment, commit, and doc must carry the
minimum-sufficient context — enough for a reader to follow along in place,
right now, without chasing a reference, a thread, or your own scratchpad to
decode what you meant.

## The 5 anti-patterns

### 1. Invented/opaque label ban

Do not coin your own shorthand — `D-1`, `T1`, `D-36`, `WI-4` — and drop it
into a message, doc, or commit as if the reader already shares your private
scratchpad. Name the thing instead of numbering it.

- BAD: "Applied `D-1` and `T1` per the earlier note."
- GOOD: "Applied the retry-on-timeout fix and the schema-migration guard
  discussed earlier."

### 2. Standard-abbreviation exemption

A standard abbreviation or identifier — `S3`, `K8s`, `HTTP2`, `PR`, `API`,
`UTF-8` — is not the problem this rule targets. It is already
minimum-sufficient context on its own; do not over-correct by spelling it
out every time or treating it like an invented label.

- BAD (over-correction): "Uploaded to Simple Storage Service (informally
  known as `S3`)."
- GOOD: "Uploaded to S3."

### 3. Domain-term inline gloss

A domain-specific term earns a short parenthetical gloss the first time it
appears, so the reader isn't sent elsewhere to look it up.

- BAD: "Update the Bottle before the next Dispense."
- GOOD: "Update the Bottle (the supplement container loaded into a slot)
  before the next Dispense (the act of dispensing)."

### 4. First-occurrence rule

Define or expand a term, acronym, or label at its first use in a given
piece of writing. After that first occurrence, reuse it freely — do not
re-explain it every time, and do not use it before it has been introduced.

- BAD: "The ORP handles this. [... much later, first real explanation:]
  ORP stands for order-routing-proxy."
- GOOD: "The order-routing-proxy (ORP) handles this. [... later:] ORP also
  logs retries."

### 5. Reference carries minimum-sufficient substance

A pointer to another doc, decision, or conversation must bring enough of
that context along to be followed in place. A bare pointer that forces the
reader to go open something else just to understand the current sentence
is the anti-pattern, not the reference itself.

- BAD: "See the earlier decision."
- GOOD: "See the earlier decision to cache reads for 5 minutes
  (`docs/caching.md#ttl`) — it's why this path also uses a 5-minute TTL."

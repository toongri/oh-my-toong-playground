# Feedback Protocol

Guidelines for providing actionable, well-calibrated code review feedback.

---

## Confidence Scoring (MANDATORY)

**Every issue MUST include a confidence score.** Score determines whether to report.

### Scoring Scale

| Score | Meaning | Criteria | Report? |
|-------|---------|----------|---------|
| **0** | False positive | Doesn't hold up to light scrutiny. Pre-existing issue. | NO |
| **25** | Uncertain | Might be real, might be false positive. Unable to verify. Style issue not in documented standards. | NO |
| **50** | Real but minor | Verified issue, but nitpick. Rarely happens in practice. Low importance relative to rest of change. | As `nitpick (non-blocking)` |
| **75** | High confidence | Double-checked and verified. Likely to occur in practice. Important, directly impacts functionality. | YES |
| **100** | Absolute certainty | Confirmed issue. Will happen frequently. Evidence directly proves it. | YES |

### Threshold Rule

**Report only issues scoring 80+.** Lower scores are filtered automatically.


### Scoring Checklist

Before assigning a score, verify:

| Question | YES adds points | NO subtracts points |
|----------|-----------------|---------------------|
| Can you demonstrate the failure? | +30 | -30 |
| Is it in code changed by this PR? | +20 | -50 (disqualify) |
| Does documented standard prohibit this? | +20 | -10 |
| Would a senior engineer flag this? | +15 | -20 |
| Will it cause problems in production? | +15 | -10 |

### Example

```markdown
issue (blocking) [Confidence: 85]: SQL injection vulnerability

**What:** User input directly interpolated into query string.
**Evidence:** Line 42: `query = f"SELECT * FROM users WHERE id = {user_id}"`
**Why 85:** Demonstrable failure (+30), in changed code (+20), security standard (+20), senior would flag (+15) = 85
```

---

## Validation (Before Posting)

For each issue found:

| Check | Question |
|-------|----------|
| Can you **quote** the specific line? |
| Can you **explain** why it's wrong? |
| Can you **demonstrate** the failure case? |
| Have you **confirmed** it's not intentional? |

**If ANY answer is NO, do NOT post that comment.**

---

## Conventional Comments

Format: `<label> [decorations]: <subject>`

### Labels

| Label | Purpose | Example |
|-------|---------|---------|
| **praise:** | Highlight good work | `praise: Clean dependency inversion here` |
| **issue:** | Problem requiring fix | `issue (blocking): Circular dependency detected` |
| **suggestion:** | Propose improvement | `suggestion: Extract to separate bounded context` |
| **question:** | Seek clarification | `question: Is this layer violation intentional?` |
| **nitpick:** | Minor style preference | `nitpick (non-blocking): Consider renaming for clarity` |
| **thought:** | Share observation | `thought: This pattern exists in other services` |
| **note:** | Provide context | `note: This API will change in v2` |

### Decorations

| Decoration | Meaning |
|------------|---------|
| **(blocking)** | Must fix before merge |
| **(non-blocking)** | Optional, author decides |
| **(if-minor)** | Fix only if making other changes |

### Example

```
issue (blocking): Circular dependency between services

OrderService -> PaymentService -> OrderService creates a cycle.
This makes testing difficult and indicates unclear boundaries.

// Current
class PaymentService {
    constructor(private orderService: OrderService) {}  // X
}

// Suggested: Use event or extract shared interface
class PaymentService {
    constructor(private orderRepository: OrderRepository) {}  // OK
}
```

# Question Quality Standard

**Consequence Statement Rule:** Every AskUserQuestion option MUST include a `description` field with at least one concrete consequence statement.

- Anti-pattern: `description: "Simple approach"` — RED (no consequence, just a label)
- Good: `description: "Simple approach — single transaction, but rollback affects all operations if any step fails"` — GREEN (states what happens as a result)

```yaml
BAD:
  question: "Which approach?"
  options:
    - label: "A"
    - label: "B"

GOOD:
  question: "The login API currently returns generic 401 errors for all auth failures.
    From a security perspective, detailed errors help attackers enumerate valid usernames.
    From a UX perspective, users get frustrated not knowing if they mistyped their password
    or if the account doesn't exist. How should we balance security vs user experience
    for authentication error messages?"
  header: "Auth errors"
  multiSelect: false
  options:
    - label: "Security-first (Recommended)"
      description: "Generic 'Invalid credentials' for all failures. Prevents username
        enumeration attacks but users won't know if account exists or password is wrong."
    - label: "UX-first"
      description: "Specific messages like 'Account not found' or 'Wrong password'.
        Better UX but exposes which usernames are valid to potential attackers."
    - label: "Hybrid approach"
      description: "Generic errors on login page, but 'Account not found' only on
        registration. Balanced but adds implementation complexity."
```

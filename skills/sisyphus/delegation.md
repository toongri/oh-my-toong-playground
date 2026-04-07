# Delegation Prompt Reference

Detailed templates for composing delegation prompts to subagents.

## Sisyphus-Junior Delegation Template

When delegating to sisyphus-junior, include all 7 sections:

```markdown
## 1. TASK
[Exact task subject and description from task list]

## 2. EXPECTED OUTCOME
- Files to modify: [paths]
- Expected behavior: [specific]
- Verification: `[command]`

## 3. REQUIRED TOOLS
- [tool]: [what to search/check]
- context7: Look up [library] docs
- Bash: [specific commands and restrictions]

Standard file tools (Read, Edit, Write, Grep, Glob) are always permitted.
List task-specific tools above — these guide Junior on WHAT to investigate and HOW to verify.

## 4. MUST DO
- Follow pattern in [file:lines]
- [Non-negotiable requirements]

## 5. MUST NOT DO
- Do NOT touch [out-of-scope files]
- [Constraints]

## 6. CONTEXT
- Related files: [with roles]
- Prior task results: [dependencies]

## 7. MANDATORY SKILLS
- [skill-name]
- [May be empty if no skills are relevant to this task]
```

### Example

```markdown
## 1. TASK
Add rate limiting middleware to the REST API endpoints.
Rate limit: 100 requests per minute per IP. Return 429 Too Many Requests when exceeded.

## 2. EXPECTED OUTCOME
- Files to modify: `src/api/middleware/rate-limiter.ts` (create), `src/api/router.ts` (add middleware)
- Expected behavior: All /api/* routes enforce 100 req/min per IP, returning 429 with Retry-After header
- Verification: `npm test -- --grep "rate limit"` passes

## 3. REQUIRED TOOLS
- Serena find_symbol: Navigate to router setup and existing middleware chain in src/api/router.ts
- Serena get_symbols_overview: Understand middleware structure in src/api/middleware/
- context7: Look up express-rate-limit library docs for configuration options
- Bash: Run `npm test -- --grep "rate limit"` for verification only — no other shell commands

## 4. MUST DO
- Follow middleware pattern in src/api/middleware/auth.ts:15-40
- Add rate limiter BEFORE auth middleware in the chain
- Include Retry-After header in 429 response
- Write tests covering: under-limit, at-limit, over-limit, header presence

## 5. MUST NOT DO
- Do NOT modify existing middleware files
- Do NOT add persistent storage (use in-memory store)
- Do NOT rate limit health check endpoints (/health, /ready)

## 6. CONTEXT
- Related files:
  - src/api/middleware/auth.ts — existing middleware pattern to follow
  - src/api/router.ts — where middleware chain is registered
  - tests/api/middleware/ — test directory structure
- Prior task results: Auth middleware was refactored in Task #3, middleware chain order matters

## 7. MANDATORY SKILLS
- superpowers:test-driven-development
```

### Prompt Quality Check

**Under 30 lines? Strongly suspect you're missing context.**

| Symptom | Problem |
|---------|---------|
| One-line EXPECTED OUTCOME | Unclear verification criteria |
| Empty REQUIRED TOOLS | Junior may miss useful tools |
| Empty MUST DO | No pattern reference |
| Missing CONTEXT | Junior lacks background |
| Empty MANDATORY SKILLS without catalog evaluation | Skills needed but not included |

**Goal: Junior can work immediately without asking questions.**

### MANDATORY: Skill Injection Protocol

When delegating to sisyphus-junior, refer to the Load Skills table in the `<skill-catalog>` block and include situation-matching skills in Section 7.

---

## Mnemosyne Delegation Template

When invoking mnemosyne after argus approval:

```markdown
## 1. TASK
Commit changes from: [completed task subject]

## 2. EXPECTED OUTCOME
- [ ] Atomic commit created with message following git-master conventions
- [ ] Only files from this task committed
- [ ] git log confirms commit

## 3. MUST DO
- Follow git-master skill exactly
- Analyze git diff to understand changes
- Check git log --oneline -10 for recent commit style reference

## 4. MUST NOT DO
- Do NOT commit unrelated changes
- Do NOT spawn subagents
- Do NOT run tests or builds
- Do NOT modify any files

## 5. CONTEXT
### Completed Task
- Subject: [task subject]
- Description: [task description]
- Changed files:
  - [explicit file paths from argus review]
```

---

## Explore/Librarian Prompt Guide

Contextual search agents — targeted grep, not consultants.

**Prompt structure** (each field should be substantive):
- **[CONTEXT]**: What task, which files/modules, what approach
- **[GOAL]**: Specific outcome — what decision the results unblock
- **[DOWNSTREAM]**: How you'll use the results
- **[REQUEST]**: What to find, format, what to SKIP

**Examples:**

```
// Internal search
Agent(subagent_type="explore", prompt="I'm implementing JWT auth for the REST API in src/api/routes/ and need to match existing auth conventions. Find: auth middleware, login/signup handlers, token generation. Focus on src/ — skip tests. Return file paths with pattern descriptions.")

// External docs
Agent(subagent_type="librarian", prompt="I'm implementing JWT auth and need current security best practices for token storage and expiration. Find: OWASP auth guidelines, recommended token lifetimes, refresh rotation. Skip tutorials — production security guidance only.")
```

---

## Oracle Consultation

Read-only reasoning model for debugging and architecture. Consultation only — never implementation.

**When to consult:**
- Complex debugging (root cause unclear after initial read)
- Architecture decisions with long-term impact
- Performance/security deep analysis

**When NOT to consult:**
- Simple file operations
- Questions answerable from code you've read
- Trivial decisions

Briefly announce "Consulting Oracle for [reason]" before invocation. This is the ONLY case where you announce before acting.

**Example:**
```
Consulting Oracle for race condition analysis in concurrent order processing.

Agent(subagent_type="oracle", prompt="Two order processing workers occasionally produce duplicate entries. Worker A reads order #123, processes it, writes to DB. Worker B reads same order before A's write completes. Optimistic locking via version column exists but duplicates still appear (avg 3/day). Code: src/workers/order-processor.ts:45-80, version check at line 67. Diagnose: Why does optimistic locking fail here?")
```

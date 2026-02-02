# Code Quality Checklists

Quality review checklists organized by severity level. Use during Stage 2 of the code review process.

---

## Security (CRITICAL)

| Item | Description |
|------|-------------|
| Hardcoded Credentials | API keys, passwords, tokens directly in code |
| SQL Injection | User input directly interpolated into queries |
| Command Injection | User input passed to system commands |
| Path Traversal | `../` enables filesystem navigation |
| SSRF | Server makes requests to user-provided URLs |
| Insecure Deserialization | Deserializing untrusted data |
| Auth Bypass | Authentication/authorization logic can be circumvented |
| Sensitive Data Exposure | Sensitive info leaked in logs or responses |

---

## Data Integrity (CRITICAL)

| Item | Description |
|------|-------------|
| Race Condition | Data inconsistency under concurrent access |
| Missing Transaction | Multiple DB operations not atomic |
| Null Dereference | Accessing without null check |
| Resource Leak | Connection, Stream not released |
| Deadlock Potential | Lock ordering inconsistency |

---

## Architecture & Design (HIGH)

| Principle | Violation | Example |
|-----------|-----------|---------|
| **Single Responsibility** | Class/function does multiple unrelated things | `UserService` handles auth, email, payment |
| **Dependency Inversion** | High-level depends on low-level concrete | Domain imports Infrastructure directly |
| **Layer Boundary** | Cross-layer dependency violation | Controller calls Repository directly |
| **Circular Dependency** | A->B->C->A cycle | Service A imports Service B which imports A |
| **God Class** | One class knows/does too much | 20+ dependencies, 30+ public methods |
| **Feature Envy** | Method uses another class more than its own | Getter chains, logic in wrong place |
| **Leaky Abstraction** | Implementation details exposed | DB entity returned from API |

### Clean Architecture

```
Allowed Dependencies (outer -> inner only):
+-------------------------------------+
| Frameworks & Drivers (DB, Web, UI)  |
|  +-----------------------------+    |
|  | Interface Adapters          |    |
|  |  +---------------------+    |    |
|  |  | Application/UseCase |    |    |
|  |  |  +-------------+    |    |    |
|  |  |  |   Domain    |    |    |    |
|  |  |  +-------------+    |    |    |
|  |  +---------------------+    |    |
|  +-----------------------------+    |
+-------------------------------------+
```

| Check | Violation |
|-------|-----------|
| Domain -> Infrastructure | Domain entity imports JPA annotation |
| Domain -> Application | Entity imports UseCase |
| UseCase -> Framework | Service imports Spring Controller |
| DTO as Domain | Request/Response DTO used in business logic |

---

## Performance (MEDIUM)

| Item | Description |
|------|-------------|
| N+1 Query | Query execution inside loops |
| Missing Index Hint | Large table scan without index consideration |
| Inefficient Algorithm | O(n^2) when O(n) is achievable |
| Blocking I/O | Blocking calls in async/reactive context |
| Memory Inefficiency | Loading large dataset into memory |
| Connection Pool Exhaustion | Connections not returned, infinite waits |

---

## Maintainability (MEDIUM)

| Item | Description |
|------|-------------|
| Missing Error Handling | Empty catch blocks, swallowed exceptions |
| Unclear Intent | Code requires comments to understand |
| Duplicated Logic | Same logic in multiple places (DRY violation) |
| Hard to Test | Tight coupling prevents unit testing |
| Magic Values | Unexplained literals without named constants |

---

## YAGNI Check (MEDIUM)

**Y**ou **A**in't **G**onna **N**eed **I**t - Flag code with no callers.

### Detection Steps

| Step | Action |
|------|--------|
| 1 | For each new public function/method/class, search for call sites |
| 2 | Use `grep -r "functionName"` or IDE search |
| 3 | If 0 callers found -> Flag as YAGNI violation |

### Violation Patterns

| Pattern | Problem | Action |
|---------|---------|--------|
| New function with 0 callers | Dead code from start | Flag: "No call sites found. Remove or add usage." |
| "Future-proofing" abstractions | Premature optimization | Flag: "Abstraction has no current use case." |
| Unused parameters | Over-generalization | Flag: "Parameter `X` is never used." |
| Empty interface implementations | Placeholder code | Flag: "Implementation does nothing. Remove or implement." |

**Exception:** Test utilities, public API contracts, or explicitly documented extension points.

### Example Feedback

```markdown
suggestion [Confidence: 80]: YAGNI - Remove unused bulkDelete method

**What:** `UserService.bulkDelete()` at line 89-105 has no call sites in codebase.
**Why:** Dead code increases maintenance burden. Risk of bit rot (untested, may break silently).
**How:**
  - Option A: Remove entirely -> Clean codebase, less to maintain
  - Option B: Add caller if needed -> But then add tests too
**Benefit:** Smaller codebase, no unused code paths to maintain.
```

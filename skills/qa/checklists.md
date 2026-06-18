# Code Quality Checklists

Quality review checklists covering the two CRITICAL code-quality categories: Security and Data Integrity. Use during Stage 4 of the code review process.

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


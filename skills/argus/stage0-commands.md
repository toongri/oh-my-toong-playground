# Stage 0: Automated Verification

Run automated checks BEFORE any code analysis. This is not optional.

---

## Step 0.1: Discover Project Commands

**Do NOT assume commands.** Each project has different tooling.

### Discovery Order

1. **Check memory file first**: `{project-root}/.omt/argus/project-commands.md`
2. **If not found, analyze project documentation:**
   - `CLAUDE.md`, `AGENTS.md`, `CODEX.md`, `GEMINI.md` -> AI-specific instructions
   - `README.md` / `CONTRIBUTING.md` -> documented commands
   - `rules/` directory -> project rules and conventions
   - `.cursor/rules/`, `.windsurf/rules/` -> IDE-specific configs
3. **Then analyze build files:**
   - `package.json` -> scripts section (npm/yarn/pnpm)
   - `build.gradle` / `build.gradle.kts` -> tasks
   - `Makefile` -> targets
   - `pyproject.toml` / `setup.py` -> pytest, tox
   - `Cargo.toml` -> cargo commands
4. **If still unclear, ask user** for build/test/lint commands
5. **Save discovered commands** to `{project-root}/.omt/argus/project-commands.md`

### Memory File Format

**Location:** `{project-root}/.omt/argus/project-commands.md`

```markdown
# Project Commands

## Build/Test/Lint
- Build: `{command}`
- Test: `{command}`
- Lint: `{command}`

## Source
- Discovered from: {file where commands were found}
- Last updated: {date}

## Notes
{any special considerations}
```

**Trust but verify:** Use cached commands, but if execution fails, re-analyze and update memory file.

---

## Step 0.2: Run Checks

| Check | Pass Criteria |
|-------|---------------|
| **Build/Compile** | Exit code 0, no compilation errors |
| **All Tests** | All tests pass AND tests exist for changed code |
| **Linter/Static Analysis** | No errors (warnings acceptable) |

### Execution Order

1. Run build/compile first
2. Run full test suite
3. Run linter/static analysis

**Any failure -> Immediate `REQUEST_CHANGES`**

---

## Special Case: No Tests for Changed Code

**"0 tests executed" for new/changed code = FAILURE**

- New code without tests is incomplete
- Changed code without test coverage is risky
- "Tests pass" requires tests to actually exist

**Action:** REQUEST_CHANGES with requirement to add tests before re-review.

---

## Special Case: No Build System / Minimal Project

When project lacks build tools, tests, or linter:

1. **Run what CAN be run** (syntax check is always possible)
   - Python: `python -m py_compile file.py`
   - JavaScript: `node --check file.js`
   - Shell: `bash -n script.sh`

2. **Document gaps as findings** for Stage 2
   - "No test coverage" -> recommend adding tests
   - "No linter configured" -> recommend setup

3. **Proceed to Stage 1** after documenting

**"No tools configured" is a finding, not a blocker.** The absence of tooling itself becomes a code quality concern.

---

## Stage 0 Output Format

```markdown
## Stage 0: Automated Verification

| Check | Status | Details |
|-------|--------|---------|
| Build | PASS / FAIL | [output summary] |
| Tests | PASS (N/N) / FAIL (N/M) | [failed test names if any] |
| Lint | PASS / FAIL | [error count if any] |

**Stage 0 Result:** PASS -> Proceed to Stage 1 / FAIL -> REQUEST_CHANGES
```

---

## Stage 0 Failure = Immediate Stop

If ANY check fails:
1. **Do NOT proceed to Stage 1 or Stage 2**
2. Report the failure with specific output
3. Issue `REQUEST_CHANGES` immediately
4. Wait for fix and re-run Stage 0

---

## Red Flags for Stage 0

| Excuse | Reality |
|--------|---------|
| "Build takes too long" | Broken code costs more. Run it. |
| "Tests are flaky" | Report flaky tests as issue, still run them |
| "CI will catch it" | Catching at review is cheaper than CI failure |
| "Senior wrote it" | Seniority doesn't prevent bugs |
| "Already in QA" | Sunk cost fallacy. Find bugs now. |
| "Just a quick review" | Quick reviews miss broken builds |
| "I can see it compiles" | "Can see" != "verified". Run the build. |
| "No tests exist yet" | Missing tests = incomplete code. Block until added. |
| "It's new code, tests come later" | Tests come WITH code, not after. |
| "0 tests passed = all pass" | 0 tests = failure, not success |
| "I'll just use npm test" | Discover actual commands. Don't assume. |
| "Standard commands work everywhere" | Each project is different. Check first. |

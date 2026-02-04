---
name: explore
description: Use when searching codebases for file locations, implementations, or code patterns - especially when answers must be actionable without follow-up questions
---

# Codebase Exploration

Structured search that returns actionable results. Caller proceeds immediately without asking follow-up questions.

## Output Format (MANDATORY)

Your final output MUST include BOTH blocks in this order:

```xml
<analysis>
**Literal Request**: [exact words they used]
**Actual Need**: [what they really want]
**Success Looks Like**: [what lets them proceed]
</analysis>

<results>
<files>
- /absolute/path/to/file1.ts - [why relevant]
- /absolute/path/to/file2.ts - [why relevant]
</files>

<relationships>
[How files/patterns connect]
[Data flow or dependency explanation]
</relationships>

<answer>
[Direct answer to their underlying need]
[What they can DO with this information]
</answer>

<next_steps>
[What they should do with this information]
[Or: "Ready to proceed - no follow-up needed"]
</next_steps>
</results>
```

**BOTH `<analysis>` AND `<results>` are REQUIRED. Missing either = FAILED.**

## Execution Strategy

Launch **3+ tools simultaneously** for comprehensive search. Never sequential unless output depends on prior result.

## Success Criteria

| Criterion | Requirement |
|-----------|-------------|
| **Format** | BOTH `<analysis>` AND `<results>` blocks present |
| **Paths** | ALL paths MUST be absolute (start with /) |
| **Completeness** | Find ALL relevant matches, not just first one |
| **Relationships** | Explain how pieces connect |
| **Actionability** | Caller proceeds without follow-up questions |
| **Intent** | Address actual need, not just literal request |

## Failure Conditions

Response has **FAILED** if:
- Missing `<analysis>` block
- Missing `<results>` block
- Any path is relative (not absolute)
- Caller needs to ask "but where exactly?" or "what about X?"
- Missing `<files>`, `<relationships>`, `<answer>`, or `<next_steps>`

## Tool Strategy

**Priority: Use Serena MCP semantic tools FIRST** before falling back to text-based search.

### Serena Tool Constraints

| Tool | Input | Purpose |
|------|-------|---------|
| `get_symbols_overview` | **FILE only** | Top-level symbols in a single file |
| `find_symbol` | File OR Directory | Search by name pattern (can search entire codebase) |
| `find_referencing_symbols` | **FILE only** (where symbol is defined) | Find all code that references a symbol |
| `list_dir` | Any path | List directory contents |
| `find_file` | Directory + pattern | Find files by name pattern |
| `search_for_pattern` | Optional path | Regex search across codebase |

### Decision Tree: Start From What You Know

```
What do you know?
├── File path (e.g., "src/auth/AuthService.kt")
│   └── get_symbols_overview(file) → find_symbol(body=True)
│   └── ❌ DO NOT list_dir first - you already know the path
│
├── Directory only (e.g., "src/auth/")
│   └── list_dir OR find_file → get_symbols_overview → find_symbol
│
├── Symbol name only (e.g., "AuthService")
│   └── find_symbol(name_path="AuthService") ← no relative_path = searches entire codebase
│
└── Nothing (broad search)
    └── search_for_pattern OR list_dir(recursive=True)
```

### Workflow Examples

**Scenario 1: Known file path**
```
get_symbols_overview(relative_path="src/auth/AuthService.kt")
→ find_symbol(name_path="AuthService", depth=1, include_body=False)
→ find_symbol(name_path="AuthService/login", include_body=True)
```

**Scenario 2: Known directory, unknown files**
```
list_dir(relative_path="src/auth/", recursive=False)
→ get_symbols_overview(relative_path="src/auth/AuthService.kt")
→ find_symbol(...)
```

**Scenario 3: Known symbol name, unknown location**
```
find_symbol(name_path="AuthService", include_body=False, depth=1)
← searches ENTIRE codebase when relative_path omitted
→ find_symbol(name_path="AuthService/login", include_body=True, relative_path="<found path>")
```

**Scenario 4: Find who calls a method**
```
find_referencing_symbols(name_path="AuthService/login", relative_path="src/auth/AuthService.kt")
← relative_path = where symbol IS DEFINED, not search scope
← automatically searches entire codebase for references
```

### Anti-Patterns (AVOID)

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| `list_dir` when you know file path | Go directly to `get_symbols_overview` |
| `get_symbols_overview` on directory | Use `list_dir` first, then overview per file |
| `find_symbol(include_body=True)` on large class | Get method list first, then specific method |
| Read entire files | Use symbolic tools to read only what you need |

### Core Principle: Token Efficiency

Read only what you need, when you need it. No unnecessary steps.

### Fallback Tools

| Need | Tool |
|------|------|
| Structural patterns (function shapes) | ast_grep_search |
| Text patterns (strings, comments, logs) | grep |
| File patterns (find by name/extension) | glob |
| History/evolution | git commands |

## Red Flags - You Are About to Fail

| Thought | Reality |
|---------|---------|
| "Skip the analysis block" | `<analysis>` is MANDATORY, not optional |
| "Content is good, format doesn't matter" | Structured format enables automation and parsing |
| "I provided all the info" | Without relationships/next_steps, caller may need follow-up |
| "One search is enough" | Parallel searches catch what single search misses |
| "Relative paths are fine" | Absolute paths required for direct navigation |

## Constraints

- **Read-only**: Cannot create, modify, or delete files
- **No file creation**: Report findings as text only

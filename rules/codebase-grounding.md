# Codebase Grounding

When gathering codebase facts — locating symbols, tracing callers/usages, mapping dependencies, or confirming a `file:line` claim — prefer the `codegraph` MCP's `codegraph_explore` tool when it is available, and fall back to text/file tools when it is not. This applies to every agent that reads code to ground a decision, reviewers included.

## Prefer `codegraph_explore` when present

When the `codegraph_explore` tool is in your tool list, prefer it over a `Grep`+`Read` loop for "how does X work", "where/what is X", symbol and reference questions, and surveying an area before an edit. It is Read-equivalent: one call takes a natural-language question or a bag of symbol/file names and returns the verbatim, line-numbered source grouped by file — plus the call path among those symbols and a blast-radius summary of what depends on them. One call usually answers the whole question, at a fraction of the tokens and round-trips of a manual grep/read sweep, and it resolves which definition each usage actually binds to.

## Fall back when absent

When `codegraph_explore` is not in your tool list, there is no semantic symbol-graph tool here: degrade to `Grep` / `ast-grep` + targeted `Read`, and treat the result as a textual/syntactic approximation — name-collision false positives, no scope/type/import resolution, a candidate set to verify rather than a ground-truth reference set. This rule is then a no-op: nothing about the fallback path changes, so it is harmless in a project where codegraph is not connected.

## Just-written code: read the changed files directly

The codegraph index lags writes by about one second through its file watcher, so a query issued immediately after an edit can return stale structure. When verifying or reviewing code that was just written or changed — confirming a fresh diff, auditing a just-applied edit — `Read` the specific changed files directly for their current bytes, and use `codegraph_explore` for the surrounding and dependency context. Prefer the freshest source for the exact bytes under review; prefer codegraph for everything around them.

# Codebase Grounding

When gathering codebase facts — locating symbols, tracing callers/usages, mapping dependencies, or confirming a `file:line` claim — prefer the `codegraph` MCP's `codegraph_explore` tool when it is available, and fall back to text/file tools when it is not. This applies to every agent that reads code to ground a decision, reviewers included.

## Prefer `codegraph_explore` when present

When the `codegraph_explore` tool is in your tool list, prefer it over a `Grep`+`Read` loop for "how does X work", "where/what is X", symbol and reference questions, and surveying an area before an edit. It is Read-equivalent: one call takes a natural-language question or a bag of symbol/file names and returns the verbatim, line-numbered source grouped by file — plus the call path among those symbols and a blast-radius summary of what depends on them. One call usually answers the whole question, at a fraction of the tokens and round-trips of a manual grep/read sweep, and it resolves which definition each usage actually binds to.

### A deferred listing counts as present

A harness can list a tool by name only and load its schema on demand — Claude Code's deferred tools, Codex's `tool_search`. When `codegraph_explore` appears in such a listing, it is present: load it before your first code search (Claude Code: `ToolSearch` with `select:mcp__codegraph__codegraph_explore`; Codex: `tool_search` for `codegraph_explore`), then use it. An unloaded schema is not a reason to fall back to grep. Subagents fell into exactly that fallback: across one session's 26 exploration subagents, only those that ran the tool-search step called codegraph (5 calls), and the rest ran 325 `grep`/`git grep` sweeps that stacked into CPU spikes.

When you delegate code search to a subagent, write the same order into the prompt — "load `codegraph_explore` first, use `grep` only for text the graph does not index (configs, docs, string literals)". Do not write "use codegraph if available, else grep": the subagent reads an unloaded tool as unavailable and takes the `else`.

## Fall back when absent

When `codegraph_explore` is neither in your tool list nor in a deferred/tool-search listing, there is no semantic symbol-graph tool here: degrade to `Grep` / `ast-grep` + targeted `Read`, and treat the result as a textual/syntactic approximation — name-collision false positives, no scope/type/import resolution, a candidate set to verify rather than a ground-truth reference set. This rule is then a no-op: nothing about the fallback path changes, so it is harmless in a project where codegraph is not connected.

## Just-written code: read the changed files directly

The codegraph index lags writes by about one second through its file watcher, so a query issued immediately after an edit can return stale structure. When verifying or reviewing code that was just written or changed — confirming a fresh diff, auditing a just-applied edit — `Read` the specific changed files directly for their current bytes, and use `codegraph_explore` for the surrounding and dependency context. Prefer the freshest source for the exact bytes under review; prefer codegraph for everything around them.

**[한국어](outbound-local-reference-gate.md)** | English

# Outbound local-reference gate

This situational gate checks text before it is left in an external system so it
does not cite a file that exists only on the current machine. It does not
change source files; it decides whether a citation is safe at the outbound
boundary for commits, PR bodies and comments, and collaboration tools.

## Surfaces and scope

| Surface | Input inspected |
|---|---|
| Git commit | **Newly added lines only** from the staged diff (old lines are not rechecked) |
| PR | The complete `body` of a create/edit request or a PR comment |
| Notion | The complete page/block-write payload |
| Slack | The complete message-write payload |
| Linear | The complete issue/comment-write payload |

Because a local commit inspects only added lines, an unrelated new edit does not
re-block an old violation. PR and online MCP writes use **full-payload scope**
for that request. However, stdin-backed PR bodies supplied via `gh --body-file -`
are unavailable to this PreToolUse shell hook, so it does not claim to have
inspected them; this boundary is fail-open.

## Predicate

The shared core (`local-path-ref-gate-core.sh`) scans text line by line and
classifies each path. It allows:

- placeholders, templates, and globs such as `{slug}`, `$VAR`, `*`, `?`, and
  `[set]`;
- external URLs and anchors such as `https://…`, `http://…`, `mailto:…`, and
  `#section`; and
- concrete paths that do not exist.

It denies:

- an existing **untracked local path** (including a machine file outside the
  repository);
- an **absolute path** to a tracked file in the repository; and
- a **dangling relative link** whose repository-relative target does not exist.

A tracked repository-relative link is the normal safe citation form. If a path
cannot be checked because setup or Git inspection failed, it is not treated as a
denial.

## Required remedies

Do not solve a denial by deleting the citation alone. Put the evidence into the
outbound payload by doing one of the following:

1. include an inline summary;
2. copy the file into the repository, ensure that copy is tracked, and cite it; or
3. create a **tracked repository-relative link**.

Every denial includes its location and one of these remedies; **deleting the
citation alone is forbidden**.

## Platform wiring and failure mode

The shared core only judges paths. Each platform shim connects its event to that
same core. The Claude and Codex shims therefore share the core, predicate, and
remedies.
The Codex shim is the companion implementation: Codex PreToolUse
provides MCP arguments as `tool_input`, and the shim inspects the
`mcp__notion__.*`, `mcp__slack__.*`, and `mcp__linear__.*` tool routes.

Malformed payloads, unavailable `jq`/Git/index data, unknown command or MCP
shapes, and an unresolvable repository location are **fail-open** conditions.
They do not block the outbound action; they only emit diagnostics.

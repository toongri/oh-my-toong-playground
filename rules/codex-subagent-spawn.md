# Codex Subagent Spawn

When Codex spawns a subagent through the collaboration namespace's
`spawn_agent` tool (real runtime tool name `collaborationspawn_agent`),
always pass `fork_turns: "none"` explicitly. Never omit it.

Omitting `fork_turns` defaults to `"all"` — a full-history fork that hands
the child the parent's entire conversation. Subagents must run context-free,
independent of the parent's history, so that default is never what you want.

A full-history fork also makes the router reject a per-spawn `model`
override on that call (observed Codex runtime constraint) — another reason
never to omit it.

Always call `spawn_agent` with `fork_turns: "none"`.

# Codex Subagent Spawn

For every native Codex `spawn_agent` call, always pass
`fork_turns: "none"` explicitly. This applies to every tool namespace,
role, and workflow, including calls outside sisyphus. Never omit it.

Subagents must receive their task and necessary evidence in the spawn
message, independently of the parent's conversation history. In runtimes
where omission defaults to `"all"`, omission violates this policy too.

Every spawn must also explicitly pass a nonempty `agent_type`: use
`"default"` for generic tasks and the exact custom role name for specialized
tasks. A role name in `task_name` or the message does not select its role
TOML. Native Codex 0.153.4 has built-in roles `default`, `worker`, and
`explorer`; OMT's custom `explore` is a different role from `explorer`.
If the tool lacks `agent_type` or cannot discover the requested role,
report the tool/configuration loading problem. Do not substitute another
role or claim the requested role was applied.

Once registered and deployed, `codex-spawn-role-gate.sh` blocks missing,
null, or blank `agent_type` values. It does not select a role automatically.

Once registered and deployed, `codex-spawn-context-gate.sh` enforces this
shared runtime policy by normalizing `fork_turns` to `"none"` through
`updatedInput` and removing legacy `fork_context`, which could otherwise
enable history forking in V1. Non-context spawn arguments are preserved.
Explicitly pass `"none"` even when the hook is available. This is not a security boundary
against administrators who can change the hook, configuration, or files.

Follow the current session's restrictions on per-call model and effort
overrides. Some tool surfaces reject overrides on full-history forks;
that restriction is not a universal statement about native role TOML
model selection.

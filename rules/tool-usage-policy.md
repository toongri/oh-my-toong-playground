# Tool Usage Policy

## CRITICAL: Agent Tasks Run in Foreground

- Agent tasks (with `subagent_type`) run in foreground. `run_in_background` is prohibited.
- Multiple independent agent tasks go in a SINGLE response — never dispatch sequentially.
- `run_in_background=true` is reserved for Bash shell commands only (builds, tests, installs).

## CRITICAL: TaskOutput Is Prohibited

- Never use the TaskOutput tool. It returns the agent's full JSONL execution log, wasting context.
- Background Bash tasks notify you when complete. Do not stop working while waiting — continue with other tasks until the notification arrives.

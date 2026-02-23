# Tool Usage Policy

## CRITICAL: Agent Tasks Run in Foreground

- Agent tasks (with `subagent_type`) run in foreground. `run_in_background` is prohibited.
- Multiple independent agent tasks go in a SINGLE response — never dispatch sequentially.

## CRITICAL: TaskOutput Is Prohibited

- Never use the TaskOutput tool. It returns the agent's full JSONL execution log, wasting context.

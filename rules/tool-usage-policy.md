# Tool Usage Policy

## CRITICAL: Independent Agent Tasks Dispatch in Parallel

- Multiple independent agent tasks go in a SINGLE response — never dispatch sequentially.

## CRITICAL: TaskOutput Is Prohibited

- Never use the TaskOutput tool. It returns the agent's full JSONL execution log, wasting context.

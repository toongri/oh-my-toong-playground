# opencode Input Limits — Research Notes

Date: 2026-05-08
opencode version: 1.14.41
Test model: openai/gpt-5.4-mini (via opencode-go proxy)

## PROMPT_MAX_BYTES Decision

**Decision: 80 KB (80*1024 = 81920 bytes) — plan's conservative anchor**

```
PROMPT_MAX_BYTES = 80*1024  // 81920 bytes — plan's conservative anchor; 60KB/100KB/200KB all empirically pass, 80KB sits inside verified-pass band with margin for system prompt + tool defs. based on row 3 of evidence above (200KB pass, 500KB ContextOverflowError).
```

The 500 KB prompt reliably triggers `ContextOverflowError`. The 60 KB, 100 KB,
and 200 KB prompts all succeed. 400 KB + ~80 KB system prompt overhead ≈ 480 KB,
dangerously close to the observed 500 KB cliff. The conservative anchor 80*1024
(= 81920 bytes) stays well inside the verified-pass band and leaves ample margin
for system prompt overhead (~50–80 KB) and tool definitions.

## Boundary Evidence

Sizes: 60KB, 100KB, 200KB (all pass); 500KB (ContextOverflowError).

| Prompt size | Exit code | NDJSON event type | Error name |
|-------------|-----------|-------------------|------------|
| 60 KB       | 0         | step_finish       | (none)     |
| 100 KB      | 0         | step_finish       | (none)     |
| 200 KB      | 0         | step_finish       | (none)     |
| 500 KB      | 0         | error             | ContextOverflowError |

All boundary tests run with `opencode run --pure --format json`.

The 500 KB payload is a base64-encoded string (no whitespace), so token count is
approximately 125 000 tokens (1 token ≈ 4 bytes), which exceeds the gpt-5.4-mini
context window.

## Exit Code Evidence

**KEY FINDING**: opencode always exits 0, even on session error.

Tested cases:
- `ProviderModelNotFoundError` (invalid model): exit 0, NDJSON `{"type":"error",...}`
- `ContextOverflowError` (500 KB prompt): exit 0, NDJSON `{"type":"error",...}`
- Connection refused (network error): opencode retries indefinitely — no error
  NDJSON emitted from network errors. Process must be killed externally.

## Verification commands

```
$ opencode run --pure --format json --model "openai/gpt-5.4-mini" "<500KB payload>" > out.ndjson
$ echo $?
0
$ jq -r 'select(.type=="error").error.name' out.ndjson
ContextOverflowError
```

This confirms the motivating incident hypothesis: chunk-review workers (GPT-5.5
and Kimi-K2.6) that exited 0 with empty output were likely hitting a session
error that did not call `process.exit(1)`.

## Error Event Schema

Real captured payload (ProviderModelNotFoundError):
```json
{
  "type": "error",
  "timestamp": 1778207224588,
  "sessionID": "ses_1fa970d35ffeROC86VpJNID52g",
  "error": {
    "name": "UnknownError",
    "data": {
      "message": "Model not found: openai/invalid-model-name-xyz."
    }
  }
}
```

Real captured payload (ContextOverflowError):
```json
{
  "type": "error",
  "timestamp": 1778208534476,
  "sessionID": "ses_1fa832167ffey5kT20U6nGpTxy",
  "error": {
    "name": "ContextOverflowError",
    "data": {
      "message": "Input exceeds context window of this model",
      "responseBody": "{\"type\":\"error\",\"sequence_number\":2,\"error\":{\"type\":\"invalid_request_error\",\"code\":\"context_length_exceeded\",\"message\":\"Your input exceeds the context window of this model. Please adjust your input and try again.\",\"param\":\"input\"}}"
    }
  }
}
```

## Observations

1. `error.name` distinguishes error types: `UnknownError`, `ContextOverflowError`,
   `RateLimitError` (not yet observed naturally).
2. `error.data.message` carries the human-readable description.
3. `ContextOverflowError.data.responseBody` contains the raw provider response JSON.
4. Rate limit errors were not triggered by 5 simultaneous calls to gpt-5.4-mini.
   The mock fixture uses inferred schema from error name patterns.
   Schema inferred from OpenAI rate limit error documentation: https://platform.openai.com/docs/guides/rate-limits
5. Network errors (connection refused) do NOT produce NDJSON error events —
   opencode retries indefinitely. The session never terminates.

## Fixtures

- `lib/__fixtures__/opencode-error-auth.ndjson` — real, ProviderModelNotFoundError
- `lib/__fixtures__/opencode-error-context_window.ndjson` — real, ContextOverflowError
- `lib/__fixtures__/opencode-error-rate_limit.ndjson` — mock-derived (RateLimitError schema inferred)
- `lib/__fixtures__/opencode-error-network.ndjson` — mock-derived (ConnectionRefused, opencode retries indefinitely)

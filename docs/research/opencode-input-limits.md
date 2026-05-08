# opencode Input Limits — Research Notes (v2)

Date: 2026-05-08  
opencode version: 1.14.41  
Production models: `openai/gpt-5.5`, `opencode-go/kimi-k2.6`  
Spike evidence: `evidence/orchestrate-review-output-reliability-v2/spike/` (14 files)

---

## PROMPT_MAX_BYTES Decision

```
PROMPT_MAX_BYTES = 80*1024  // 81920 bytes — plan's conservative anchor; 60KB/100KB/200KB all empirically pass, 80KB sits inside verified-pass band with margin for system prompt + tool defs. based on row 3 of evidence above (200KB pass, 500KB ContextOverflowError).
```

The 500 KB prompt reliably triggers `ContextOverflowError` on gpt-5.5. The 60 KB, 100 KB,
and 200 KB prompts all succeed. 400 KB + ~80 KB system prompt overhead ≈ 480 KB,
dangerously close to the observed 500 KB cliff. The conservative anchor 80*1024
(= 81920 bytes) stays well inside the verified-pass band and leaves ample margin
for system prompt overhead (~50–80 KB) and tool definitions.

---

## Input Boundary Table

### gpt-5.5 input boundary

| Prompt size | Exit code | NDJSON event type     | Error name           |
|-------------|-----------|----------------------|----------------------|
| 60 KB       | 0         | step_finish          | (none)               |
| 100 KB      | 0         | step_finish          | (none)               |
| 200 KB      | 0         | step_finish          | (none)               |
| 500 KB      | 0         | error                | ContextOverflowError |

Source: gpt-S5-100k (100KB prompt → step_finish, input tokens: 88590), gpt-S5-500k (500KB → ContextOverflowError).  
The 500 KB payload is base64-encoded (no whitespace), exceeding the gpt-5.5 context window.

### kimi-k2.6 input boundary

| Prompt size | Exit code | NDJSON event type | Error name | Detail                                    |
|-------------|-----------|-------------------|------------|-------------------------------------------|
| ~34 K tokens| 0         | step_finish       | (none)     | S1-happy: input=34248 tokens              |
| 500 KB      | 0         | error             | APIError   | kimi-k2.6 overflow: 256k token limit (262144), requested: 370653 |

kimi-k2.6 limit: 262144 tokens. Source: kimi-S5-500k, `responseBody` inner `raw` field:  
`"Invalid request: Your request exceeded model token limit: 262144 (requested: 370653)"`.  
kimi overflow → `APIError` (not `ContextOverflowError`).

---

## Exit Code Finding

**opencode always exits 0, even on session error.**

Tested cases (both models):
- `ProviderModelNotFoundError` (invalid model): exit 0, NDJSON `{"type":"error",...}`
- `ContextOverflowError` (gpt-5.5, 500 KB): exit 0, NDJSON `{"type":"error",...}`
- `APIError` (kimi-k2.6, 500 KB): exit 0, NDJSON `{"type":"error",...}`

---

## Per-Model Event Payload Schemas

### gpt-5.5 step_start

Source: `gpt-S1-happy.ndjson` line 1, `gpt-S5-100k.ndjson` line 1, `gpt-S5-500k.ndjson` line 1.

```json
{
  "type": "step_start",
  "timestamp": 1778226126949,
  "sessionID": "ses_1f976af06ffeQ9OmQMTjLRSafG",
  "part": {
    "id": "prt_e06896064001xUyaY7Tea357Y6",
    "messageID": "msg_e06895297001TTrl89pEo7ybnF",
    "sessionID": "ses_1f976af06ffeQ9OmQMTjLRSafG",
    "type": "step-start"
  }
}
```

### gpt-5.5 text

Source: `gpt-S1-happy.ndjson` line 2. Key field: `event.part.text`.

```json
{
  "type": "text",
  "timestamp": 1778226128459,
  "sessionID": "ses_1f976af06ffeQ9OmQMTjLRSafG",
  "part": {
    "id": "prt_e06896604001Qix601z0esZXgR",
    "messageID": "msg_e06895297001TTrl89pEo7ybnF",
    "sessionID": "ses_1f976af06ffeQ9OmQMTjLRSafG",
    "type": "text",
    "text": "OK",
    "time": { "start": 1778226128388, "end": 1778226128458 },
    "metadata": {
      "openai": {
        "itemId": "msg_0ebc2f4dfac459670169fd93d077cc819195e58acd75a5f979",
        "phase": "final_answer"
      }
    }
  }
}
```

**Note**: the text content is at `event.part.text`. `event.text` does not exist.

### gpt-5.5 step_finish

Source: `gpt-S1-happy.ndjson` line 3. Key field: `event.part.reason`.

```json
{
  "type": "step_finish",
  "timestamp": 1778226128476,
  "sessionID": "ses_1f976af06ffeQ9OmQMTjLRSafG",
  "part": {
    "id": "prt_e0689665b001TNyC6CRSH6GudU",
    "reason": "stop",
    "messageID": "msg_e06895297001TTrl89pEo7ybnF",
    "sessionID": "ses_1f976af06ffeQ9OmQMTjLRSafG",
    "type": "step-finish",
    "tokens": {
      "total": 32183,
      "input": 32162,
      "output": 7,
      "reasoning": 14,
      "cache": { "write": 0, "read": 0 }
    },
    "cost": 0
  }
}
```

**Note**: finish reason is at `event.part.reason = "stop"`. `event.reason` is not present (always null/absent).

### gpt-5.5 error

Two distinct error shapes observed.

**UnknownError (invalid model)** — source: `gpt-S4-invalid-model.ndjson`:

```json
{
  "type": "error",
  "timestamp": 1778226175209,
  "sessionID": "ses_1f975e3feffe8UyUInAJE49ypu",
  "error": {
    "name": "UnknownError",
    "data": {
      "message": "Model not found: openai/invalid-model-name-xyz."
    }
  }
}
```

stderr shows `ProviderModelNotFoundError` with `providerID: "openai"`, `modelID: "invalid-model-name-xyz"`.

**ContextOverflowError (500 KB prompt)** — source: `gpt-S5-500k.ndjson`:

```json
{
  "type": "error",
  "timestamp": 1778226217218,
  "sessionID": "ses_1f9755009ffee8JrpYLKy1QwzO",
  "error": {
    "name": "ContextOverflowError",
    "data": {
      "message": "Input exceeds context window of this model",
      "responseBody": "{\"type\":\"error\",\"sequence_number\":2,\"error\":{\"type\":\"invalid_request_error\",\"code\":\"context_length_exceeded\",\"message\":\"Your input exceeds the context window of this model. Please adjust your input and try again.\",\"param\":\"input\"}}"
    }
  }
}
```

`error.data.responseBody` is an escaped JSON string. `ContextOverflowError` fires twice on 500 KB (two step_start + two error events in sequence).

---

### kimi-k2.6 step_start

Source: `kimi-S1-happy.ndjson` line 1.

```json
{
  "type": "step_start",
  "timestamp": 1778226143765,
  "sessionID": "ses_1f9768db6ffe77Rgmlo5XTaAI6",
  "part": {
    "id": "prt_e0689a210001N6XPERNdTKQILn",
    "messageID": "msg_e06897415001Mfyu7sdwUFEusS",
    "sessionID": "ses_1f9768db6ffe77Rgmlo5XTaAI6",
    "type": "step-start"
  }
}
```

### kimi-k2.6 text

Source: `kimi-S1-happy.ndjson` line 2. Key field: `event.part.text`.

```json
{
  "type": "text",
  "timestamp": 1778226143940,
  "sessionID": "ses_1f9768db6ffe77Rgmlo5XTaAI6",
  "part": {
    "id": "prt_e0689a269001I6uglGxY8Ihm7q",
    "messageID": "msg_e06897415001Mfyu7sdwUFEusS",
    "sessionID": "ses_1f9768db6ffe77Rgmlo5XTaAI6",
    "type": "text",
    "text": "OK",
    "time": { "start": 1778226143849, "end": 1778226143938 }
  }
}
```

**Note**: kimi-k2.6 `text` event has no `metadata.openai` field (unlike gpt-5.5). Text at `event.part.text`.

### kimi-k2.6 step_finish

Source: `kimi-S1-happy.ndjson` line 3. Key field: `event.part.reason`.

```json
{
  "type": "step_finish",
  "timestamp": 1778226143943,
  "sessionID": "ses_1f9768db6ffe77Rgmlo5XTaAI6",
  "part": {
    "id": "prt_e0689a2c4001njr8YEKHeck057",
    "reason": "stop",
    "messageID": "msg_e06897415001Mfyu7sdwUFEusS",
    "sessionID": "ses_1f9768db6ffe77Rgmlo5XTaAI6",
    "type": "step-finish",
    "tokens": {
      "total": 34265,
      "input": 34248,
      "output": 3,
      "reasoning": 14,
      "cache": { "write": 0, "read": 0 }
    },
    "cost": 0.0326036
  }
}
```

**Note**: finish reason at `event.part.reason = "stop"`. `event.reason` absent (always null).

### kimi-k2.6 error

Two distinct error shapes observed.

**UnknownError (invalid model)** — source: `kimi-S4-invalid-model.ndjson`:

```json
{
  "type": "error",
  "timestamp": 1778226177458,
  "sessionID": "ses_1f975db36ffeikKQvclR1RBjez",
  "error": {
    "name": "UnknownError",
    "data": {
      "message": "Model not found: opencode-go/invalid-model-name-xyz."
    }
  }
}
```

stderr shows `ProviderModelNotFoundError` with `providerID: "opencode-go"`, `modelID: "invalid-model-name-xyz"`.

**APIError (overflow — kimi overflow)** — source: `kimi-S5-500k.ndjson`:

```json
{
  "type": "error",
  "timestamp": 1778226233919,
  "sessionID": "ses_1f9751399ffeqfsNfb9hDJEGA0",
  "error": {
    "name": "APIError",
    "data": {
      "message": "Error from provider: Provider returned error",
      "statusCode": 400,
      "isRetryable": false,
      "responseHeaders": {
        "cf-ray": "9f86d5fb1a90fef8-PDX",
        "content-type": "application/json"
      },
      "responseBody": "{\"error\":{\"message\":\"Error from provider: Provider returned error\",\"code\":400,\"metadata\":{\"raw\":\"{\\\"error\\\":{\\\"message\\\":\\\"Invalid request: Your request exceeded model token limit: 262144 (requested: 370653)\\\",\\\"type\\\":\\\"invalid_request_error\\\"}}\",\"provider_name\":\"Moonshot AI\",\"is_byok\":true}},\"user_id\":\"user_2z4xm5LomaIHfsnVqMhFsWrVrGY\"}"
    }
  }
}
```

**APIError responseBody nesting** (kimi overflow):

- `error.data.responseBody` is an escaped JSON string.
- Parsed `responseBody.error.metadata.raw` is itself an escape-encoded JSON string.
- Final human-readable message buried inside `raw`: `"Invalid request: Your request exceeded model token limit: 262144 (requested: 370653)"`.
- Detection path: `error.name === "APIError"` AND `error.data.statusCode === 400`.
- **kimi overflow does NOT use `ContextOverflowError`** — it surfaces as `APIError` with the limit detail inside a double-nested escaped JSON.

---

## Cross-Model Schema Comparison

| Field                     | gpt-5.5                           | kimi-k2.6                          |
|---------------------------|-----------------------------------|------------------------------------|
| `step_start` shape        | identical                         | identical                          |
| `text.part.text`          | present                           | present                            |
| `text` metadata           | `part.metadata.openai` present    | no `part.metadata` field           |
| `step_finish.part.reason` | `"stop"`                          | `"stop"`                           |
| `step_finish.part.cost`   | `0`                               | numeric (e.g. `0.0326036`)         |
| invalid model error       | `UnknownError`                    | `UnknownError`                     |
| overflow error name       | `ContextOverflowError`            | `APIError`                         |
| overflow detection        | `error.name === "ContextOverflowError"` | `error.name === "APIError"` + `statusCode: 400` |
| overflow limit            | context window exceeded (openai)  | 262144 tokens (kimi)               |

---

## Key Findings Summary

1. `event.part.reason = "stop"` — both gpt-5.5 and kimi-k2.6 use `event.part.reason`. `event.reason` is always absent.
2. `event.part.text` — both models surface text at `event.part.text`. `event.text` does not exist.
3. Invalid model → exit 0 + `error.name = "UnknownError"` + message `"Model not found: <provider>/<model>."` for both models.
4. Overflow error schema differs by model:
   - gpt-5.5: `error.name = "ContextOverflowError"` with `error.data.responseBody` (escaped JSON, one level).
   - kimi-k2.6: `error.name = "APIError"` + `statusCode: 400` + actual limit detail inside double-nested escaped JSON at `responseBody.error.metadata.raw`.
5. opencode always exits 0 on session error — process exit code cannot be used for error detection.
6. `--agent` wrapping has no effect on transport-level NDJSON schema.

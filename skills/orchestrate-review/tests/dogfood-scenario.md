# Orchestrate Review Dogfood Scenario

> P1-1 fix가 production opencode 호출에서 chain link-2 error (`error.type`) 를 `errorMessage` 필드로 surface하는지 manual 1회 검증.

---

## Purpose

이 문서는 automated test suite가 아니다. v2 spike에서 확인된 dysfunction (output-chain e2e 미검증) 을 보완하기 위해, 실제 production opencode CLI를 사람이 직접 호출하여 P1-1 fix의 end-to-end 동작을 눈으로 확인하는 1회성 dogfood 절차다.

**검증 대상**: `classifyError` + `classifyState` 체인이 opencode 실 호출 에러 응답을 받았을 때 manifest entry의 `errorMessage` 필드에 분류 결과를 올바르게 기록하는지 확인한다.

---

## Prerequisites

실행 전 아래 항목을 확인한다.

- **opencode version**: `opencode --version` 또는 `opencode -v` 명령으로 현재 설치된 버전을 기록한다. 예: `opencode 1.14.41`
- **Model registry**: 사용할 모델을 식별한다. 예: `openai/gpt-4o`, `moonshot/kimi-k2-thinking`. opencode version에 따라 model registry가 다를 수 있으므로, 실제 사용 가능한 모델명을 확인한다.
- **Working dir**: `/Users/toong/repos/oh-my-toong-playground/main` (또는 skill이 배포된 target 프로젝트 루트)

---

## Ground Truth: v2 Spike Fixtures

아래 v2 spike 결과를 expected behavior의 ground truth로 사용한다. 동일 시나리오를 production opencode 호출로 재현했을 때 같은 `errorMessage` 분류가 나와야 한다.

| Fixture path | 시나리오 | Expected `errorMessage` |
|---|---|---|
| `evidence/orchestrate-review-output-reliability-v2/spike/gpt-S5-500k.ndjson` | GPT oversized prompt (500k tokens) — Path: raw API error → classifyError → context_window | `context_window` |
| `evidence/orchestrate-review-output-reliability-v2/spike/kimi-S5-500k.ndjson` | Kimi oversized prompt (500k tokens) | `context_window` |
| `evidence/orchestrate-review-output-reliability-v2/spike/gpt-S4-invalid-model.ndjson` | GPT invalid model name | `model_not_found` |

---

## Checklist

아래 5단계를 순서대로 수행한다. 각 단계 완료 후 체크박스를 채운다 (직접 편집).

- [ ] `opencode --version` 명령을 실행하여 버전을 기록한다. 출력값을 이 파일의 Execution Log 섹션에 붙여 넣는다. 또한 model registry를 확인하여 사용할 model 이름을 결정한다 (예: `openai/gpt-4o`, `moonshot/kimi-k2-thinking`).

- [ ] `opencode run` 명령으로 production 호출 1회를 수행한다. 의도적 실패를 유발하여 error classification path를 테스트한다. 두 가지 방법 중 하나를 선택한다:
  - **(Option A) Oversized prompt**: 500k+ 토큰 분량의 텍스트를 프롬프트로 전달하여 `prompt_too_large` / `context_window` 분류를 유발한다.
  - **(Option B) Invalid model**: 존재하지 않는 model 이름 (예: `openai/nonexistent-model-xyz`)을 사용하여 `model_not_found` 분류를 유발한다.

- [ ] 호출 완료 후 생성된 manifest.json을 열어 `errorMessage` 필드를 확인한다. 필드가 존재하고 아래 Expected Manifest Output 섹션의 5개 분류 중 하나(`context_window`, `prompt_too_large`, `auth`, `quota_exceeded`, `model_not_found`)가 기록되어 있으면 P1-1 fix 정상 동작이다. 필드가 없거나 `null`이면 fix 미적용 상태다.

- [ ] evidence 캡처: manifest.json, 실행 로그, 그리고 opencode 출력 전체를 `evidence/orchestrate-review-followup-v3/dogfood/<run-id>/` 디렉토리에 수동으로 복사한다. `<run-id>`는 날짜 + 짧은 설명으로 구성한다 (예: `2026-05-11-option-b-invalid-model`). 이 캡처는 script로 자동화하지 않는다.

- [ ] Execution Log 섹션에 결과를 추가한다: date, outcome (pass/fail + 관측한 errorMessage 값), evidence 경로를 기록한다.

---

## Expected Manifest Output

아래는 Option B (invalid model) 시나리오에서 P1-1 fix가 정상 적용된 경우의 manifest.json 예시다.

```json
{
  "id": "dogfood-job",
  "members": [
    {
      "member": "alice",
      "outputFilePath": null,
      "errorMessage": "model_not_found",
      "size_bytes": 0,
      "attempts": 3,
      "error": {
        "type": "model_not_found",
        "message": "AI_APICallError"
      }
    }
  ]
}
```

Option A (oversized prompt) 시나리오에서는 GPT 계열은 `"errorMessage": "context_window"` (raw API error → classifyError 경로), Kimi 계열은 `"errorMessage": "context_window"` 가 나와야 한다. v2 spike fixtures와 일치하는지 대조한다.

---

## Execution Log

실행할 때마다 아래 형식으로 항목을 추가한다. 실행 전에는 placeholder를 그대로 둔다.

### YYYY-MM-DD: (placeholder, 실제 실행 후 채움)
- date: YYYY-MM-DD
- outcome: TBD (pending manual execution)
- evidence: evidence/orchestrate-review-followup-v3/dogfood/<run-id>/

### 2026-05-11: Option B (invalid model) — automated dogfood run
- date: 2026-05-11
- outcome: PASS — errorMessage="model_not_found" (link-2: status.error?.type hit)
- evidence: ~/.omt/oh-my-toong-playground/evidence/resolve-review-recommendations/dogfood-run/
- method: production lib 함수 직접 호출 — classifyError (lib/worker-utils.ts) + buildManifest (lib/generic-job.ts)

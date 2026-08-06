# 잡 워커가 단독으로 판단하도록 만드는 변경

대상 범위: `1c4e0292^..1c4e0292` (`chore: 잡 워커 프롬프트에 단독 수행 지시 추가`)

## Evidence

| 분류 | 파일 | 근거 |
|---|---|---|
| signal | `skills/agent-council/prompts/codex.md` | Codex 평의원에게 새 실행 제약을 추가한다. |
| signal | `skills/agent-council/prompts/default.md` | 평의회가 없을 때 쓰는 in-session 자문 프롬프트의 실행 제약을 추가한다. |
| signal | `skills/agent-council/prompts/glm.md` | GLM 평의원에게 새 실행 제약을 추가한다. |
| signal | `skills/agent-council/prompts/gpt.md` | GPT 평의원의 기존 “delegate/spawn” 허용 문구를 금지로 바꾼다. |
| signal | `skills/design-review/prompts/default.md` | 디자인 검토 fallback 프롬프트의 실행 제약을 추가한다. |
| signal | `skills/diagnose/prompts/default.md` | 진단 fallback 프롬프트의 실행 제약을 추가한다. |
| signal | `skills/slides-review/prompts/gemini.md` | Gemini 슬라이드 검토 워커의 실행 제약을 추가한다. |

noise 파일은 없다. 범위의 7개 변경 파일은 모두 프롬프트가 작업자에게 줄 수 있는 실행 경계를 바꾸므로 signal이다.

## Background

### 깊은 배경

이미 익숙하면 건너뛰세요.

이 저장소의 스킬은 서로 다른 AI에게 분석·자문·디자인 검토를 맡길 때, 역할과 산출물뿐 아니라 작업 방식도 프롬프트로 전달한다. 작업자가 다시 하위 에이전트를 만들 수 있으면, 처음에 계획한 한 명의 작업은 추가 작업들로 팬아웃되고 비용·대기 시간·책임 범위가 달라질 수 있다. 반대로 프롬프트가 “단독 수행”을 요구하면, 그 작업자는 받은 맥락 안에서 한 번의 응답을 완성해야 한다.

### 좁은 배경

이 커밋은 잡(job)으로 실행되는 전문 작업자와, 잡을 시작하지 못했을 때 같은 세션에서 대신 실행되는 fallback 페르소나를 함께 다룬다. `agent-council`의 Codex·GLM·GPT 프롬프트는 각 평의원 관점을 만들고, `agent-council/prompts/default.md`는 평의원 잡이 없을 때 여러 관점을 한 응답에서 다루는 fallback이다. `design-review`와 `diagnose`의 `default.md`도 각각 잡 시작 실패 시 읽는 in-session fallback이며, `slides-review/prompts/gemini.md`는 HTML 슬라이드 디자인을 검토하는 Gemini 작업자 프롬프트다.

## Intuition

핵심은 “한 작업자가 답을 만들 때, 작업 트리를 더 늘리지 않는다”는 계약을 모든 해당 프롬프트에 같은 강도로 적는 것이다.

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem;margin:1rem 0">
  <div style="border:1px solid #d0d7de;border-radius:.5rem;padding:1rem">
    <strong>Before</strong><br>
    <span style="font-family:ui-monospace,monospace">job-42 → worker-A → child-1, child-2</span><br>
    작업자 A가 답을 내기 전에 하위 작업 2개를 만들 수도 있었다.
  </div>
  <div style="border:1px solid #2b5fa8;border-radius:.5rem;padding:1rem">
    <strong>After</strong><br>
    <span style="font-family:ui-monospace,monospace">job-42 → worker-A → answer</span><br>
    같은 <span style="font-family:ui-monospace,monospace">job-42</span>에서 worker-A는 하위 작업자 0명으로 자신의 관점 또는 검토 결과를 완성한다.
  </div>
</div>

여기서 toy 값 `job-42`, `child-1`, `child-2`, 그리고 “하위 작업자 0명”은 코드의 식별자가 아니라 실행 경계를 보여 주는 예시다. 변경 후 `job-42`의 worker-A는 `child-1`·`child-2`를 만들지 않고 답을 직접 반환한다. 따라서 이 커밋은 결과 형식이나 분석 내용이 아니라, 결과에 도달하는 작업자 수를 제한한다.

## Code

## Change Group 1: 평의원 응답을 단일 작업자 안에서 끝낸다

> 예고: 각 모델별 평의원 프롬프트가 독립된 관점을 직접 작성하게 만든다.
> 순서: 먼저 실제로 개별 관점을 생산하는 평의원 작업자의 경계를 고정해야, 뒤이어 다룰 fallback도 같은 경계를 따르게 된다.

### `skills/agent-council/prompts/codex.md`

**역할/변경 전 맥락** — Codex 평의원은 구현 가능성·비용·API 설계를 평가하고 실용성 중심의 관점을 냈다. (`base:skills/agent-council/prompts/codex.md:3`)

**무엇이 바뀌었나** — `Constraints` 첫 항목으로 `Argue your perspective alone — do not spawn any subagents`를 추가했다. (`head:skills/agent-council/prompts/codex.md:6`)

**왜 필요한가** — [근거: "chore: 잡 워커 프롬프트에 단독 수행 지시 추가"]

**시스템 효과** — Codex 평의원은 구현 현실성에 대한 자기 관점을 쓰되, 그 판단을 위해 추가 작업자를 만들지 않는다.

**추적성** — `skills/agent-council/prompts/codex.md:6`

### `skills/agent-council/prompts/glm.md`

**역할/변경 전 맥락** — GLM 평의원은 단일 독립 의견을 내고 다른 구성원의 관점을 종합하거나 예상하지 말라는 제약을 이미 가졌다. (`base:skills/agent-council/prompts/glm.md:6`)

**무엇이 바뀌었나** — 그 독립 의견 제약 바로 앞에 `Argue your perspective alone — do not spawn any subagents`를 추가했다. (`head:skills/agent-council/prompts/glm.md:6`)

**왜 필요한가** — [근거: "chore: 잡 워커 프롬프트에 단독 수행 지시 추가"]

**시스템 효과** — “다른 멤버를 예상하지 않는 독립 의견”이 실행 방식에서도 독립적으로 유지된다.

**추적성** — `skills/agent-council/prompts/glm.md:6`

### `skills/agent-council/prompts/gpt.md`

**역할/변경 전 맥락** — GPT 평의원은 근거를 인용해 독립 의견을 내며, 한 턴의 완전한 응답을 요구받았다. 다만 기존 문구는 필요한 경우 하위 작업을 foreground에서 실행하고 기다리는 것을 허용했다. (`base:skills/agent-council/prompts/gpt.md:13`)

**무엇이 바뀌었나** — 새 단독 수행 금지문을 넣고, 완료 규칙에서 `If you delegate or spawn sub-work, run it in the foreground and wait for it to finish before answering`을 제거했다. (`head:skills/agent-council/prompts/gpt.md:14`)

**왜 필요한가** — [근거: "chore: 잡 워커 프롬프트에 단독 수행 지시 추가"]

**시스템 효과** — 이 파일은 단순 추가가 아니라, 이전의 조건부 위임 경로를 명시적 금지로 교체한다. 따라서 다른 두 평의원과 같은 실행 계약이 된다.

**추적성** — `skills/agent-council/prompts/gpt.md:14`

## Change Group 2: 평의원과 분석 fallback도 앞선 단독 수행 계약을 이어받는다

> 예고: 앞 그룹에서 각 평의원에게 준 단독 수행 계약을, 잡이 없을 때 대체하는 in-session 자문·검토·진단 경로까지 연결한다.
> 순서: 이들은 앞 그룹의 개별 평의원 작업을 대신하거나 같은 유형의 분석을 수행하므로, 평의원 계약을 먼저 정한 뒤 같은 경계를 적용해야 한다.

### `skills/agent-council/prompts/default.md`

**역할/변경 전 맥락** — 평의원 전체를 사용할 수 없을 때, 한 senior staff advisor가 여러 관점을 steelman하고 synthesis하는 fallback 프롬프트다. (`base:skills/agent-council/prompts/default.md:13`)

**무엇이 바뀌었나** — `Response Discipline` 맨 앞에 `Argue your perspective alone — do not spawn any subagents.`를 추가했다. (`head:skills/agent-council/prompts/default.md:17`)

**왜 필요한가** — [근거: "chore: 잡 워커 프롬프트에 단독 수행 지시 추가"]

**시스템 효과** — 이 fallback은 여러 관점을 한 응답 안에서 논증할 수는 있지만, 그 관점을 만들기 위해 별도 하위 작업자를 늘리지는 않는다.

**추적성** — `skills/agent-council/prompts/default.md:17`

### `skills/design-review/prompts/default.md`

**역할/변경 전 맥락** — READ-ONLY 설계 검토 fallback은 근거 있는 권고를 한 턴에 완성하되, 기존에는 위임을 foreground에서 기다리라는 조건이 있었다. (`base:skills/design-review/prompts/default.md:17`)

**무엇이 바뀌었나** — `Work this review alone — do not spawn any subagents.`를 추가하고, 기존의 조건부 위임·대기 문구를 제거했다. (`head:skills/design-review/prompts/default.md:18`)

**왜 필요한가** — [근거: "chore: 잡 워커 프롬프트에 단독 수행 지시 추가"]

**시스템 효과** — fallback으로 들어간 설계 검토도 멤버 잡과 별개로 하위 작업을 생성하지 않으며, 현재 세션에서 검토를 마친다.

**추적성** — `skills/design-review/prompts/default.md:18`

### `skills/diagnose/prompts/default.md`

**역할/변경 전 맥락** — READ-ONLY 진단 fallback은 근거와 `file:line`을 요구하며, 기존에는 필요 시 하위 작업을 foreground에서 수행하도록 허용했다. (`base:skills/diagnose/prompts/default.md:17`)

**무엇이 바뀌었나** — `Work this analysis alone — do not spawn any subagents.`를 추가하고, 조건부 위임·대기 문구를 단일 턴 완결 문구로 바꿨다. (`head:skills/diagnose/prompts/default.md:18`)

**왜 필요한가** — [근거: "chore: 잡 워커 프롬프트에 단독 수행 지시 추가"]

**시스템 효과** — 진단 fallback은 원인 분석을 직접 수행하고, 분석 도중 별도의 하위 분석 트리를 만들지 않는다.

**추적성** — `skills/diagnose/prompts/default.md:18`

## Change Group 3: 시각 검토 워커까지 같은 실행 경계를 확장한다

> 예고: 앞선 자문·분석 경계를 완성한 뒤, HTML 슬라이드에 대한 Gemini 시각 검토에도 동일한 단독 수행 규칙을 적용한다.
> 순서: 앞 두 그룹이 일반 분석 작업자의 계약을 정했으므로, 다른 산출물을 다루는 시각 검토 워커를 마지막으로 같은 계약에 맞춘다.

### `skills/slides-review/prompts/gemini.md`

**역할/변경 전 맥락** — Gemini는 HTML scrollytelling 프레젠테이션을 보고 CSS/HTML 개선 지시를 최대 10개까지 반환하는 디자인 검토 작업자다. (`base:skills/slides-review/prompts/gemini.md:1`)

**무엇이 바뀌었나** — `Rules`의 첫 줄로 `Review this deck alone — do not spawn any subagents`를 추가했다. (`head:skills/slides-review/prompts/gemini.md:58`)

**왜 필요한가** — [근거: "chore: 잡 워커 프롬프트에 단독 수행 지시 추가"]

**시스템 효과** — 디자인 검토의 범위와 최대 10개 지시라는 기존 출력 계약은 유지하면서, 그 지시를 만들기 위한 추가 작업자 생성만 금지한다.

**추적성** — `skills/slides-review/prompts/gemini.md:58`

## Quiz

대화형 출제와 채점은 이 측정의 실행 조건에 따라 진행하지 않는다. 아래는 이후 독자가 문서를 읽은 뒤 답할 서술형 문항 뱅크다. 모든 concept는 필수다. 총 7개여서 20개 상한에 걸리지 않았고, 잘라낸 concept는 없다.

### Concept `evidence-signal-files` — required

**문항** — 이 커밋에서 noise 파일이 없는 이유와, signal로 분류한 파일 수를 설명해 보세요.

**정답 루브릭**

1. 7개 파일 모두 프롬프트의 작업자 실행 경계를 바꾸므로 signal이라고 말한다.
2. `skills/slides-review/prompts/gemini.md`를 signal 파일 중 하나로 구체적으로 든다.

### Concept `background-job-boundary` — required

**문항** — job으로 실행되는 작업자와 in-session fallback을 구분하고, 이 변경이 둘 모두에 적용돼야 하는 이유를 설명해 보세요.

**정답 루브릭**

1. job은 전문 작업자를 실행하고, fallback은 job 시작 실패 시 같은 세션에서 대신 실행된다고 설명한다.
2. `agent-council/prompts/default.md`가 fallback 경로라는 구체 파일을 든다.

### Concept `intuition-worker-count` — required

**문항** — `job-42` 예시에서 변경 전후 작업 트리가 어떻게 달라지며, 어떤 수가 0이 되는지 설명해 보세요.

**정답 루브릭**

1. 변경 전에는 worker-A가 `child-1`, `child-2`를 만들 수 있었고, 변경 후에는 답을 직접 반환한다고 말한다.
2. 변경 후 하위 작업자 수가 0명이라고 말한다.

### Concept `code-council-members` — required

**문항** — 평의원 프롬프트 세 개 중 기존의 조건부 위임 허용 문구를 실제로 제거한 파일은 무엇이며, 새 제약은 어느 줄에 있는지 답해 보세요.

**정답 루브릭**

1. `skills/agent-council/prompts/gpt.md`라고 답한다.
2. 새 단독 수행 제약의 위치가 `head:skills/agent-council/prompts/gpt.md:14`라고 답한다.

### Concept `code-council-fallback` — required

**문항** — `agent-council`의 default fallback은 여러 관점을 어떻게 다루면서도 하위 에이전트 생성은 어떻게 제한하나요?

**정답 루브릭**

1. 한 senior staff advisor가 여러 관점을 steelman하고 synthesis한다고 말한다.
2. `head:skills/agent-council/prompts/default.md:17`의 단독 수행 제약 또는 해당 정확한 파일·줄을 든다.

### Concept `code-analysis-fallbacks` — required

**문항** — `design-review`와 `diagnose` fallback에서 바뀐 위임 규칙과, 두 프롬프트가 공통으로 유지하는 응답 방식 한 가지를 설명해 보세요.

**정답 루브릭**

1. 둘 다 하위 에이전트를 생성하지 않고 검토/분석을 단독 수행하도록 바뀌었다고 말한다.
2. 둘 다 한 번의 완전한 응답을 낸다고 말하거나, `head:skills/design-review/prompts/default.md:19` 또는 `head:skills/diagnose/prompts/default.md:19`를 든다.

### Concept `code-slides-worker` — required

**문항** — Gemini 슬라이드 검토 워커에서 새 규칙이 추가된 섹션과 줄 번호를 답하고, 기존 출력 계약 중 유지되는 수량 제한을 말해 보세요.

**정답 루브릭**

1. `Rules` 섹션의 `head:skills/slides-review/prompts/gemini.md:58`이라고 답한다.
2. 최대 10개 directives 제한이 유지된다고 말한다.

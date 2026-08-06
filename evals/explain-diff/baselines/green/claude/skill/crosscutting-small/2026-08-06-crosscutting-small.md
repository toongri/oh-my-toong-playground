# 잡 워커 프롬프트에 단독 수행 지시 추가 (`1c4e0292`)

대상 range: `1c4e0292^..1c4e0292` · 7 files changed, 10 insertions(+), 3 deletions(-)

## Evidence

이 diff가 건드린 파일은 7개이고, **전부 signal**이다. noise로 분류된 파일은 0건이다.
noise 기본 규칙표(`*.lock`, `dist/`, `__snapshots__/`, `*.generated.*`, 포맷팅만 바뀐 hunk)에
걸리는 파일이 하나도 없고, 규칙표 밖의 파일을 임의로 noise로 내린 것도 없다.

| 파일 | 분류 | 사유 |
|---|---|---|
| `skills/agent-council/prompts/codex.md` | signal | 워커에게 전달되는 역할 프롬프트 본문 변경 |
| `skills/agent-council/prompts/default.md` | signal | 워커에게 전달되는 역할 프롬프트 본문 변경 |
| `skills/agent-council/prompts/glm.md` | signal | 워커에게 전달되는 역할 프롬프트 본문 변경 |
| `skills/agent-council/prompts/gpt.md` | signal | 기존 지침 문장 1줄을 교체 — 의미가 뒤집힌다 |
| `skills/design-review/prompts/default.md` | signal | 기존 지침 문장 1줄을 교체 — 의미가 뒤집힌다 |
| `skills/diagnose/prompts/default.md` | signal | 기존 지침 문장 1줄을 교체 — 의미가 뒤집힌다 |
| `skills/slides-review/prompts/gemini.md` | signal | 워커에게 전달되는 역할 프롬프트 본문 변경 |

## Background

### 깊은 배경
이미 익숙하면 건너뛰세요.

이 저장소(oh-my-toong, 이하 OMT)는 여러 AI CLI를 **잡(job)** 으로 띄워 병렬로 일을 시킨다.
잡 하나는 설정 YAML에 선언된 **멤버(member)** 들을 각각 별도 CLI 프로세스로 스폰한다.
예를 들어 `skills/agent-council/council.config.yaml`은 멤버 셋을 선언한다 — `claude`(`claude -p`),
`gpt`(`codex exec`), `glm`(`opencode run`).

멤버가 실제로 무엇을 하는지는 두 채널이 정한다.

- **프롬프트 채널** — `lib/worker-utils.ts`의 `assemblePrompt()`가 `prompts/{멤버이름}.md`를
  찾아 읽고, 없으면 `prompts/default.md`로 폴백한다(`lib/worker-utils.ts:104-108`).
  읽어낸 내용은 `<system-instructions>` 블록에 감싸여 CLI에 넘어간다. 이것은 **말**이다 —
  모델이 따를 수도, 안 따를 수도 있다.
- **설정 채널** — `lib/generic-job.ts`의 `buildAugmentedCommand()`가 잡 설정의
  `settings.deny` 선언을 읽어 CLI별 실행 플래그로 번역한다. 이것은 **환경**이다 —
  도구 자체가 세션에서 사라지므로 모델의 협조가 필요 없다.

설정 채널에는 결정적인 제약이 하나 있다. `lib/generic-job.ts`는 번역 가능한 CLI를
세 개로 못박아 둔다.

```ts
const ENFORCEABLE_CLI_TYPES = ["codex", "claude", "opencode"];
```

이 목록 밖의 CLI(예: `gemini`)를 쓰는 멤버는 설정 채널로 아무것도 막을 수 없다.

### 좁은 배경

이 커밋 바로 앞의 세 커밋이 "워커가 자기 밑으로 서브에이전트를 또 스폰하는 것"을
설정 채널로 막는 배관을 깔았다.

| 커밋 | 한 일 |
|---|---|
| `36f550d5` | `settings.deny`에 `subagents` 축(boolean)을 신설. codex는 `-c agents.enabled=false`, claude는 `--settings`의 `permissions.deny: ["Agent","Task"]`, opencode는 `permission.task: deny`로 번역 |
| `4d81c763` | 그 배관을 `design-review`·`diagnose` 잡에 이식 |
| `2bd75617` | 잡 config 4종의 deny 선언을 같은 모양으로 통일. `orchestrate-review`의 멤버 command에 박혀 있던 `-c agents.enabled=false`를 `subagents: true` 선언으로 승격 |

그리고 이 정책이 어느 쪽 채널을 언제 쓰는지는 이미 7일 전 커밋 `9b52fba8`에
글로 남아 있다. 그 커밋은 `orchestrate-review`에서 **정반대 방향**의 일을 했다 —
설정 채널이 닿는 5개 디스패치 프롬프트에서는 금지 문구를 **지웠고**, 설정이 닿지 않는
자리 하나에서만 **남겼다**.

> `9b52fba8` 커밋 메시지: "디스패치되는 5개 프롬프트의 금지 문구는 이제 불필요해
> 제거하되, 지휘자 세션이 직접 채택하는 in-session 폴백(prompts/default.md)은
> 설정이 닿지 않으므로 문구를 유지."

이번 커밋은 그 반대편, 즉 **설정 채널이 아직 닿지 않는 자리**들을 프롬프트 채널로
메우는 작업이다.

이 시점에 `subagents: true`를 선언한 config는 셋뿐이다 —
`orchestrate-review`, `design-review`, `diagnose`. `agent-council`과 `slides-review`는
선언이 없다.

## Intuition

이 변경의 본질은 한 문장이다. **설정으로 막을 수 있는 워커와 없는 워커를
같은 규율 아래 세우되, 막을 수 없는 쪽은 말로 세운다.**

구체적인 두 워커를 놓고 보자.

`slides-review` 잡은 멤버가 하나다. 이름은 `gemini`, 커맨드는 `gemini`, `timeout: 240`이다.
`gemini`는 위에서 본 `ENFORCEABLE_CLI_TYPES = ["codex", "claude", "opencode"]` 목록에 없다.
그래서 이 워커에게 서브에이전트 스폰을 막을 **설정 레버는 0개**다. `240`초 동안 이 워커가
자기 밑으로 무엇을 띄우든 잡은 알지 못하고 막지도 못한다. 남은 수단은 프롬프트 한 줄뿐이다.

`design-review` 잡은 멤버가 하나다. 이름은 `gpt`, 커맨드는 `codex exec`, `timeout: 1200`이다.
`codex`는 목록 안에 있고, 이 잡의 config는 `subagents: true`를 선언한다. 그래서
`buildAugmentedCommand()`가 `-c agents.enabled=false`를 붙이고, 스폰 도구 자체가
세션에서 사라진다. 여기서는 설정 레버가 **1개** 있다.

<div style="border:1px solid #bbb;border-radius:8px;padding:0.9rem 1rem;margin:1.2rem 0"><strong>그림 1 — Before / After: 같은 자리, 뒤집힌 의미</strong><br><br><div style="display:flex;gap:0.75rem;flex-wrap:wrap"><div style="flex:1;min-width:16rem;border:1px solid #c99;border-radius:6px;padding:0.6rem 0.75rem"><div style="font-size:0.8rem;color:#888;margin-bottom:0.35rem">BEFORE &nbsp;<code>base:skills/design-review/prompts/default.md:18</code></div><div class="code" style="font-size:0.82rem">- Deliver one complete response in a single turn. <b>If you delegate or spawn sub-work, run it in the foreground and wait for it to finish before answering</b> — never pause mid-turn …</div><div style="font-size:0.8rem;color:#a44;margin-top:0.45rem">→ 위임을 <b>허용</b>하고 실행 방식만 규정한다</div></div><div style="flex:1;min-width:16rem;border:1px solid #9b9;border-radius:6px;padding:0.6rem 0.75rem"><div style="font-size:0.8rem;color:#888;margin-bottom:0.35rem">AFTER &nbsp;<code>head:skills/design-review/prompts/default.md:18-19</code></div><div class="code" style="font-size:0.82rem">- <b>Work this review alone — do not spawn any subagents.</b><br>- Deliver one complete response in a single turn. Do not pause mid-turn …</div><div style="font-size:0.8rem;color:#484;margin-top:0.45rem">→ 위임을 <b>금지</b>하고, 남은 문장은 턴 규율만 말한다</div></div></div></div>

한 줄이 늘어난 게 아니라 **한 줄이 갈라졌다.** 원래 문장은 "위임해도 된다, 단 포그라운드로"와
"한 턴에 끝내라"를 한 문장에 담고 있었다. 앞 절이 제거되고 금지 문장이 새 항목으로 서면서,
뒤 문장은 순수한 턴 규율만 남는다.

<div style="border:1px solid #bbb;border-radius:8px;padding:0.9rem 1rem;margin:1.2rem 0"><strong>그림 2 — 두 채널이 워커에 도달하는 경로 (예시 값 포함)</strong><br><br><div class="code" style="font-size:0.82rem;line-height:1.9">설정 채널 ─ design-review.config.yaml<br>&nbsp;&nbsp;&nbsp;&nbsp;<code>settings.deny.subagents: true</code><br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│ buildAugmentedCommand(cliType="codex")<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;▼<br>&nbsp;&nbsp;&nbsp;&nbsp;<code>codex exec -m gpt-5.6-sol -c agents.enabled=false …</code><br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;▼<br>&nbsp;&nbsp;&nbsp;&nbsp;스폰 도구 서술 자체가 세션에서 <b>제거됨</b> — 모델 협조 불필요<br><br>프롬프트 채널 ─ prompts/default.md<br>&nbsp;&nbsp;&nbsp;&nbsp;<code>- Work this review alone — do not spawn any subagents.</code><br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│ assemblePrompt(entityName="gpt") → gpt.md 없음 → default.md 폴백<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;▼<br>&nbsp;&nbsp;&nbsp;&nbsp;<code>&lt;system-instructions&gt; … &lt;/system-instructions&gt;</code><br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;▼<br>&nbsp;&nbsp;&nbsp;&nbsp;모델이 <b>읽고 따르기를 기대</b> — 강제력 없음<br><br>slides-review 의 gemini 멤버: 위쪽 경로가 <b>통째로 없음</b><br>&nbsp;&nbsp;&nbsp;&nbsp;("gemini" ∉ ["codex", "claude", "opencode"]) → 아래쪽 한 줄이 전부</div></div>

`gemini` 워커에게 `240`초를 준 잡에서, 설정 경로가 통째로 비어 있다는 사실이 이 커밋의
동기를 그대로 설명한다. `design-review`의 `gpt` 워커는 `-c agents.enabled=false`가
말을 안 들어도 도구를 뺏지만, `slides-review`의 `gemini` 워커는 프롬프트 문장이
설득에 실패하면 그걸로 끝이다.

<div style="border:1px solid #bbb;border-radius:8px;padding:0.9rem 1rem;margin:1.2rem 0"><strong>그림 3 — 파일 지도: 이 커밋이 닿은 곳과 닿지 않은 곳</strong><br><br><div class="code" style="font-size:0.82rem;line-height:1.85">skills/<br>├── agent-council/<br>│&nbsp;&nbsp;&nbsp;├── council.config.yaml&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#a44">deny.subagents 선언 없음</span><br>│&nbsp;&nbsp;&nbsp;└── prompts/<br>│&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├── default.md&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#484">✓ 변경</span>&nbsp;&nbsp;(그룹 1)<br>│&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├── glm.md&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#484">✓ 변경</span>&nbsp;&nbsp;(그룹 1) ← 멤버 glm<br>│&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├── codex.md&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#484">✓ 변경</span>&nbsp;&nbsp;(그룹 1) ← 동명 멤버 없음<br>│&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├── gpt.md&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#484">✓ 변경</span>&nbsp;&nbsp;(그룹 2) ← 멤버 gpt<br>│&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└── claude.md&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#a44">✗ 미변경</span> ← 멤버 claude<br>├── design-review/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#484">subagents: true 있음</span><br>│&nbsp;&nbsp;&nbsp;└── prompts/default.md&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#484">✓ 변경</span>&nbsp;&nbsp;(그룹 2)<br>├── diagnose/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#484">subagents: true 있음</span><br>│&nbsp;&nbsp;&nbsp;└── prompts/default.md&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#484">✓ 변경</span>&nbsp;&nbsp;(그룹 2)<br>├── slides-review/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#a44">deny 선언 자체가 없음</span><br>│&nbsp;&nbsp;&nbsp;└── prompts/gemini.md&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#484">✓ 변경</span>&nbsp;&nbsp;(그룹 1)<br>└── orchestrate-review/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#484">subagents: true 있음</span><br>&nbsp;&nbsp;&nbsp;&nbsp;└── prompts/default.md&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#888">이미 보유 (9b52fba8)</span></div></div>

<div style="border:1px solid #bbb;border-radius:8px;padding:0.9rem 1rem;margin:1.2rem 0"><strong>그림 4 — 잡별 차단 레버 상태 전이</strong><br><br><div class="code" style="font-size:0.82rem;line-height:1.9">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;36f550d5·4d81c763·2bd75617&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;1c4e0292 (이 커밋)<br>[레버 0개] ────────────────────────────▶ [설정 1개] ────────────────────▶ [설정 1 + 프롬프트 1]<br>&nbsp;&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;design-review, diagnose<br>&nbsp;&nbsp;&nbsp;&nbsp;│<br>&nbsp;&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;1c4e0292 (이 커밋)<br>&nbsp;&nbsp;&nbsp;&nbsp;└──────────────────────────────────────────────────────▶ [프롬프트 1개]<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;agent-council, slides-review<br><br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(agent-council/prompts/claude.md 은 여기<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;도달하지 못하고 [레버 0개]에 남는다)</div></div>

## Change Group 1: 설정 레버가 없는 자리에 금지 문장을 새로 심는다

> 예고: 잡 설정으로는 스폰을 막을 방법이 아예 없는 워커 프롬프트 4개에, 지금까지 없던
> 단독 수행 지시를 한 줄씩 새로 넣는다.
> 순서: 이 그룹이 먼저인 이유는 여기서 심는 문장이 이 커밋이 쓰는 **표준 문형**이기 때문이다 —
> 뒤 그룹은 이 문형을 기존 문장에 덮어쓰는 작업이라, 문형이 먼저 정의돼야 무엇이 덮였는지 보인다.

### `skills/slides-review/prompts/gemini.md`

**역할/변경 전 맥락** — `slides-review` 잡의 유일한 멤버 `gemini`가 읽는 역할 프롬프트다.
`## Rules` 섹션이 리뷰 산출물의 형태를 규정하는데, 여기 스폰 관련 항목은 없었다
(`base:skills/slides-review/prompts/gemini.md:57-58`).

**무엇이 바뀌었나** — `## Rules` 목록의 **첫 항목**으로
`- Review this deck alone — do not spawn any subagents` 가 삽입됐다. 기존 첫 항목이던
`- Maximum 10 directives, prioritized by visual impact`는 그대로 한 줄 밀렸다
(`head:skills/slides-review/prompts/gemini.md:58`).

**왜 필요한가** — [추론: `skills/slides-review/review.config.yaml`은 `settings`에
`timeout: 240`만 두고 `deny` 선언 자체가 없으며, 멤버 커맨드가 `gemini`다.
`lib/generic-job.ts`의 `ENFORCEABLE_CLI_TYPES = ["codex", "claude", "opencode"]`에
`gemini`가 없으므로 `buildAugmentedCommand`가 번역할 플래그가 존재하지 않는다.
설정 채널로는 도달할 수 없는 워커이므로 프롬프트가 유일한 수단이다.]

**시스템 효과** — 강제력은 없다. 이 워커는 여전히 스폰할 수 있고, 잡은 그것을 탐지하지도
차단하지도 못한다. 바뀐 것은 "지시를 받지 않았다"가 더 이상 변명이 아니게 된 것뿐이다.

**추적성** — `skills/slides-review/prompts/gemini.md:58`

### `skills/agent-council/prompts/default.md`

**역할/변경 전 맥락** — 카운슬 멤버 중 자기 이름의 프롬프트 파일이 없는 멤버가
`assemblePrompt`의 폴백으로 읽는 파일이다. `## Response Discipline` 섹션이
답변 규율을 나열했고, 첫 항목은 근거 규율이었다
(`base:skills/agent-council/prompts/default.md:15-18`).

**무엇이 바뀌었나** — `## Response Discipline`의 **첫 항목**으로
`- Argue your perspective alone — do not spawn any subagents.` 가 삽입됐다
(`head:skills/agent-council/prompts/default.md:17`).

**왜 필요한가** — [추론: `skills/agent-council/council.config.yaml`의 `settings.deny`에는
`skills` 목록만 있고 `subagents` 키가 없다. `extractDenySubagents`는 미선언을 `false`로
읽으므로(`lib/generic-job.ts`, "Unset = false"), 이 잡의 어떤 멤버에게도 스폰 차단
플래그가 붙지 않는다. 멤버 CLI 자체는 셋 다 번역 가능한 종류인데도 선언이 없어서
설정 채널이 비어 있는 경우다.]

**시스템 효과** — 이 파일은 폴백이므로, 이름이 같은 프롬프트 파일이 없는 미래의 멤버가
추가되면 자동으로 이 규율을 물려받는다. 이 그룹에서 유일하게 **미래의 멤버까지 덮는** 자리다.

**추적성** — `skills/agent-council/prompts/default.md:17`

### `skills/agent-council/prompts/glm.md`

**역할/변경 전 맥락** — 카운슬 멤버 `glm`(`opencode run`, 모델 `opencode-go/glm-5.2`)이
읽는 역할 프롬프트다. `Constraints:` 목록이 독립 의견·가정 도전·대안 제시를 요구했다
(`base:skills/agent-council/prompts/glm.md:5-6`).

**무엇이 바뀌었나** — `Constraints:`의 **첫 항목**으로
`- Argue your perspective alone — do not spawn any subagents` 가 삽입됐다. 마침표 없는
형태로, 이 파일의 기존 항목들과 문장부호를 맞췄다
(`head:skills/agent-council/prompts/glm.md:6`).

**왜 필요한가** — [추론: 위 `default.md`와 동일한 근거다. `council.config.yaml`에
`deny.subagents` 선언이 없어, `opencode`가 번역 가능한 CLI임에도 이 멤버에게 붙는
`permission.task: deny`가 없다.]

**시스템 효과** — 멤버별 파일이 있으면 폴백이 읽히지 않으므로, `default.md`에만 넣었다면
`glm` 멤버는 이 규율을 전혀 보지 못했을 것이다. 이 항목이 그 구멍을 막는다.

**추적성** — `skills/agent-council/prompts/glm.md:6`

### `skills/agent-council/prompts/codex.md`

**역할/변경 전 맥락** — 구현 실현성 평가를 강점으로 내세우는 카운슬 멤버용 프롬프트다.
`Constraints:` 목록의 첫 항목은 구현 실용성 요구였다
(`base:skills/agent-council/prompts/codex.md:5-6`).

**무엇이 바뀌었나** — `Constraints:`의 **첫 항목**으로
`- Argue your perspective alone — do not spawn any subagents` 가 삽입됐다
(`head:skills/agent-council/prompts/codex.md:6`).

**왜 필요한가** — [추론: 형제 파일 `glm.md`·`gpt.md`와 문장·위치가 동일하고, 같은 커밋에
같은 형태로 들어왔다. 카운슬 프롬프트 전체를 한 벌로 맞추는 일괄 적용으로 읽힌다.]

**시스템 효과** — 현재 `council.config.yaml`이 선언한 멤버 이름은 `claude`·`gpt`·`glm`
셋이고 `codex`는 없다. `assemblePrompt`는 `prompts/{멤버이름}.md`를 찾으므로, 이 파일은
**지금 배선으로는 아무 워커에게도 읽히지 않는다.** 실효는 0이고, `codex` 이름의 멤버가
생기는 날에 발효되는 예약분이다.

**추적성** — `skills/agent-council/prompts/codex.md:6`

## Change Group 2: 위임을 허용하던 문장을 금지로 교체한다

> 예고: 앞 그룹이 정의한 그 문형을, 이번에는 빈자리가 아니라 **이미 반대 방향을 말하고 있던
> 문장 위에** 얹는다. 순수 추가였던 앞의 4개와 달리 여기 3개는 기존 한 줄이 두 줄로 갈라진다.
> 순서: 앞 그룹에서 심은 문장을 알고 있어야, 여기서 사라진 절이 무엇으로 대체됐는지가 보인다 —
> 문형을 모르면 이 그룹은 그냥 "문장 하나가 짧아졌다"로만 읽힌다.

### `skills/agent-council/prompts/gpt.md`

**역할/변경 전 맥락** — 카운슬 멤버 `gpt`(`codex exec`, 모델 `gpt-5.6-sol`, effort `high`)가
읽는 프롬프트다. `## Response Discipline`의 마지막 항목이 한 문장 안에서 두 가지를
말하고 있었다 — 한 턴에 끝낼 것, 그리고 위임한다면 포그라운드로 할 것
(`base:skills/agent-council/prompts/gpt.md:14`).

**무엇이 바뀌었나** — 그 한 줄이 두 줄로 갈라졌다. 앞에
`- Argue your perspective alone — do not spawn any subagents.` 가 서고, 원래 문장에서
`If you delegate or spawn sub-work, run it in the foreground and wait for it to finish
before answering — never pause mid-turn` 절이 빠지면서 뒤 문장은
`- Deliver one complete response in a single turn. Do not pause mid-turn or split your
answer across multiple turns expecting to be resumed.` 로 축약됐다
(`head:skills/agent-council/prompts/gpt.md:14-15`).

**왜 필요한가** — [추론: 제거된 절은 위임을 전제로 그 **실행 방식**을 규정한다. 앞줄의
금지와 같은 문서에 남으면 워커는 "스폰하지 마라"와 "스폰하면 포그라운드로"를 동시에 받는다.
금지를 넣으면서 이 절을 남기지 않은 것은 그 모순을 없애기 위한 것으로 읽힌다.]

**시스템 효과** — 뒤 문장의 의미가 좁아졌다. 원래는 스폰 실행 방식 + 턴 분할 금지를 함께
말했지만, 이제 순수하게 "한 턴에 끝내라"만 남는다.

**추적성** — `skills/agent-council/prompts/gpt.md:14`

### `skills/design-review/prompts/default.md`

**역할/변경 전 맥락** — `design-review` 잡의 유일한 멤버 `gpt`(`codex exec`,
`timeout: 1200`)가 읽는 프롬프트다. 위 `gpt.md`와 **글자 그대로 같은 문장**이
`## Response Discipline`에 있었다(`base:skills/design-review/prompts/default.md:18`).

**무엇이 바뀌었나** — 같은 방식으로 두 줄이 됐고, 새 문장은 이 스킬의 역할에 맞춰
`- Work this review alone — do not spawn any subagents.` 로 표현됐다
(`head:skills/design-review/prompts/default.md:18-19`).

**왜 필요한가** — [근거: `skills/design-review/design-review.config.yaml`의
`deny.subagents` 주석 — "Subagent axis: the reviewer answers the design question alone.
Spawning is a second fan-out beneath this one — unbudgeted cost, and counsel no review
prompt shaped."]

**시스템 효과** — 이 잡은 설정 채널이 이미 `-c agents.enabled=false`로 도구를 제거한다.
따라서 이 프롬프트 줄은 차단을 **추가하지 않는다.** 하는 일은 반대쪽이다 — 도구가 없는
환경에서 "위임하면 포그라운드로"라고 지시하던 옛 문장이 존재하지 않는 도구를 가리키고
있었고, 그 불일치를 제거한다.

**추적성** — `skills/design-review/prompts/default.md:18`

### `skills/diagnose/prompts/default.md`

**역할/변경 전 맥락** — `diagnose` 잡의 유일한 멤버 `hephaestus`
(`opencode run --agent "Hephaestus - Deep Agent"`, `timeout: 600`)가 읽는 프롬프트다.
멤버 이름과 같은 프롬프트 파일이 없으므로 이 폴백이 읽힌다. 여기에도 같은 문장이 있었다
(`base:skills/diagnose/prompts/default.md:18`).

**무엇이 바뀌었나** — 같은 분리가 일어났고, 새 문장은
`- Work this analysis alone — do not spawn any subagents.` 다
(`head:skills/diagnose/prompts/default.md:18-19`).

**왜 필요한가** — [근거: `skills/diagnose/diagnose.config.yaml`의 `deny.subagents` 주석 —
"Subagent axis: the analyst diagnoses alone. Spawning is a second fan-out beneath this one
— unbudgeted cost, and findings no analysis prompt shaped."]

**시스템 효과** — `design-review`와 동일하되 번역 결과가 다르다. 이 멤버의 CLI는
`opencode`이므로 설정 채널이 내는 것은 `-c agents.enabled=false`가 아니라
`permission.task: deny`다. 프롬프트 쪽 문장은 CLI 종류와 무관하게 동일하다.

**추적성** — `skills/diagnose/prompts/default.md:18`

## 열린 질문

문서 안에 남긴다. 근거가 도달 범위 안에 없어서 확정하지 못한 것들이다.

**1. `agent-council/prompts/claude.md`는 왜 빠졌나 — Unknown / not supplied**

`council.config.yaml`은 멤버 `claude`(`claude -p`)를 선언하고,
`assemblePrompt`는 `prompts/claude.md`를 우선 찾으므로 이 멤버는 폴백 `default.md`를
읽지 않는다. 그런데 `prompts/claude.md`에는 단독 수행 지시가 없고, 이 커밋도 건드리지
않았다. 카운슬 config에 `deny.subagents` 선언도 없다. 즉 이 멤버는 설정 레버도 프롬프트
문장도 없이 남는다 — 이 커밋이 메우려 한 바로 그 상태다.

동시에 이 커밋은 **동명 멤버가 존재하지 않는** `prompts/codex.md`에는 문장을 넣었다.
빠진 쪽이 의도인지 누락인지 판단할 근거가 diff·커밋 메시지·주석 어디에도 없다.

**2. `design-review`·`diagnose`에서 프롬프트 줄이 설정과 중복되는 것을 어떻게 정당화했나 — Unknown / not supplied**

`9b52fba8`은 정확히 반대 방향을 택했다 — 설정이 닿는 프롬프트에서는 금지 문구를
"이제 불필요해 제거"했다. 이 커밋은 설정이 닿는 두 잡에도 문구를 넣는다. 두 결정이
공존할 수 있는 이유(옛 문장의 모순 제거가 목적이었다든지, 정책이 바뀌었다든지)는
추론은 되지만 어디에도 적혀 있지 않다.

## 이해도 퀴즈 (문항 뱅크)

필수 개념 7개, 문항 10개다. 20개 상한에 걸리지 않았으므로 잘라낸 문항은 없다.
전부 서술형 단답이며, 선택지는 제시하지 않는다.

### 개념 1 — 두 채널의 강제력 차이 (Background)

**Q1.** 이 저장소에서 워커의 행동을 정하는 두 채널의 이름을 각각 대고, 둘 중 어느 쪽이
모델의 협조 없이도 효력을 갖는지와 그 이유를 한 문장으로 쓰세요.

- 루브릭 ①: 두 채널을 "프롬프트 채널"과 "설정 채널"(또는 그에 해당하는 대상 — 역할 프롬프트 파일 / 잡 설정 YAML)로 구분해 짚는다
- 루브릭 ②: 설정 채널 쪽이 강제력을 갖는다고 답한다
- 루브릭 ③ *(문서를 읽어야 아는 값)*: 그 이유로 "스폰 도구 서술 자체가 세션에서 제거되므로"에 해당하는 메커니즘을 짚는다 — 모델이 거부할 수 있고 없고의 문제가 아니라 도구의 부재라는 점

**Q2.** 프롬프트 채널이 워커에게 도달하는 경로에서, 파일을 찾는 규칙과 못 찾았을 때의
동작을 순서대로 쓰세요.

- 루브릭 ①: 먼저 멤버 이름과 같은 이름의 프롬프트 파일을 찾는다고 답한다
- 루브릭 ② *(문서를 읽어야 아는 값)*: 없으면 `default.md`로 폴백한다고 답한다
- 루브릭 ③: 읽어낸 내용이 `<system-instructions>` 블록에 감싸여 전달된다고 답한다

### 개념 2 — 설정 채널이 닿지 않는 조건 (Background / Intuition)

**Q3.** 어떤 워커에게 설정 채널로는 서브에이전트 스폰을 막을 수 없게 되는 조건 두 가지를,
이 diff에 실제로 등장한 잡 이름을 각각 하나씩 붙여 쓰세요.

- 루브릭 ①: 조건 A — 멤버의 CLI가 번역 가능한 목록 밖일 때. 예시 잡은 `slides-review`
- 루브릭 ② *(문서를 읽어야 아는 값)*: 그 목록의 원소 셋을 정확히 댄다 — `codex`, `claude`, `opencode`
- 루브릭 ③: 조건 B — CLI는 목록 안이지만 잡 config에 `deny.subagents` 선언이 없을 때. 예시 잡은 `agent-council`

### 개념 3 — Intuition의 두 대조 워커 (Intuition)

**Q4.** 문서가 대조로 든 두 워커의 타임아웃 값을 각각 대고, 둘의 차단 레버 개수가
왜 다른지 쓰세요.

- 루브릭 ① *(문서를 읽어야 아는 값)*: `slides-review`의 `gemini` 멤버는 `240`초, `design-review`의 `gpt` 멤버는 `1200`초
- 루브릭 ②: `gemini` 쪽은 레버 0개, `gpt` 쪽은 설정 레버 1개
- 루브릭 ③: 차이의 원인이 CLI 종류의 번역 가능 여부(그리고 `subagents: true` 선언 유무)라고 답한다

### 개념 4 — 그룹 구분의 기준 (Code, 그룹 축)

**Q5.** 이 커밋의 두 Change Group을 가르는 기준이 무엇인지 쓰고, 각 그룹에 속한 파일 수를
쓰세요.

- 루브릭 ①: 기준이 "빈자리에 새로 넣는 순수 추가" 대 "이미 있던 문장을 교체" 라고 답한다
- 루브릭 ② *(문서를 읽어야 아는 값)*: 그룹 1이 4개 파일, 그룹 2가 3개 파일
- 루브릭 ③: 스킬 단위나 디렉터리 단위가 아니라 편집의 성격이 기준이라는 점을 짚는다

**Q6.** 그룹 1이 그룹 2보다 먼저 와야 하는 이유를 쓰세요.

- 루브릭 ①: 그룹 1이 이 커밋의 표준 문형을 정의한다고 답한다
- 루브릭 ② *(문서를 읽어야 아는 값)*: 그 문형을 모르면 그룹 2가 "문장 하나가 짧아졌다"로만 읽힌다는 점 — 즉 무엇이 무엇을 대체했는지가 안 보인다는 점을 짚는다

### 개념 5 — 교체된 문장의 의미 반전 (Code, `design-review`·`diagnose`·`gpt.md`)

**Q7.** 그룹 2에서 원래 한 줄이었던 문장에서 **제거된 절**이 무엇을 지시하고 있었는지 쓰고,
그 절이 남아 있었다면 워커가 받게 되는 모순을 쓰세요.

- 루브릭 ① *(문서를 읽어야 아는 값)*: 제거된 절이 위임/스폰을 허용하면서 "포그라운드로 실행하고 끝날 때까지 기다리라"고 규정하고 있었다는 점
- 루브릭 ②: 새 줄의 금지와 함께 두면 "스폰하지 마라"와 "스폰하면 이렇게 하라"가 동시에 주어진다는 모순을 짚는다
- 루브릭 ③: 교체 후 남은 문장의 의미가 순수한 턴 규율로 좁아졌다고 답한다

**Q8.** `design-review`에서 이 프롬프트 줄이 **차단을 추가하지 않는** 이유를 쓰고,
그럼에도 이 줄이 하는 일을 쓰세요.

- 루브릭 ① *(문서를 읽어야 아는 값)*: 해당 잡 config가 `subagents: true`를 선언해 이미 `-c agents.enabled=false`가 붙어 도구가 제거돼 있다는 점
- 루브릭 ②: 이 줄이 하는 일은 차단이 아니라, 존재하지 않는 도구를 가리키던 옛 지시와의 불일치 제거라고 답한다

### 개념 6 — 같은 선언의 CLI별 번역 (Code, `diagnose`)

**Q9.** `deny.subagents: true` 하나가 CLI에 따라 어떤 서로 다른 결과로 번역되는지,
이 문서에 등장한 세 가지를 쓰세요.

- 루브릭 ① *(문서를 읽어야 아는 값)*: codex → `-c agents.enabled=false`
- 루브릭 ② *(문서를 읽어야 아는 값)*: opencode → `permission.task: deny`
- 루브릭 ③ *(문서를 읽어야 아는 값)*: claude → `--settings`의 `permissions.deny`에 `Agent`와 `Task`
- 루브릭 ④: 프롬프트 쪽 문장은 CLI 종류와 무관하게 동일하다는 점을 짚는다

### 개념 7 — 커버되지 않은 자리 (열린 질문)

**Q10.** 이 커밋이 끝난 뒤에도 설정 레버와 프롬프트 문장을 **둘 다** 갖지 못한 카운슬 멤버가
하나 있다. 그게 누구이며 왜 그 상태로 남는지, 그리고 이 커밋이 실제로 편집한 파일 중
현재 배선에서 아무 워커에게도 읽히지 않는 파일이 무엇인지 쓰세요.

- 루브릭 ① *(문서를 읽어야 아는 값)*: 멤버 `claude` — `prompts/claude.md`가 존재해 폴백 `default.md`를 읽지 않는데 그 파일은 이번에 수정되지 않았고, 카운슬 config에는 `deny.subagents` 선언도 없다
- 루브릭 ② *(문서를 읽어야 아는 값)*: 읽히지 않는 파일은 `skills/agent-council/prompts/codex.md` — 선언된 멤버 이름(`claude`/`gpt`/`glm`)에 `codex`가 없다
- 루브릭 ③: 이 비대칭이 의도인지 누락인지는 근거가 없어 열린 질문으로 남는다는 점을 짚는다

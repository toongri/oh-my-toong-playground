---
name: explain-diff
description: Use when someone must actually understand a code change before acting on it — reviewing an unfamiliar PR, onboarding onto a subsystem through its history, or handing a large agent-authored diff to a human. Triggers include "diff 설명", "PR 설명해줘", "이 변경 이해하고 싶어", "explain this change", "코드 변경 설명 문서", "변경 퀴즈".
disable-model-invocation: true
---

<Role>

# explain-diff

**Core Principle**: 완료 조건은 문서가 아니라 사람이다. 이 스킬은 diff를 교재로 바꾸고, 마지막에 독자가 실제로 이해했는지를 서술형 퀴즈로 측정한다. 퀴즈를 통과하기 전에는 끝나지 않는다.

## Overview

여섯 스텝을 순서대로 통과해야 한다. 1~5번은 혼자 수행하고, 사용자는 문서를 읽는 것과 퀴즈에 답하는 것 두 가지만 한다.

```
evidence → background → intuition → code → render → quiz
```

각 스텝은 **구조 검사(스크립트) → 심사(서브에이전트, 인용 필수)** 두 관문을 통과해야 다음으로 넘어간다. 통과 판정은 상태 CLI가 내리고, 산출물 경로 쓰기는 훅이 그 판정을 읽어 허용하거나 거부한다. 스텝을 건너뛸 수는 없다.

</Role>

## 상태 CLI

이 스킬의 모든 상태 전이는 CLI를 통한다. 상태 파일 직접 편집은 훅이 거부한다.

```bash
CLI="bun ${CLAUDE_SKILL_DIR}/scripts/explain-diff-state.ts"
```

## Step 1 — evidence

**먼저 상태를 연다.** 상태가 없으면 산출물 경로 쓰기가 전부 거부되므로, 이 호출 없이는 아무것도 진행되지 않는다.

```bash
$CLI start --range "<git range>" --slug "<slug>"
```

인자가 없으면 `HEAD~1..HEAD`, 그것도 애매하면 현재 브랜치 대 기본 브랜치를 쓴다.

그다음 변경 파일을 상태와 함께 읽는다. 신규 추가된 파일은 가리킬 변경 전 위치가 없으므로,
구조 검사가 그 파일에는 `head:` 앵커만 요구한다 — 어느 파일이 신규인지는 여기서 확정한다.

```bash
git diff --name-status <git range>
```

`A`로 표시된 경로가 신규 파일이다. 이 목록을 `submit-step`의 `--added-files`로 넘긴다.

그다음 변경 파일을 **signal**과 **noise**로 나눈다.

- noise 기본 규칙표: `*.lock`, `dist/`, `__snapshots__/`, `*.generated.*`, 포맷팅만 바뀐 hunk
- 규칙표 **밖**의 파일을 noise로 분류하려면 그 파일마다 사유를 한 줄 적는다
- 분류 결과를 문서 맨 앞 `## Evidence` 블록에 표로 남긴다

이후 모든 스텝의 문서는 하나의 마크다운 파일에 누적한다:
`$OMT_DIR/explain-diff/YYYY-MM-DD-<slug>.md`

## Step 2 — background

두 단을 **모두** 쓴다.

```markdown
## Background

### 깊은 배경
이미 익숙하면 건너뛰세요.
<이 시스템을 처음 보는 사람이 필요한 것>

### 좁은 배경
<이 변경에 직접 닿는 것>
```

건너뛰기 문구는 구조 검사가 문자열로 확인한다.

## Step 3 — intuition

변경의 **본질**만 쓴다. 세부는 다음 스텝의 몫이다. 구체적인 toy 값을 실제로 등장시키고, 그 값을 설명 문장에서 다시 쓴다.

그림은 마크다운 안에 **인라인 HTML 조각**으로 그린다. ASCII 다이어그램은 쓰지 않는다. 네 가지 계열을 재사용한다.

1. Before/After 나란히
2. 데이터 흐름 + 예시 값
3. 파일/모듈 지도
4. 상태 전이

## Step 4 — code

1급 단위는 파일이 아니라 **Change Group**이다. signal 파일은 정확히 한 그룹에 한 번 들어간다.

```markdown
## Change Group 1: <제목>
> 예고: <이 그룹이 무엇을 할 것인지 한 문장>
> 순서: <왜 이 순서인지 한 줄>

### `path/to/file.ts`
**역할/변경 전 맥락** — <설명>. 변경 전 위치: `base:path/to/file.ts:12`
**무엇이 바뀌었나** — <설명>. 변경 후 위치: `head:path/to/file.ts:15`
**왜 필요한가** — … [근거: "<원문 인용>"]
**시스템 효과** — …
**추적성** — `path/to/file.ts:15`
```

**`base:` 와 `head:` 는 슬롯이지 예시가 아니다.** 파일 블록마다 두 앵커를 **각각** 적는다
— `head:` 만 있는 블록은 "변경 전에는 어디에 있었나"에 답하지 못한다.

- 수정된 파일: `base:` + `head:` **둘 다** 필수.
- 신규 추가된 파일(`git diff --name-status`의 `A`): 변경 전 위치가 존재하지 않으므로
  `head:` 하나만 적고, `base:` 슬롯 자리에는 신규임을 밝힌다.
- 파일 하나의 여러 지점을 짚을 때는 앵커를 여러 개 달아도 된다. 두 종류가 **각각 최소
  한 개씩** 있으면 된다.

**"왜 필요한가" 는 셋 중 하나의 형태만 갖는다.**

| 상황 | 형태 |
|---|---|
| 근거가 diff·커밋 메시지·주석에 있다 | `[근거: "<원문 인용>"]` |
| 근거는 없지만 코드에서 추론된다 | `[추론: <추론의 근거>]` |
| 도달 가능한 근거가 없다 | `Unknown / not supplied` |

세 번째 경우는 **문서 안에 열린 질문으로 남긴다.** 사용자에게 대화로 묻지 않는다 — 1~5번 스텝은 사람 없이 돈다.

## 스텝 통과시키기

각 스텝을 마치면 두 관문을 순서대로 통과시킨다.

```bash
# 관문 1 — 구조 검사
$CLI submit-step --step <step> --doc "<문서 경로>" \
  --signal-files "a.ts,b.ts" --added-files "b.ts"
```

이 관문이 실제로 보는 것은 스텝마다 다르다 — 그 스텝이 채워야 할 슬롯만 검사한다.

| 스텝 | 검사 |
|---|---|
| evidence | signal 파일 전부가 문서 어딘가에 등장하는가 |
| background | 깊은/좁은 배경 2단 + 건너뛰기 마커 |
| intuition | 없음 — 구조 검사는 통과만 시키면 되고, 실질 판정은 심사(R6)가 맡는다 |
| code | Change Group 제목·예고·순서 근거 3슬롯, 모든 "왜 필요한가"의 출처 표시, base/head 추적성, signal 파일이 Change Group에 정확히 한 번씩 들어갔는가 |
| render | Step 5를 보라 — 마크다운 구조가 아니라 `--html`로 넘긴 산출물의 존재·비어있지 않음을 본다 |

실패하면 실패 항목이 그대로 출력된다. 문서를 고치고 다시 제출한다.

```bash
# 관문 2 — 심사
$CLI pass-step --step <step> --doc "<문서 경로>" --judge-json '<판정 JSON>'
```

판정 JSON은 심사 서브에이전트가 내놓는다. 심사자에게는 `references/judge-prompt.md`의 **고정 템플릿**을 그대로 준다. 직접 지어내지 않는다.

심사자가 판정하는 항목은 전체 루브릭 중 두 개뿐이다 — `R6`(Intuition의 구체 예시가 실제로 있고 본문에서 다시 쓰이는가)과 `R7`(그룹 N의 예고문이 그룹 N-1을 전제하는가). 나머지는 구조 검사가 이미 판정했다.

이 두 항목이 **필수인 스텝은 각각 하나뿐이다** — `intuition`은 `R6`, `code`는 `R7`. 그 외 네 스텝(evidence·background·render·quiz)은 필수 심사 ID가 없으므로 `--judge-json '[]'`로 통과시킨다. 필수 ID가 페이로드에 없으면 그 자체로 거부되고, 관련 없는 ID에 실재하는 인용을 붙여도 필수 ID 누락을 대신 채우지 못한다.

```json
[{"id":"R6","pass":true,"quote":"문서에서 그대로 따온 문장"}]
```

인용 없이 `pass`를 주거나, 인용이 문서에 문자열로 없으면 CLI가 자동으로 실패시킨다.

## Step 5 — render

마크다운이 원본이고 HTML은 파생이다.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/render.ts --in "<문서.md>" --out "<문서.html>"
```

HTML은 단일 self-contained 파일이며 런타임 JS도 외부 참조도 없다.

render도 다른 스텝과 같은 두 관문을 통과해야 quiz로 넘어간다 — 이 전이를 건너뛰면 완료가 영원히 불가능해진다.

```bash
# 관문 1 — 산출물 검사 (마크다운 구조가 아니라 HTML 파일의 존재와 비어있지 않음을 확인한다)
$CLI submit-step --step render --doc "<문서.md>" --signal-files "a.ts,b.ts" --html "<문서.html>"

# 관문 2 — 심사 (render 스텝에는 심사 항목이 없으므로 빈 배열로 통과시킨다)
$CLI pass-step --step render --doc "<문서.md>" --judge-json '[]'
```

렌더가 끝나면 사용자에게 두 경로를 알리고 문서를 읽어달라고 요청한다.

## Step 6 — quiz

### 문항 뱅크

섹션마다 최소 하나, Code 섹션은 diff가 건드린 서브시스템마다 하나씩 **필수 개념**을 정한다. 총 20개를 넘으면 중요도 순으로 자르고, **잘랐다는 사실을 문서에 적는다.**

```bash
$CLI add-concept --id <concept> --required
```

문항은 전부 **서술형 단답**이고, 문항마다 정답이 반드시 짚어야 할 **루브릭 항목**을 함께 고정한다.

- 루브릭 항목은 문항당 2개 이상
- 그중 최소 하나는 문서를 읽지 않으면 알 수 없는 구체 값(식별자·좌표·조건·순서)
- 같은 개념 안에서 문항끼리 요구 루브릭이 겹치지 않는다

### 진행

문항은 **평문으로 던지고 턴을 끝낸다.** `AskUserQuestion`은 쓰지 않는다 — 선지가 보이는 순간 측정 대상이 회상에서 재인으로 내려간다.

```bash
$CLI ask
```

답이 오면 루브릭과 대조해 채점한다. `grade`는 `ask`로 문항을 낸 뒤(응답 대기 상태)에만 받아들인다 — `ask` 없이 부르면 상태를 건드리지 않고 그대로 거부된다.

```bash
$CLI grade --concept <id> --doc-digest "<문서 해시>" [--missing "<빠진 루브릭 항목>"]…
```

### 오답일 때

정답을 알려주지 않는다. 두 계층으로 유도한다.

| 계층 | 형태 |
|---|---|
| 1층 | 빠진 루브릭 항목에 **도달하게 하는 관찰**을 묻는다. 그 항목의 핵심 명사·동사를 질문에 쓰지 않는다 |
| 2층 | 문서의 어느 지점을 다시 보라고 가리킨다 |

2층에서도 못 오면 정답과 해설을 공개하고, **같은 개념의 다른 문항**으로 넘어간다.

뱅크가 소진됐는데 통과 못 한 개념이 남으면, 그 개념이 속한 섹션으로 돌아가 다시 집필한다. 문서가 가르치지 못한 것이지 독자가 부족한 것이 아니다.

## 완료

```bash
$CLI complete
```

필수 개념이 하나라도 남아 있으면 거부된다. 우회 경로는 없다.

## 참조

| 파일 | 언제 연다 |
|---|---|
| `references/rubric.md` | 어떤 항목을 누가 판정하는지, 각 항목이 무엇을 요구하는지 |
| `references/judge-prompt.md` | 심사 서브에이전트를 부를 때 (고정 템플릿) |
| `references/discipline.md` | 구조로 옮기지 못하고 남은 규율 |

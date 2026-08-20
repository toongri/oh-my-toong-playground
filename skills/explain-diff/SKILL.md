---
name: explain-diff
description: Use when someone must actually understand a code change before acting on it — reviewing an unfamiliar PR, onboarding onto a subsystem through its history, or handing a large agent-authored diff to a human. Triggers include "diff 설명", "PR 설명해줘", "이 변경 이해하고 싶어", "explain this change", "코드 변경 설명 문서", "변경 퀴즈".
disable-model-invocation: true
---

<Role>

# explain-diff

**Core Principle**: 완료 조건은 문서가 아니라 사람이다. 이 스킬은 diff를 교재로 바꾸고, 마지막에 독자가 실제로 이해했는지를 서술형 퀴즈로 측정한다. 퀴즈를 통과하기 전에는 끝나지 않는다.

## Overview

여덟 스텝을 순서대로 통과해야 한다. 1~7번은 혼자 수행하고, 사용자는 문서를 읽는 것과 퀴즈에 답하는 것 두 가지만 한다.

```
evidence → background → architecture → intuition → commits → code → render → quiz
```

문서의 골격과 쓸 수 있는 시각 컴포넌트는 `references/markdown-template.md`가 소유한다.
**문서 안에 `<style>` 블록·인라인 `style=` 속성·승인 목록 밖의 class를 쓰면 구조 검사가
그 스텝에서 거부한다** — 스타일은 render.ts가 소유하고, 저자는 내용과 컴포넌트만 쓴다.

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

- noise 기본 규칙표: `*.lock`, `dist/`, `__snapshots__/`, `*.generated.*`, 바이너리 에셋
  (이미지·폰트·미디어), 포맷팅만 바뀐 hunk
- 규칙표 **밖**의 파일을 noise로 분류하려면 그 파일마다 사유를 한 줄 적는다
- **같은 성격의 대량 파일 집합**(에셋 교체, 일괄 rename)은 개별 나열하지 않는다 —
  noise에 글롭 한 줄 + 개수 + 사유로 묶고, 그 변경의 의미는 그것을 참조하는 코드
  파일의 Change Group에서 한 번 설명한다. signal은 파일마다 설명할 것이 있는
  파일이다 — 개수가 곧 의미인 집합은 signal이 아니다
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

## Step 3 — architecture

변경이 닿는 구조를 **세 레벨**로 그린다. 각 레벨은 `### 시스템 레벨`·`### 컴포넌트 레벨`·
`### 도메인 레벨` 헤딩 아래 mermaid 다이어그램 하나와 그것을 읽어주는 산문으로 구성한다.

| 레벨 | 답하는 질문 |
|---|---|
| 시스템 | 어떤 런타임·서비스·저장소가 관여하고, diff는 어느 경계에 닿는가 |
| 컴포넌트 | 모듈·도메인 사이 의존이 변경 전후로 어떻게 달라지는가 |
| 도메인 | 엔티티·개념·불변식이 무엇이고 무엇이 바뀌는가 |

**시스템 레벨은 다이어그램만으로 끝내지 않는다.** 다이어그램(또는 생략 마커) 아래에
이번 diff가 바꾸는 계약을 세 축으로 열거하는 표를 둔다 — `서버 API`(엔드포인트·tRPC
프로시저·요청/응답 스키마), `DB 스키마`(테이블·컬럼·제약), `클라이언트 의존`(클라이언트가
맞춰 바꿔야 하는 계약). 각 축은 바뀌는 계약을 구체적으로 적거나 `변경 없음: <사유>`로
채운다. 세 축 라벨이 모두 있어야 R14를 통과한다. 표 형식은 `markdown-template.md`를 따른다.

다이어그램은 ` ```mermaid ` 펜스로 쓴다 — render 스텝에서 인라인 SVG로 구워지므로 최종
HTML은 여전히 자기완결이다. 다이어그램이 하나라도 있으면 노드·간선 라벨에 diff에
실재하는 식별자를 쓰고, 최소 한 레벨에 변경 표시(`:::changed` 또는 Before/After 대비)를
넣어야 R12를 통과한다. 이 두 근거는 심사자의 필수 인용에 함께 드러나야 한다. 유형 선택과
문법 규칙은 `markdown-template.md`를 따른다.

그릴 것이 정말 없는 레벨은 `구조 변화 없음: <사유 한 문장>`으로 대신한다 — 사유 없는
마커는 구조 검사가 거부한다. 다이어그램이 하나도 없고 세 레벨 모두에 이 사유 있는
waiver가 있으면 R12를 충족할 수 있다. 이 경우 심사자 인용에는 시스템·컴포넌트·도메인
레벨의 세 waiver 문장을 모두 문서에서 그대로 따온 문자열로 넣어야 하며, 하나라도 빠지거나
사유가 없으면 통과하지 못한다. 다이어그램이 하나라도 있으면 이 waiver 예외는 적용되지
않는다.

## Step 4 — intuition

변경의 **본질**만 쓴다. 세부는 다음 스텝의 몫이다. 구체적인 toy 값을 실제로 등장시키고, 그 값을 설명 문장에서 다시 쓴다.

그림은 승인된 컴포넌트로 그린다. ASCII 다이어그램은 쓰지 않고, 스타일을 발명하지 않는다.

- 한 줄로 흐르는 것(호출 순서·데이터 흐름 + 예시 값) → `flow` 컴포넌트
- 전후 대비 → `compare` 컴포넌트
- 경계·분기가 필요한 2차원 구조 → ` ```mermaid ` (architecture 스텝과 같은 문법)

## Step 5 — commits

먼저 범위의 커밋 목록을 뽑는다 — 이 목록이 이 스텝의 대상이다:

```bash
git rev-list --reverse --no-merges <base>..<head>
```

머지 커밋은 세지 않는다 — 머지의 첫 부모 대비 diff는 범위 전체와 같아 고유한 서사가 없다.
머지 범위(`<merge>^1..<merge>`)는 머지된 브랜치의 실커밋이 전부 나온다 — "PR 하나"라도
이 출력이 여러 줄이면 단일 커밋이 아니다. 단일 커밋 여부는 출력 줄 수로만 판정한다.

이 스텝이 쓰는 것은 **한 줄 오버뷰**다. 깊은 서사는 다음 스텝의 몫이다(커밋별 코드는
Change Group 안에서 쓴다). `## Commit Journey` 아래 커밋마다 한 줄을 적고, 그 커밋이
어느 Change Group으로 가는지 태그한다 — 형식은 `N. \`<short-hash>\` <타입> — <한 줄 의도> → 그룹 N`.
docs·noise 커밋은 계약을 설명하는 그룹으로 `→ 그룹 N (흡수)`처럼 태그한다.

```markdown
## Commit Journey
1. `a3078cd8` feat! — 비용 계약을 category로 고정 → 그룹 1
2. `bc62e399` docs — 위키 반영 → 그룹 1 (흡수)
```

커밋 해시는 `start`가 상태에 박제한 목록과 대조된다 — 하나라도 오버뷰에 없으면 구조 검사가
실패한다. 위 명령이 정확히 한 줄일 때만 섹션 대신 `단일 커밋 범위 — Commit Journey 생략.`
한 줄을 쓴다.

## Step 6 — code

1급 단위는 **Change Group**(관심사)이지만, **뼈대는 커밋이다.** 그룹 안에서 커밋 단위로
내려가고, 커밋 아래 그 커밋이 건드린 파일 블록이 온다. signal 파일은 정확히 한 파일
블록으로 한 번 들어간다.

```markdown
## Change Group 1: <제목>
> 예고: <이 그룹이 무엇을 할 것인지 — 그룹 N은 그룹 N-1을 전제>
> 순서: <왜 이 순서인지 한 줄>

### `<short-hash>` — <커밋 제목>
<이 커밋이 이 그룹에서 한 일 한두 문장. 여러 그룹을 가로지르면 spillover 한 줄.>

#### `path/to/file.ts`
<div class="cf">
<p><strong>역할/변경 전</strong> — <설명></p>
<p><strong>바뀐 것</strong> — <설명></p>
<p><strong>왜</strong> — <설명> <span class="cf-src">근거</span> "<원문 인용>"</p>
<p><strong>효과</strong> — <설명></p>
<p class="cf-loc"><code>base:path/to/file.ts:12</code> → <code>head:path/to/file.ts:15</code></p>
</div>

​```ts
// 핵심 로직 — 실제 코드 또는 수도코드 (파일마다 하나 필수)
​```
```

세 슬롯이 R13·R3·R5를 채운다. 컴포넌트·필드 라벨·코드 펜스 규칙은 `markdown-template.md`를 따른다.

- **커밋 서브섹션**(`### \`hash\``): 그룹마다 최소 하나. 해시는 `start`가 박제한 범위
  커밋이어야 한다(R13).
- **핵심 로직 코드**: 파일 블록마다 코드 펜스 하나. 위치 앵커만으로는 "무엇을 했나"가
  읽히지 않는다(R13).
- **`cf-loc` 위치 앵커**: `base:`(변경 전)와 `head:`(변경 후)를 산문 밖 슬롯에 둔다(R5).
  수정 파일은 둘 다, 신규 파일(`git diff --name-status`의 `A`)은 `head:`만 필수이고
  `base:` 자리에는 신규임을 밝힌다.
- **`cf-src` 출처 태그**: 왜 필드마다 셋 중 하나(R3).

| 상황 | 태그 |
|---|---|
| 근거가 diff·커밋 메시지·주석에 있다 | `<span class="cf-src">근거</span> "<원문 인용>"` |
| 근거는 없지만 코드에서 추론된다 | `<span class="cf-src">추론</span> <추론의 근거>` |
| 도달 가능한 근거가 없다 | `<span class="cf-src">Unknown / not supplied</span>` |

세 번째 경우는 **문서 안에 열린 질문으로 남긴다.** 사용자에게 대화로 묻지 않는다 — 1~7번 스텝은 사람 없이 돈다.

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
| architecture | 세 레벨 헤딩이 모두 있고, 각 레벨에 mermaid 또는 사유 있는 생략 마커가 있는가(R9); 시스템 레벨에 변경 계약 3축이 있는가(R14) |
| intuition | 고유 항목 없음 — 실질 판정은 심사(R6)가 맡는다 |
| commits | 커밋 2개 이상이면 Commit Journey 오버뷰에 모든 해시가 등장하는가(R10); 단일 커밋이면 생략 마커 허용 |
| code | Change Group 제목·예고·순서 근거 3슬롯(R2), 모든 왜의 출처 태그(R3), cf-loc base/head 추적성(R5), signal 파일이 파일 블록에 정확히 한 번씩(R1), 그룹마다 유효 해시의 커밋 서브섹션 + 파일마다 핵심 로직 코드(R13) |
| render | Step 7을 보라 — 산출물 HTML·mermaid 렌더 패리티·검증 리포트 2종을 본다 |

**모든 저작 스텝 공통**: 누적 문서 전체에서 `<style>`·인라인 `style=`·미승인 class를 검사한다(R11).

실패하면 실패 항목이 그대로 출력된다. 문서를 고치고 다시 제출한다.

```bash
# 관문 2 — 심사
$CLI pass-step --step <step> --doc "<문서 경로>" --judge-json '<판정 JSON>'
```

판정 JSON은 심사 서브에이전트가 내놓는다. 심사자에게는 `references/judge-prompt.md`의 **고정 템플릿**을 그대로 준다. 직접 지어내지 않는다.

심사자가 판정하는 항목은 전체 루브릭 중 세 개뿐이다 — `R12`(아키텍처 다이어그램이
있다면 라벨·변경 표시가 diff의 근거와 대응하는가, 다이어그램이 없다면 세 레벨의 사유
있는 waiver가 모두 있는가), `R6`(Intuition의 구체 예시가 실제로 있고 본문에서 다시
쓰이는가), `R7`(그룹 N의 예고문이 그룹 N-1을 전제하는가). 나머지는 구조 검사가 이미
판정했다. R12를 통과하려면 심사자 인용이 필수다. 다이어그램이 있는 경우 인용에는
식별자와 변경 표시 근거를, 다이어그램이 없는 경우에는 세 waiver 문장을 모두 그대로
담아야 한다.

이 세 항목이 **필수인 스텝은 각각 하나뿐이다** — `architecture`는 `R12`, `intuition`은 `R6`, `code`는 `R7`. 그 외 다섯 스텝(evidence·background·commits·render·quiz)은 필수 심사 ID가 없으므로 `--judge-json '[]'`로 통과시킨다. 필수 ID가 페이로드에 없으면 그 자체로 거부되고, 관련 없는 ID에 실재하는 인용을 붙여도 필수 ID 누락을 대신 채우지 못한다.

```json
[{"id":"R6","pass":true,"quote":"문서에서 그대로 따온 문장"}]
```

인용 없이 `pass`를 주거나, 인용이 문서에 문자열로 없으면 CLI가 자동으로 실패시킨다.

## Step 7 — render

마크다운이 원본이고 HTML은 파생이다.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/render.ts --in "<문서.md>" --out "<문서.html>"
```

render.ts가 ` ```mermaid ` 펜스를 mmdc로 인라인 SVG로 굽는다. HTML은 단일 self-contained
파일이며 런타임 JS도 외부 참조도 없다. mmdc가 없거나 블록이 실패하면 렌더가 실패 블록
번호와 함께 죽는다 — 그 블록을 고치고 다시 렌더한다.

렌더 후, quiz로 넘어가기 전에 **두 검증을 반드시 돌린다.** technical-writing이 Markdown을
바꿀 수 있으므로, visual-qa는 항상 최종 렌더 HTML을 검사한다.

1. **technical-writing** — technical-writing 스킬로 마크다운 산문을 리뷰시키고, 받아들인
   지적을 문서에 반영한다. 반영 내역을 `<slug>-writing-report.md`에 남기고 마지막 줄에
   `REVIEW: APPLIED`를 적는다. 문서를 고쳤으면 render.ts를 다시 돌린다.
2. **visual-qa** — visual-qa 스킬(없는 플랫폼에서는 agent-browser로 직접)로 최종 렌더된 HTML을
   데스크톱·모바일 폭에서 스크린샷 검증한다: 겹침·잘림·가로 스크롤·다이어그램 가독성.
   결과를 `<문서.md>` 옆 `<slug>-visual-report.md`에 남기고, 발견을 고친 뒤 마지막 줄에
   `VERDICT: PASS`를 적는다. 고치지 않은 발견이 남았으면 PASS를 적을 수 없다.

```bash
# 관문 1 — 산출물 검사: 현재 Markdown에서 다시 렌더된 HTML·mermaid→SVG 패리티·검증 리포트 2종
$CLI submit-step --step render --doc "<문서.md>" --signal-files "a.ts,b.ts" \
  --html "<문서.html>" \
  --visual-report "<slug>-visual-report.md" --writing-report "<slug>-writing-report.md"

# 관문 2 — 심사 (render 스텝에는 심사 항목이 없으므로 빈 배열로 통과시킨다)
$CLI pass-step --step render --doc "<문서.md>" --judge-json '[]'
```

render 제출은 HTML이 제출 시점의 현재 Markdown으로 다시 생성된 산출물인지도 확인한다.
Markdown을 고친 뒤 예전 HTML을 제출하면 stale artifact로 거부되므로, 문서를 고칠 때마다
render.ts를 다시 실행한 뒤 제출한다.

렌더가 끝나면 사용자에게 두 경로를 알리고 문서를 읽어달라고 요청한다.

## Step 8 — quiz

퀴즈는 **대화로 진행하는 단계이지 문서 섹션이 아니다.** 문서에 `## Quiz` 헤딩을 쓰지
않는다 — 렌더된 HTML에 빈 절로 남는다. 문항은 아래 CLI로 관리하고 평문으로 던진다.

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
| `references/markdown-template.md` | 문서를 쓰기 시작할 때 — 골격·아키텍처 레벨별 다이어그램 유형·승인된 컴포넌트 전체 목록 |
| `references/rubric.md` | 어떤 항목을 누가 판정하는지, 각 항목이 무엇을 요구하는지 |
| `references/judge-prompt.md` | 심사 서브에이전트를 부를 때 (고정 템플릿) |
| `references/discipline.md` | 구조로 옮기지 못하고 남은 규율 |

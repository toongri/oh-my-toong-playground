# explain-diff 측정 기록

`skills/explain-diff/references/rubric.md`의 루브릭 8항목은 전부 여기 있는 측정에서 나왔다.
문서에 적힌 "RED 10/16" 같은 숫자를 확인하려면 이 디렉터리를 보면 된다.

이 트리는 **배포되지 않는다**. `sync.yaml`이 참조하는 컴포넌트 카테고리(`skills/`, `hooks/`,
`scripts/`, `rules/`, `agents/`, `commands/`) 어디에도 속하지 않으므로 대상 프로젝트로
따라가지 않는다. 런타임에 필요한 건 루브릭 자체이고 그건 스킬 안에 있다.

## 왜 저장하는가

RED 문서 16건은 **다시 만들 수 없다.** 같은 프롬프트를 같은 모델에 다시 넣어도 같은 문서가
나오지 않으므로, 이 파일들이 사라지면 루브릭의 모든 임계값은 검증 불가능한 주장이 된다.

## 구조

```
harness/
  manifest.json        픽스처 4종 — 고정 SHA와 range, 그리고 그 diff를 고른 이유
  prompts/naive.md     대조군 1 — 가이드 없는 프롬프트
  prompts/gist.md      대조군 2 — geoffreylitt gist 원문 (현존 최선 프롬프트)
  prompts/skill.md     실험군 — 스킬 적용
  run.sh               한 셀 실행: run.sh <arm> <control> <fixture> [platform]
  probe.ts             구조 신호 계측 (루브릭 설계용)
  score-structure.ts   프로덕션 구조 검사기로 채점 (lib/explain-diff-structure.ts 직접 호출)
baselines/
  red/<platform>/<control>/<fixture>/*.md     16건
  green/<platform>/skill/<fixture>/*.md        8건
  green2/claude/skill/<fixture>/*.md           2건 (R5·템플릿 정정 후 재실행)
```

`.html` 렌더본과 `run.log` 실행 전사(12MB)는 담지 않았다 — 렌더본은 `.md`에서 파생되고,
전사는 도구 호출 잡음이다.

## 시나리오 4종

각 픽스처는 설명이 무너지는 **서로 다른 방식**을 겨냥한다. 선정 이유 전문은
`harness/manifest.json`의 `why_this_one`에 있다.

| id | 시나리오 | 규모 | 압박하는 지점 |
|---|---|---|---|
| `coordinate-render` | 좌표계·렌더링 변경 | 2파일 +64/-5 | 숫자만으로는 이해 불가 — 그림이 필요. "왜"가 diff 밖(이슈)에 있어 출처 미상 경로를 시험 |
| `refactor-invariant` | 동작 불변 리팩터링 | 6파일 +305/-170 | "무엇이 달라졌나" vs "어디로 옮겨갔나"를 가르지 못하면 붕괴 |
| `crosscutting-small` | 크로스커팅 소변경 | 7파일 +10/-3 | 사실상 같은 한 줄 × 7 — 파일별 나열이면 같은 말을 7번 반복 |
| `giant-pr` | 거대 PR | 29파일 +1858/-274 | 묶기·순서·signal/noise 분류·개념 상한이 동시에 압박받음 |

## 재현

픽스처는 고정 SHA의 detached 워크트리다(57MB라 레포에 담지 않음).

```bash
# manifest.json의 sha로 워크트리를 만든 뒤
export OMT_EVAL_ROOT=<워크트리와 결과를 둘 트리>
bun evals/explain-diff/harness/probe.ts red naive,gist
bun evals/explain-diff/harness/score-structure.ts green skill
```

`OMT_EVAL_ROOT`를 주지 않으면 `~/.omt/oh-my-toong-playground/explain-diff-eval`을 본다 —
이 측정이 실제로 돌았던 자리다.

## 결과

### RED — 16건 (2 플랫폼 × 2 대조군 × 4 픽스처, 셀당 n=1)

| 항목 | 나타난 문서 수 |
|---|---|
| Change Group 명명 | 0/16 |
| signal 파일 전수 등장 | 10/16 |
| Background 건너뛰기 마커 | 8/16 (gist 8/8, 무가이드 0/8) |
| `file:line` 추적성 | 10/16 |
| "왜"의 출처 표시 | 1/16 |
| 객관식 퀴즈 | 5/16 |

`giant-pr`은 4건 모두 signal 파일을 놓쳤다 — 29개 중 18·19·11·7개만 등장했다.

### GREEN — 8건 (2 플랫폼 × 스킬 × 4 픽스처, 셀당 n=1)

프로덕션 구조 검사(R1–R5) **6/8** → R5 정정 후 **7/8**.

| 항목 | RED | GREEN |
|---|---|---|
| Change Group 명명 | 0/16 | 8/8 |
| signal 파일 전수 등장 | 10/16 | 8/8 |
| Background 건너뛰기 마커 | 8/16 | 8/8 |
| `file:line` 추적성 | 10/16 | 8/8 |
| 객관식 퀴즈 | 5/16 | 0/8 |

### GREEN이 잡아낸 결함 2건

1. **R5가 만족 불가능한 요구를 하고 있었다.** 초판은 모든 파일에 `base:`+`head:` 양쪽을
   요구했는데, 신규 추가된 파일에는 가리킬 변경 전 위치가 없다. `--added-files`
   (`git diff --name-status`의 `A`)로 정정. 신규 여부를 문서의 서술이 아니라 diff에서
   읽는 이유: 문장으로 판정하면 "신규 파일"이라고 적는 것만으로 면제받을 수 있다.

2. **템플릿이 앵커를 예시처럼 보이게 했다.** `**역할/변경 전 맥락** — … (base:...)` 형태라
   필수 슬롯이 아니라 장식으로 읽혔다. 실패한 문서는 같은 문서 안에서 `head:`를 148곳
   달아놓고 수정된 파일의 `base:`만 통째로 빠뜨렸다 — 규칙 위반이 아니라 필수인 줄
   몰랐던 패턴. 명시적 슬롯으로 바꾼 뒤 재실행(`green2`)에서 2/2 통과했고, 이전에
   실패했던 `README.md`·`docs/ORCHESTRATION.md`·`ultragoal-state.test.ts` 블록에
   `base:`가 들어왔다.

## 이 측정이 재지 않은 것

- **R6·R7 (심사자 판정 항목)** — GREEN에서 한 번도 채점하지 않았다. 루브릭 8항목 중 5개만
  검증된 상태다.
- **재제출 루프** — eval은 상태 CLI를 호출하지 않고 초안 1회만 냈다. 실패한 문서가 실패
  메시지를 읽고 실제로 고쳐져 통과하는지는 미검증이다.
- **퀴즈 스텝 전체** — 답할 사람이 없어 `render`에서 멈췄다. "퀴즈가 이해를 측정하는가"는
  사람이 한 번 통과해봐야 알 수 있고, 아직 아무도 하지 않았다.
- **실행 간 편차** — RED·GREEN 모두 셀당 n=1이다.
- **강제 계층** — 아티팩트 가드·Stop 게이트는 훅/CLI 테스트가 검증한 것이지 이 eval이
  검증한 게 아니다. eval 자식 프로세스에는 게이트가 걸려 있지 않았다.

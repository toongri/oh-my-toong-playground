# MC-R0 — 회차 0 기록 (기준선, `--no-skill`)

## 목적

SKILL.md를 아예 주지 않은 상태(`--no-skill`)에서 두 모델이 fc-feedback 과제(영상 →
분할안 → 노트 → 참고자료 → 렌더)를 스스로 수행할 수 있는지 확인하는 writing-skills
RED 기준선이다. 샘플 영상은 `NUzEChn9EyI`(gold: `evals/fc-feedback/gold/NUzEChn9EyI.units.json`).
모델: luna(`gpt-6-luna`, `model_reasoning_effort=max`, 최적화 대상) / sol(`gpt-6-sol`,
`model_reasoning_effort=medium`, 비교용).

## 오염된 첫 실행 — 폐기

첫 실행은 격리(isolation)가 갖춰지기 전에 돌린 진단용 실행이라 폐기했다. 원본은
`evals/fc-feedback/baselines/round-0-contaminated/`에 그대로 보존해 뒀다(luna/sol
각 rep1·rep2, `score.json` 없이 산출물만).

관측된 문제:

- 채점기(`harness/score.ts`)의 `check` 게이트를 실행 디렉터리(run-dir)의 cwd·env
  없이 재실행해, 게이트 자체가 exit 1로 잘못 실패했다.
- push 오탐 — `run.jsonl` 텍스트 전체에서 `git push` 문자열을 찾는 방식이라, 명령
  실행이 아닌 다른 이벤트(에이전트 메시지 등)에 그 문자열이 섞여 있어도 push 시도로
  잘못 잡혔다.
- 모델이 레포의 README·rubric·DESIGN 문서와 오케스트레이터의 외부 plan 파일을
  스스로 찾아 읽었다 — run-dir 격리가 없어 레포 구조가 그대로 보였다.
- 한 실행이 run-dir이 아니라 실제 사용자 manifest 디렉터리(`fc.ts config`가 쓰는
  실사용 경로)에 스텁을 만들었다. 확인 후 제거했다.

수정(커밋, 시간순):

- `64b27d7e` — fc-feedback manifest 루트 환경변수 추가(manifest를 run-dir 안쪽으로
  한정).
- `03927f9f` — 채점기 게이트·push 판정·오염 탐지 보정(게이트를 실행 디렉터리 문맥에서
  재실행, push 판정을 실행 명령 이벤트로 한정, 오염 탐지 필드 추가).
- `8d8854c1` — fc-feedback 모델 비교 실행 격리(codex 권한 프로파일로 작업 트리 상위·홈
  설정 디렉터리를 차단, `--ephemeral`, 샌드박스 스모크 테스트로 사전 검증).

이 세 커밋으로 (1) 게이트 재실행 문맥 오류, (2) push 오탐, (3) 오염된 실행을 비교에서
빼는 필드, (4) 레포·홈 디렉터리 차단 격리를 갖춘 뒤 재실행했다.

## 재실행 결과 (`evals/fc-feedback/baselines/round-0/`)

| 모델 | rep | 총점 | 게이트 | 오염 | push 시도 |
|---|---|---|---|---|---|
| luna | rep1 | 0 | 실패 | 없음 | 없음 |
| luna | rep2 | 0 | 실패 | 없음 | 없음 |
| sol | rep1 | 0 | 실패 | 없음 | 없음 |
| sol | rep2 | 0 | 실패 | 없음 | 없음 |

네 반복 모두 `check plan`/`check notes`/`check similar`/`check refs` 게이트 중 하나
이상이 exit≠0이라, rubric의 게이트 규칙("게이트 실패 시 그 반복의 총점은 0")에 따라
다른 배점을 계산하지 않고 총점 0으로 기록했다. 오염·push 시도는 네 반복 모두 없었다.

## 관찰

- luna는 두 반복 모두 진입점 CLI를 찾지 못해 사용자에게 질문을 던지고 멈췄다 — 스킬
  없이는 `fc.ts` 같은 전용 진입점의 존재 자체를 모른다.
- sol rep2는 셸 내장 `fc` 명령(fc-feedback의 `fc.ts`가 아니라 셸의 히스토리 치환
  명령)을 그대로 실행해 엉뚱한 결과를 냈다.
- sol rep1은 스킬이 만드는 산출물 체계 대신 직접 페이지(HTML)를 손으로 작성하고
  브라우저로 열려고 시도했다 — 분할안·노트·게이트 산출물 없이 완성물부터 만들려 했다.

## 후속 조치 — round-1 이전 스킬 수정 (커밋 `cc7d8724`)

위 세 가지 실패 패턴(진입점 못 찾음, 셸 내장 `fc`와 충돌, 게이트 없이 직접 페이지 작성)을
막기 위해 SKILL.md에 아래를 명시했다.

- 단일 진입점 `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts <cmd>`를 명시하고, 맨 `fc` 호출을
  금지한다(셸 내장 명령과의 충돌 차단).
- 중단된 실행은 처음부터 다시 하지 않고 첫 번째로 없는 산출물부터 재개한다.
- 페이지(HTML)는 손으로 쓰지 않고 항상 `render` 단계로만 생성한다.

1회차(round-1)는 이 수정이 반영된 스킬 버전(`cc7d8724`)으로 실행한다.

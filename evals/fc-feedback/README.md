# fc-feedback 모델 비교 측정

fc-feedback 스킬(SKILL.md)을 writing-skills 기반으로 다듬어가는 동안, luna max
(`gpt-6-luna` / `model_reasoning_effort=max`)를 최적화 대상으로 놓고 sol med
(`gpt-6-sol` / `model_reasoning_effort=medium`)를 매 회차 비교군으로 나란히 돌려,
최소 5회차 이상 문서 품질을 깎아가며 최종적으로 더 나은 모델을 확정하는 측정이다
(plan §13.3, momus 3·4차 검토로 확정된 계약은 §14, §15 — 우선순위는 §15 > §14 > §13).

이 트리는 **배포되지 않는다**. `sync.yaml`이 참조하는 컴포넌트 카테고리(`skills/`,
`hooks/`, `scripts/`, `rules/`, `agents/`, `commands/`) 어디에도 속하지 않으므로 대상
프로젝트로 따라가지 않는다.

## 방법

- 입력 고정: `fetch`/`transcribe`/`scan` 산출물(`session.json`, `lines.json`,
  `candidates.json`, `cand/` 프레임)을 미리 만들어 둔 작업 폴더(`fixtures/`)를 매
  반복마다 통째로 복사해서 쓴다. 비교 대상은 LLM 단계(분할안, 노트, 유사도 판정,
  참고자료)로만 좁힌다.
- 아카이브는 remote 없는 임시 git repo(`configured` 모드) — `disabled` 모드가 아니다.
  과거 세션 1개를 시드로 넣어 유사도 판정 단계가 실제로 동작하게 만든다.
- 평가 모드 프롬프트(`harness/prompts/eval-preamble.md`)는 검토 게이트를 자동 승인으로
  간주하고, 발행 게이트(git add/commit/push)는 거절하도록 고정한다.
- 회차: 0회차는 스킬 없이(`--no-skill`, writing-skills RED 기준선) 두 모델을 돌린다.
  1회차부터 SKILL.md를 적용한다. 회차마다 모델당 2회 반복(분산 측정)하고 평균을 기록한다.
  luna max의 실패를 다음 회차의 개선 대상으로 삼고, sol med는 같은 스킬 버전으로
  비교만 한다.
- 채점은 `rubric.md`의 배점표(자동 60 + 독립 심사 40, 합계 100)를 따른다. 자동 채점은
  `harness/score.ts`가, 독립 심사는 presentation-reviewer 에이전트가 `rubric.md`에
  고정된 프롬프트로 수행한다.

## 디렉터리 구조

```
evals/fc-feedback/
  README.md            이 문서 — 목적·방법·결정 규칙·결과
  rubric.md            채점표(100점 배점) + 심사 고정 프롬프트
  gold/                정답: 샘플 영상의 피드백 단위 목록(§14.6, 오케스트레이터 초안 → 사용자 확인 1회)
  fixtures/            사전 준비 작업 폴더, roster.cef.yaml(평가용 팀 명단), 아카이브 시드
  baselines/           회차별 원본 보존(§14.7/§15-4/§15-5): round-{n}/<model>/rep{k}/
  rounds/              회차 요약 기록: round-{n}.md(점수표, luna 실패 목록, sol 비교)
  harness/
    run.sh             한 반복 실행: run.sh [--dry-run] <round> <model-key> <rep> <workdir-fixture> [--no-skill]
    score.ts           run-dir을 채점(gold F1, 태그 F1, 참고자료, 규율 위반 감점)
    score.test.ts      score.ts 단위 테스트
    prompts/
      eval-preamble.md 평가 모드 머리말(검토 게이트 자동 승인, 발행 게이트 거절)
```

`baselines/<round>/<model>/rep<k>/`에는 매 반복마다 `plan.json`, `plan.validated.json`,
`notes.json`, `similar-choices.json`, `similar-candidates.json`, `refs-draft.json`,
`refs.verified.json`, `data.json`, `taxonomy.yaml`(아카이브 사본), `lines.json`,
`score.json`, `judge.md`, `run.jsonl.gz`(gzip 원본, 요약본이 아니다)를 남긴다.

## 입력 고정 (plan §15-2/§15-3, EVAL-PREP)

`fixtures/`는 다음 네 가지로 구성된다.

- `roster.cef.yaml` — 평가용 명단(실제 발행용이 아니다). 샘플 영상(C.E.F. / FC Barcelona
  팀 연습, 2024-01-04 Part 3, `https://www.youtube.com/watch?v=NUzEChn9EyI`)에서 HUD
  스코어보드와 텔레스트레이터 라벨로 확인한 게이머태그만 담았다 — `TIMEJ`(코치),
  `Gerrard_CEF`, `CEF_VandeVen`. 포지션은 전부 코치 발화·화면 속 위치로만 추정한 것이라
  파일 안에 `# 추정` 주석을 달아 뒀다. sha256:
  `00de81cf81372b9a66081df3b9f2ec094ba5c43ccb655d5ca2318cbd4c9a9791`
- `work-NUzEChn9EyI/` — 위 샘플 영상의 `fetch`→`transcribe`→`scan` 산출물
  (`session.json`, `lines.json`, `candidates.json`, `sheets.json`, `cand/*.jpg`,
  `sheets/*.jpg`). 190줄, 후보 52개, 컨택트시트 5장. `lines.json` sha256:
  `44b0973b277f5e27a43c20b01f6e4f8baf3a493c4406d13697b11d7bd308f012`
- `work-yn-qm7lM5p4/` — held-out 영상(같은 채널의 다른 파트,
  `https://www.youtube.com/watch?v=yn-qm7lM5p4`, gold 없이 심사 점수만 반영해 샘플
  과적합을 감지하는 용도, plan §13.3) 산출물. 구성은 위와 동일, 92줄, 후보 45개,
  컨택트시트 5장. `lines.json` sha256:
  `e5b5b1c400ef9db0478ae0485f51b8cc35fbf1b867328fe890f101552b28fef2`
- `archive-seed/` — 같은 채널의 과거 영상(2024-01-03 Part 1,
  `https://www.youtube.com/watch?v=XkM_tS2Id8Q`) 세션 1개(유닛 2개)를 미리 렌더해 둔
  아카이브 시드. `taxonomy.yaml`은 스킬 번들 기본값(`scripts/taxonomy.default.yaml`)
  그대로이고 `roster.yaml`은 `roster.cef.yaml`과 내용이 같다. `index.json`의
  `sessions`가 1개 이상이어야 유사도(similar) 단계가 실제로 비교할 대상을 갖는다.
  `.git/`은 들어 있지 않다 — `harness/run.sh`가 복사한 뒤 매 반복마다 새로 `git init`한다.

**미디어 캐시 규칙.** `work-*/session.json`의 `files.audio`/`files.video`/`files.wav`는
`fc.ts fetch`/`transcribe`가 원래 쓰는 그대로 작업 폴더 상대경로
(`media/audio/<id>.webm`, `media/video/<id>.webm`, `media/wav/<id>.wav`, …)로 남아
있다 — 절대경로로 고쳐 쓰지 않았다. 오디오/영상 원본은 용량 때문에 커밋하지 않고,
`${FC_EVAL_MEDIA_DIR:-$HOME/.cache/fc-feedback-eval}/<video-id>/`에 각 `work-*/`의
`media/` 서브트리와 동일한 구조(`audio/`, `video/`, `captions/`, `wav/`)로 캐시해 둔다.
`harness/run.sh`는 fixture를 실행용 작업 폴더로 복사한 직후 그 경로를 `<work_dir>/media`
심볼릭 링크로 연결한다(`frames` 단계가 `session.json`의 상대경로를 통해 원본 영상을 다시
여는 것까지 포함해 그대로 동작하도록). 캐시 디렉터리가 없으면 `run.sh`는 무엇을
채워야 하는지 알려 주고 즉시 종료한다.

**재생성 방법.**

1. HOME/OMT_DIR/OMT_SESSION_ID를 임시 디렉터리로 격리하고, 임시 git 아카이브를
   `roster.cef.yaml`로 `fc.ts config set`한 뒤(`configured` 모드), 영상별로
   `fc.ts fetch <url>` → `transcribe` → `scan`을 실제로 실행한다.
2. 이 macOS 환경에서는 `uvx`가 격리된 HOME 아래에서 uv가 관리하는 python을 찾지 못하고
   오래된 시스템 python(3.9)으로 폴백해 `yt-dlp`가 깨지므로, `UV_PYTHON_INSTALL_DIR`/
   `UV_CACHE_DIR`은 평소 uv 캐시 위치로, `UV_PYTHON`은 최신 `python3`으로 지정해서
   실행한다. `deno`도 설치해 둔다(`yt-dlp`가 서명 추출용 JS 런타임이 없으면 일부 포맷을
   403으로 거부한다).
3. 생성된 작업 폴더에서 `session.json`/`lines.json`/`candidates.json`/`sheets.json`과
   `cand/*.jpg`/`sheets/*.jpg`만 `fixtures/work-<video-id>/`로 복사한다.
   `media/`(오디오·영상·자막·wav)는 위 미디어 캐시 경로로 옮기고 fixture에는 넣지 않는다.
4. `archive-seed/`는 `fc.ts init-archive`로 뼈대를 만들고 `roster.yaml`을
   `roster.cef.yaml` 내용으로 덮어쓴 뒤, 같은 채널의 과거 영상을 fetch→transcribe→scan하고
   `plan.json`/`notes.json`을 직접 작성해 `check plan`/`check notes`를 통과시키고,
   `similar-choices.json`(`{"version":1,"units":{}}`)과 `refs-draft.json`
   (`{"version":1,"refs":[]}`)을 빈 값으로 두어 `check similar`/`check refs`를 통과시킨
   뒤 `frames` → `verify-refs` → `render`로 만든다. 빌드용으로 잠깐 만든 `.git/`은
   커밋 전에 제외한다.

## 종료·결정 규칙 (plan §14.4, 원문 그대로)

- 반복: 회차마다 모델당 2회. 1회차에서 같은 스킬 버전 반복 간 점수 차 절댓값의 평균을
  σ로 기록(이후 회차마다 갱신된 σ도 기록).
- 종료: 최소 5회차(1회차부터 셈) AND 마지막 2회차의 모든 반복이 check 게이트 통과 AND
  (luna 평균이 2회차 연속 max(2, σ) 미만 향상 OR luna 평균 ≥ 90).
- sol 권고: 마지막 3회차 각각에서 sol 평균 > luna 평균 AND 3회차 평균 차이 > σ. 아니면
  luna 기반. 결과는 사용자 확정.
- held-out 영상 점수는 심사 40점만 별도 보고, 회차 평균에는 넣지 않음(과적합 경보용:
  held-out과 샘플의 심사 점수 차가 σ의 2배를 넘으면 보고).

확정 모델은 이 문서와 SKILL.md의 "권장 실행 모델" 한 줄에 기록한다.

## 환경 스모크

2026-09-28 관측(§14.1, MC-R0 이전). 두 모델 모두 아래 명령으로 실행했다.

```
codex exec --skip-git-repo-check -m <model> -c model_reasoning_effort=<effort> \
  --dangerously-bypass-approvals-and-sandbox --json -C <dir> - < prompt
```

- luna: `-m gpt-6-luna -c model_reasoning_effort=max` — exit 0, 이벤트 19개
- sol: `-m gpt-6-sol -c model_reasoning_effort=medium` — exit 0, 이벤트 13개

| 점검 항목 | luna max | sol med |
| --- | --- | --- |
| 웹 검색 후 결과 URL을 jq로 추출 | 성공 | 성공 |
| cand/c001.jpg 이미지 보기(OBS 오버레이가 있는 게임 화면을 정확히 기술) | 성공 | 성공 |
| `bun <스킬>/scripts/fc.ts config status` | exit 0 | exit 0 |
| 외부 URL(oembed) HEAD 요청 | 200 | 200 |
| ffmpeg·uvx 실행 가능 | 가능(`ffmpeg version 6.0`, `uvx 0.11.7`) | 가능(`ffmpeg version 6.0`, `uvx 0.11.7`) |

**이벤트 스트림 형태.** 한 줄에 JSON 객체 하나 —
`{"type": "thread.started"|"turn.started"|"item.started"|"item.completed"|"turn.completed", "item": {...}}`.
관측된 `item.type` 값:

- `agent_message` — `.item.text`
- `command_execution` — `.item.command`(예: `/bin/zsh -lc '<cmd>'`),
  `.item.exit_code`(item.started에서는 null, item.completed에서는 정수)
- `web_search` — `.item.query`, `.item.action.{type,query}`, 완료 시
  `.item.results[]`(각 원소는 domain, ref_id, snippet, title, type, url 키를 가짐)

**웹 검색 URL 추출.** 결과 URL은 `.item.results[].url`에서 직접 뽑을 수 있었다:

```
jq -r 'select(.item.type=="web_search" and .item.results) | .item.results[].url'
```

이 방식("URL ⊆ tool 결과")이 통과했으므로, 문자열 부분일치로 찾는 폴백 규칙은
쓸 필요가 없었다 — 다만 폴백 규칙 자체는 그대로 남겨 둔다(`harness/score.ts`의
`collectStrings` 전수 문자열 순회가 이미 `.item.results[].url`을 포함해 별도
web_search 추출기 없이도 커버한다).

## 결과

<!-- MC-R0(기준선)부터 MC-R{n}까지, 회차별 평균 점수(자동 60 + 심사 40)와 σ, luna/sol
비교, 최종 결정(MC-DECIDE)을 여기에 채운다. 각 회차의 상세는 rounds/round-{n}.md를
가리킨다. -->

(아직 회차 실행 전 — 회차가 끝날 때마다 이 절을 갱신한다.)

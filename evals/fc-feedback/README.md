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
    run.sh                     한 반복 실행: run.sh [--dry-run] <round> <model-key> <rep> <workdir-fixture>
                               [--no-skill] [--no-sandbox-isolation]
    materialize-skill.ts       run-dir 안에 스킬을 codex 배포 형태(.agents/skills+.agents/lib)로
                               복제(격리용 — 아래 "격리" 절)
    materialize-skill.test.ts  materialize-skill.ts 단위 테스트
    score.ts                   run-dir을 채점(gold F1, 태그 F1, 참고자료, 규율 위반 감점)
    score.test.ts              score.ts 단위 테스트
    prompts/
      eval-preamble.md         평가 모드 머리말(검토 게이트 자동 승인, 발행 게이트 거절, 경로 탐색 금지)
```

`baselines/<round>/<model>/rep<k>/`에는 매 반복마다 `plan.json`, `plan.validated.json`,
`notes.json`, `similar-choices.json`, `similar-candidates.json`, `refs-draft.json`,
`refs.verified.json`, `data.json`, `taxonomy.yaml`(아카이브 사본), `lines.json`,
`score.json`, `judge.md`, `run.jsonl.gz`(gzip 원본, 요약본이 아니다)를 남긴다.

## 입력 고정 (plan §15-2/§15-3, EVAL-PREP)

`fixtures/`는 다음 네 가지로 구성된다.

- `roster.cef.yaml` — 평가용 명단(실제 발행용이 아니다). 화면 게이머태그가 확인된 3명
  — 샘플 영상(C.E.F. / FC Barcelona 팀 연습, 2024-01-04 Part 3,
  `https://www.youtube.com/watch?v=NUzEChn9EyI`)의 HUD 스코어보드·텔레스트레이터
  라벨로 확인한 `TIMEJ`(코치), `Gerrard_CEF`, `CEF_VandeVen` — 에 더해, 사용자 확인
  (2026-09-28)으로 코치 음성 언급만 근거로 추가한 13명(화면 게이머태그 미확인,
  `gamertag: CEF_<로마자>` placeholder, 근거는 `gold/README.md` §5)까지 총 16명이다.
  포지션은 전부 코치 발화·화면 속 위치로만 추정한 것이라 파일 안에 `# 추정` 주석을
  달아 뒀다. sha256:
  `f8b6279fea9092bf202d0fa4bc7efb6e135a7ee7a17cc2b95f1513761a8ef63a`
- `work-NUzEChn9EyI/` — 위 샘플 영상의 `fetch`→`transcribe`→`scan` 산출물
  (`session.json`, `lines.json`, `candidates.json`, `sheets.json`, `cand/*.jpg`,
  `sheets/*.jpg`). 190줄, 후보 52개, 컨택트시트 5장. `lines.json`은 위 roster 확장에
  맞춰 2026-09-28에 alias 정규화만 다시 실행해 재생성했다(줄 수·`i`/`start`/`end`는
  기존과 동일, 텍스트 6곳만 변경 — 상세는 `gold/README.md` §7). sha256:
  `d259302a346105925b8936ed198322fcd1436549e6aa0406da6d2a77d1cbbf76`
- `work-yn-qm7lM5p4/` — held-out 영상(같은 채널의 다른 파트,
  `https://www.youtube.com/watch?v=yn-qm7lM5p4`, gold 없이 심사 점수만 반영해 샘플
  과적합을 감지하는 용도, plan §13.3) 산출물. 구성은 위와 동일, 92줄, 후보 45개,
  컨택트시트 5장. `lines.json`도 위 roster 확장에 맞춰 2026-09-28에 재생성해 확인했다
  — 이 영상 발화에는 새로 추가된 alias가 없어 줄 수·`i`/`start`/`end`·텍스트 전부
  기존과 바이트 단위로 동일했다. sha256(변경 없음):
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

## 격리

실제 round-0 실행에서 관측된 문제: codex 실행(`--dangerously-bypass-approvals-and-sandbox`,
cwd=임시 run-dir)이 레포의 `evals/fc-feedback` README·rubric·harness,
`projects/fc-feedback`의 DESIGN.md, `~/.omt` 아래 오케스트레이터 plan/spec을 스스로
찾아 읽었고, 한 실행은 레포 cwd에서 `fc.ts`를 직접 실행해 실제 `~/.fc-feedback`에 스텁을
만들었다. 레포 위치가 새는 경로는 세 가지였다: (1) `eval-preamble.md`가 `evals/fc-feedback`
경로와 "plan §"을 직접 언급, (2) `config set`에 넘기는 roster 경로가 레포 절대경로라
`manifest.yaml`에 그대로 박히고 `fc config status`가 그걸 되돌려줌, (3) 1회차부터는
`${CLAUDE_SKILL_DIR}` 치환이 레포 안 스킬 경로로 확장됨.

### 경로 비식별화 (모든 실행에 적용)

- **배포 형태 스킬 복제** (`materialize-skill.ts`) — `make sync`가 codex에 배포하는 것과
  같은 모양으로 run-dir 안에 스킬을 복제한다: `<run-dir>/.agents/skills/fc-feedback/`
  (SKILL.md·scripts/, 테스트·fixture 제외)와 그 형제 경로 `<run-dir>/.agents/lib/`(전이
  `@lib/` 의존성 + 선언된 bare import 벤더링, 예: `yaml` → `.agents/lib/vendor/yaml.js`).
  실제 sync 함수(`tools/sync.ts`의 `syncLib`, `tools/adapters/codex.ts`의
  `CodexAdapter.syncSkillsDirect`)를 그대로 재사용하고, `run_dir`을 sync 대상 `path`처럼
  취급한다 — 그래서 이 복제본은 실제 codex 배포 대상(sync target을 run-dir에 두었을 때)과
  경로 모양이 정확히 같다. 0회차(`--no-skill`)는 이 복제를 아예 만들지 않는다(스킬이
  없는 기준선이라는 전제를 지키기 위해).
- **`${CLAUDE_SKILL_DIR}` 치환**이 위 복제 경로(`<run-dir>/.agents/skills/fc-feedback`)로
  바뀐다 — 레포 안 소스 경로가 더 이상 프롬프트에 등장하지 않는다.
- **roster 경로**는 `config set` 전에 `fixtures/roster.cef.yaml`을 `<run-dir>/roster.cef.yaml`로
  복사한 뒤 그 경로를 넘긴다 — `manifest.yaml`과 `fc config status`가 노출하는 경로가
  run-dir 안쪽으로 한정된다.
- **prompt.txt 오염 검사** — 프롬프트를 다 만든 뒤 레포 루트 절대경로, `"evals/fc-feedback"`,
  `"plan §"` 세 패턴을 grep하고, 하나라도 걸리면 실행을 중단한다(향후 SKILL.md 본문이
  실수로 이런 문구를 담아도 잡아낸다).
- **manifest 격리** — `FC_FEEDBACK_MANIFEST_ROOT=<run-dir>/fc-manifests`를 `config set`과
  codex 프로세스 모두에 export한다(`projects/fc-feedback/skills/fc-feedback/scripts/manifest.ts`의
  계약: 이 값이 있으면 `$HOME/.fc-feedback`을 완전히 대체한다). 예전에 있던 "실행 후
  `~/.fc-feedback/<projectKey>` 삭제" 단계는 제거했다 — manifest가 애초에 run-dir 밖으로
  나가지 않으므로 `run.sh --cleanup`이 run-dir을 지우면 같이 사라진다.
- **병렬 회차 간 run-dir 격리는 이 permission profile로는 안 된다** — 여러 round/rep을
  동시에 돌리면 각자의 run-dir이 `$TMPDIR/fc-feedback-eval.*` 형제 디렉터리로 생기는데,
  permission profile은 "run-dir 자기 자신만 허용, 그 밖의 `fc-feedback-eval.*`는 전부
  거부" 같은 glob 기반 예외를 표현하지 못한다(경로를 하나씩 나열해야 하는데, 동시에 도는
  다른 run-dir 경로는 이 스크립트가 실행되는 시점에 알 수 없다). 대신 `harness/score.ts`의
  기존 오염 감지기(`otherRunDirTargets`/`computeContaminationTargets`/`scoreContamination`)가
  `run.jsonl`에 기록된 모든 명령을 검사해 다른 `fc-feedback-eval.*` run-dir을 건드린
  명령이 있으면 오염으로 채점한다 — OS 수준 차단이 아니라 채점 시점 탐지로 커버하는
  영역이다. (TMPDIR 자체를 거부하고 codex 프로세스의 `TMPDIR`을 run-dir 안쪽으로 재지정한
  뒤 run-dir 경로만 다시 허용하는 "거부 안에 중첩 허용" 방식이 되는지는 조사하지 않았다 —
  이번 범위에서는 위 채점-시점 탐지로 충분하다고 판단했다.)

### OS 수준 read 제한 — 존재함, 연결함 (codex-cli 0.157.1)

`codex exec --help`/`codex sandbox --help`/`~/.codex/config.toml` 조사 결과: codex는 내장
프로필 세 개(`:read-only`/`:workspace`/`:danger-full-access`, `codex exec -s <mode>`와
대응)만으로는 read를 막지 않는다 — 빌트인 세 프로필 모두 "쓰기·네트워크만 제한, 읽기는
전체 허용"이며, `:workspace`로 레포와 `~/.omt`를 실제로 읽을 수 있음을 직접 확인했다.
그런데 codex는 **커스텀 permission profile**(`codex-rs/config/src/permissions_toml.rs`의
`PermissionProfileToml.filesystem`, 경로별 `"read"|"write"|"deny"`)을 지원하고, `deny`는
읽기·쓰기를 모두 막는다. 거부 목록은 레포 루트 하나가 아니라, 이 워크트리가 속한
**모든 워크트리의 공통 부모 디렉터리**(`git rev-parse --git-common-dir`의 결과에서 한 단계
위 — bare 레포 + 형제 워크트리들이 함께 있는 디렉터리; 해석 실패 시 이 워크트리 루트로
폴백)와, 실제 `$HOME/.omt`·`$HOME/.fc-feedback`·`$HOME/.claude`(Claude Code 프로젝트 대화
기록)·`$HOME/.pins`, 그리고 이전 실행이나 이 작업을 오케스트레이션하는 세션 자체를 드러낼
수 있는 `$HOME/.codex` 아래 대화 기록/이력 경로들(`sessions`, `archived_sessions`,
`history.jsonl`, `session_index.jsonl`, `rollout-migrations`, `shell_snapshots`,
`transcription-history.jsonl`, `dictation-history`)을 함께 담는다. `$HOME/.codex`의
`auth.json`과 codex 자신의 런타임 상태(`goals_*.sqlite` 등 큐/메모리/목표 저장소)는
의도적으로 거부 목록에서 뺐다 — codex가 이번 실행 자체를 인증하고 동작하는 데 쓰는
경로라 막으면 실행이 깨질 수 있고, 대화/세션 이력만큼 민감한 정보를 담지 않는다는
판단이다(과도하게 보수적으로 잡았으니, 더 좁혀도 된다는 뜻이지 더 넓혀야 한다는 뜻은
아니다). `codex sandbox`(모델 호출 없는 로컬 seatbelt 실행기)로 실측 검증했다(스크래치
run-dir 하나에 대해 9개 점검 전부 통과 — 6개 거부 경로는 전부 `Operation not permitted`로
막혔고, run-dir 자신·미디어 캐시·네트워크 3개는 전부 성공):

```
perm="permissions.fc-eval-isolate={extends=\":workspace\",network={enabled=true},filesystem={\"<worktrees-parent>\"=\"deny\",\"$HOME/.omt\"=\"deny\",\"$HOME/.fc-feedback\"=\"deny\",\"$HOME/.claude\"=\"deny\",\"$HOME/.pins\"=\"deny\",\"$HOME/.codex/sessions\"=\"deny\", ...}}"

codex sandbox -c "$perm" -P fc-eval-isolate -C <run-dir> -- cat <repo-root>/CLAUDE.md
  -> cat: Operation not permitted   (exit 1 — <repo-root>는 <worktrees-parent> 아래에 있다)
codex sandbox -c "$perm" -P fc-eval-isolate -C <run-dir> -- ls <worktrees-parent>
  -> ls: Operation not permitted    (exit 1 — 이 레포의 다른 모든 워크트리도 함께 막힌다)
codex sandbox -c "$perm" -P fc-eval-isolate -C <run-dir> -- ls "$HOME/.omt"
  -> ls: Operation not permitted    (exit 1)
codex sandbox -c "$perm" -P fc-eval-isolate -C <run-dir> -- ls "$HOME/.codex/sessions"
  -> ls: Operation not permitted    (exit 1)
codex sandbox -c "$perm" -P fc-eval-isolate -C <run-dir> -- ls "$HOME/.claude"
  -> ls: Operation not permitted    (exit 1)
codex sandbox -c "$perm" -P fc-eval-isolate -C <run-dir> -- ls "$HOME/.pins"
  -> ls: Operation not permitted    (exit 1)
codex sandbox -c "$perm" -P fc-eval-isolate -C <run-dir> -- cat <run-dir>/.fc-eval-run-dir
  -> smoke-marker                   (exit 0)
codex sandbox -c "$perm" -P fc-eval-isolate -C <run-dir> -- ls "$HOME/.cache/fc-feedback-eval/<video-id>"
  -> audio captions video wav       (exit 0, 미디어 캐시는 그대로 읽힌다)
codex sandbox -c "$perm" -P fc-eval-isolate -C <run-dir> -- curl -sI https://example.com
  -> HTTP/2 200                     (exit 0, network={enabled=true}가 :workspace의
                                      기본 network-restricted를 뒤집는다)
```

`-c permissions.<name>=<inline TOML>`과 `-c default_permissions=<name>`은 둘 다 일반
`ConfigToml` 오버라이드라 `codex sandbox`(스모크용)와 `codex exec`(실제 실행) 양쪽에 같은
방식으로 먹는다 — `codex exec`에는 `codex sandbox`의 `-P` 같은 전용 플래그가 없어서
`default_permissions`로 활성 프로필을 고른다. `run.sh`는 이를 `--no-sandbox-isolation`으로
끌 수 있는 기본 ON 플래그로 연결했다: 실제 `codex exec` 호출마다 (1) 위와 같은 4가지 점검을
`codex sandbox`로(모델 호출 없이) 먼저 돌려 기대대로 막히고/뚫리는지 확인하고 실패하면
실행 자체를 중단하며, (2) 통과하면 `--dangerously-bypass-approvals-and-sandbox` 대신 같은
`-c` 오버라이드로 `codex exec`를 돌린다.

**검증하지 못한 부분.** `codex sandbox`는 모델을 호출하지 않는 로컬 실행기라 반복
검증했지만, 이 정책을 켠 채 실제로 model turn을 도는 `codex exec`(비용이 드는 실제 실행)는
이번 범위에서 돌리지 않았다 — `codex exec`가 seatbelt 정책을 적용하는 실행 엔진은
`codex sandbox`와 공유되므로(같은 `FileSystemSandboxPolicy`/seatbelt 실행기) read/write
차단 동작 자체는 같은 근거로 신뢰할 수 있지만, sandbox가 막은 명령을 모델이 만났을 때
`codex exec`의 승인 정책이 사람 입력을 기다리며 멈추는지는 직접 관측하지 못했다(`codex
exec --help`에는 대화형 승인 프롬프트 관련 플래그가 없고, "non-interactively"라는 설명과
맞물려 승인 대기 없이 실패를 모델에 그대로 보고할 것으로 추정한다). 다음 실제 회차
실행 1회를 확인 실행으로 삼아 이 가정을 검증하는 것을 권장한다.

`$HOME/.codex/sessions`를 거부 목록에 넣으면 codex 자신이 이번 실행의 세션/rollout을
그 경로에 쓰는 동작과 충돌할 수 있어서(`deny`는 쓰기도 막는다), `codex exec`에
`--ephemeral`(`--help` 설명: "Run without persisting session files to disk")을 함께
붙여 애초에 그 경로에 아무것도 쓰지 않게 했다. `--ephemeral`이 세션 디렉터리 쓰기를
정확히 어떤 내부 경로 단위로 끄는지는 codex-rs 소스에서 `history_mode` 게이팅까지는
확인했지만 GitHub API 요청 한도에 걸려 더 깊이 추적하지 못했다 — `codex sandbox`
스모크로는 `--ephemeral`의 쓰기-생략 동작 자체를 관측할 수 없다(스모크는 모델을 부르지
않는 별도 실행기라 세션을 애초에 만들지 않는다). 다음 실제 실행 확인 때 `--ephemeral` +
이 거부 목록 조합에서 codex가 정상 종료하는지(세션 쓰기 실패로 에러를 내지 않는지)를
함께 확인하는 것을 권장한다.

### 별도 방어선 (이번 범위 밖, 참고용)

`harness/score.ts`는 이미 `git push` 시도·게이트 순서 위반을 감점 대상으로 채점한다
(`detectPushAttempt`, `detectGateOrderViolation`). 여기 더해 오염 감지기
(`computeContaminationTargets`/`scanCommandContamination`/`scoreContamination`)가
`run.jsonl`에 기록된 모든 실행 명령을 검사해 `evals/fc-feedback`, `projects/fc-feedback`,
`~/.omt/**/plans/fc-feedback*`, 그리고 다른 `fc-feedback-eval.*` run-dir(위 "병렬 회차 간
run-dir 격리" 참고)을 실제로 읽거나 검색한 흔적이 있으면 `contaminated: true`로 채점에서
제외한다(단순 언급만으로는 오염 처리하지 않는다 — 읽기/검색/출력에 실제로 등장해야 한다).
이번 작업 범위는 harness(`run.sh`, `materialize-skill.ts`, `eval-preamble.md`)로 한정되어
`score.ts` 자체는 건드리지 않았다.

## 결과

<!-- MC-R0(기준선)부터 MC-R{n}까지, 회차별 평균 점수(자동 60 + 심사 40)와 σ, luna/sol
비교, 최종 결정(MC-DECIDE)을 여기에 채운다. 각 회차의 상세는 rounds/round-{n}.md를
가리킨다. -->

(아직 회차 실행 전 — 회차가 끝날 때마다 이 절을 갱신한다.)

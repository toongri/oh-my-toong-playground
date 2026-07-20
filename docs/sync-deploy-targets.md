# make sync 배포 타겟 해석 — bare 레포 fan-out

`make sync`는 `sync.yaml`의 `path`를 그대로 하나의 디렉토리로 쓰지 않는다. 그
경로를 먼저 **실제로 쓸 배포 타겟 집합**으로 해석하는데, bare 기반 레포(여러
워크트리를 거느린 `.bare` 컨테이너)면 한 경로가 **여러 워크트리로 fan-out**된다.
이 해석은 `tools/lib/resolve-deploy-targets.ts`가 담당한다.

## preflight 게이트: default 브랜치 + clean 트리

`make sync`(dry-run 제외)는 워크트리 해석이 시작되기도 전에 OMT 레포 **자신**의
상태를 검사한다. 검사 대상은 이 OMT 레포 자체이지, 배포 타겟 레포(algocare-home
등, 아래 절들이 다루는 "워크트리")가 아니다. 게이트는 `tools/lib/preflight-git.ts`에
있고 `tools/sync.ts`의 진입점에서 순서대로 호출된다(`assertDefaultBranch` →
`assertCleanWorktree`) — 브랜치가 틀린 게 더 근본적인 문제이므로 브랜치를 먼저
본다.

- **default 브랜치 게이트** — 현재 브랜치가 `git symbolic-ref
  refs/remotes/origin/HEAD`로 해석한 default 브랜치가 아니면 non-zero exit.
  origin/HEAD를 해석할 수 없으면(설정 안 됨) 통과가 아니라 거부한다 — "모르겠으니
  통과"는 게이트를 무력화하므로 "모르겠으니 거부"로 degrade한다(복구 힌트:
  `git remote set-head origin -a`). detached HEAD도 거부한다.
- **clean 트리 게이트** — `git status --porcelain --untracked-files=normal`에
  staged / unstaged / untracked 중 하나라도 잡히면 non-zero exit.
  `--untracked-files=normal`은 repo-local/global/`GIT_CONFIG_*`의
  `status.showUntrackedFiles=no` 설정이 untracked 파일을 숨기는 걸 막기 위해
  반드시 붙여야 하는 반면, `--ignored`는 여전히 붙이면 안 된다 — gitignored
  파일은 이 명령의 출력에 안 잡히므로 더티로 세지 않는다. 이 레포의
  `sync.local.yaml`이 gitignored인데(`.gitignore:12`의 `**/*.local.yaml`) 이걸
  더티로 세면 `make sync`가 영구히 막힌다.
- **`--dry-run`은 게이트 대상이 아니다** — `make sync-dry`는 더티 트리나
  비-default 브랜치에서도 그대로 동작한다. 쓰기가 없으므로 커밋 전 미리보기
  수단을 남겨두려는 의도적 예외다.
- **게이트를 끄는 전용 스위치는 없다 — 사고 방지 장치이지 적대자 방지
  장치는 아니다.** 게이트를 끄는 전용 환경변수도 CLI 플래그도 없다
  (`tools/lib/preflight-git.ts`의 `GIT_BINARY`/`runGit` 주석 참고 — 고정
  절대경로 호출로 PATH shim 축이 닫혔다). env는 `HOME`/`XDG_CONFIG_HOME`만
  통과시킨다 — `GIT_DIR`/`GIT_WORK_TREE`/`GIT_CONFIG_*`처럼 레포를
  리디렉션하거나 config를 주입하는 축은 계속 막되, 이 둘은 git이 **전역
  excludes파일**(`$XDG_CONFIG_HOME/git/ignore` → `$HOME/.config/git/ignore`)을
  찾는 경로라 열어둔다 — 막으면 그 파일로만 제외되던 항목이 더티로 잡혀
  `make sync`가 영구히 막힌다. 바로 아래 `sync.local.yaml` 예외와 **같은
  요구사항**이다. 목적은 AI 에이전트가 승인 없이 미커밋 상태나 엉뚱한
  브랜치에서 무심코 배포하는 것을 막는 것이고, 그 목적은 달성됐다.

  다만 그 대가로 실제 우회 경로가 하나 열려 있다(실측됨) — 아래 두 축과
  달리 레포 자체는 건드리지 않고 레포 **밖의 ambient 환경**만 바꿔서
  닿는다: `HOME`을 다른 디렉토리로 갈아끼우고 그 아래 `.gitconfig`에
  `core.excludesFile`이 `*` 한 줄짜리 파일을 가리키게 하면, 실제 미커밋
  파일이 있는 레포에서도 `assertCleanWorktree`가 clean으로 오판한다.
  에이전트 입장에서는 `HOME=/tmp/x make sync`처럼 명령 앞에 접두어 한
  토큰을 붙이는 것과 같다. `os.homedir()`도 env `HOME` 변조를 그대로
  따라가 spoof-proof한 대안이 없어(실측 확인) 코드로 닫을 수 없고, 이 두
  env var를 아예 막으면 `core.excludesFile` 요구사항 자체가 깨지므로(환경변수를
  전부 비웠던 단계에서 전역 excludes 파일에 도달하지 못하게 됐던 것과 같은
  회귀) — 의도적 미차단이다.

  레포 안에서 **의도적으로** 조작하면 다음 축들도 여전히 열려 있다(실측됨)
  — 새 형태(예: `core.worktree` 리디렉션, 조작된 `core.fsmonitor` hook)가
  나올 수 있어 개수를 고정하지 않는다:
  - `.git/info/exclude`에 `*` 한 줄 또는 repo-local `core.excludesFile` —
    둘 다 untracked 파일을 `git status`에서 지워 clean으로 오판시킨다. 위
    `sync.local.yaml` gitignore 예외와 **같은 메커니즘**이지 별개의 구멍이
    아니다.
  - 인덱스 플래그 `git update-index --assume-unchanged <file>` 또는
    `--skip-worktree <file>`로 추적 파일의 수정을 숨긴다(실측: 수정 후
    `--skip-worktree`를 걸면 `git status --porcelain
    --untracked-files=normal`이 빈 출력을 낸다).

  전부 코드로 막지 않는다 — gitignored 파일을 더티로 세지 않아야 한다는
  요구사항과 `.git/info/exclude`가 **바로 그 gitignore 메커니즘 자체**라는
  사실이 충돌하기 때문이다. 코드로 분리하려면 "무엇이 무시 가능한가"의 판단을
  git에서 OMT 소스로 옮기고 명시적 예외 목록을 새로 유지해야 하는데, 이는 위험한
  git 환경변수를 하나하나 열거해 제거하던 deny-list 방식에서 없앤 열거 실패
  모드를 다시 들여오는 것이다. 의도적 미차단이며, 이 트레이드오프를 문서에 적는 것이 그 결정이다.
- **`Makefile`이 아니라 `tools/sync.ts` 진입점에 있다** — Makefile
  prerequisite로 걸었다면 `bun run tools/sync.ts`로 직접 호출해 우회할 수
  있었을 것이다. 진입점 자체에 박아 `make sync` 경로와 직접 호출 경로 둘 다
  막는다.

## 단일 경로 vs bare fan-out

- **평범한 디렉토리** → 그 경로 하나가 타겟(`[path]`).
- **bare 기반 레포** → `git worktree list --porcelain`을 돌려 딸린 **모든 live
  워크트리**를 각각 타겟으로 잡는다. 한 번의 `make sync`가 그 레포의 워크트리
  전부에 동시에 반영된다.

즉 `path`가 `~/repos/algocare-home`처럼 bare+멀티워크트리면 `.claude/`(등)가
`almond-aletopelta`·`denim-sturgeon`·`stage`… 워크트리마다 따로 배포된다.

## 워크트리 제외 규칙

`git worktree list` 결과에서:

- **제외** — bare 블록 자신(`bare` 마커), prunable 워크트리(`prunable` 마커).
- **포함** — locked·detached 워크트리. 이들은 여전히 실 작업 트리라 배포 대상이다.

## 배포 독립성과 실패 처리

- 워크트리별로 **독립 배포**한다(각자 fresh accumulator) — 한 워크트리의 상태가
  다른 워크트리로 새지 않는다.
- **best-effort**: 한 워크트리 배포가 실패하면 그 경로와 함께 로그로 남기고
  나머지 워크트리는 계속 진행한다. 단 하나라도 실패하면 **전체 sync는 non-zero
  exit**으로 끝난다 — 쓰지 못한 워크트리를 "깨끗한 sync"로 보고하지 않는다.
- **0 워크트리 / git 오류**: 경로가 (bare·prunable 제외 후) 워크트리 0개로
  해석되거나 `git worktree list` 자체가 실패하면 `DeployTargetsError`로 **시끄럽게**
  실패한다. 조용히 빈 타겟을 반환하면 아무것도 안 쓰고도 성공처럼 보이기 때문이다.

## 배포후 포맷(format-on-deploy)

`sync.yaml`이 top-level `format`(예: `format: "pnpm exec prettier --write"`)을
선언하면, 각 워크트리 배포가 끝난 뒤(플랫폼 경로 rewrite 다음, 워크트리 catch
직전) 그 명령을 **타겟 cwd(deployRoot)**에서 한 번 실행한다. `format`은 **문자열**
(공백 토큰화 — 단순 케이스, 셸 인용 미지원) 또는 **문자열 배열**(argv로 그대로 사용
— 공백 든 인자, 예: config 경로가 필요할 때)을 받는다. 목적은 배포 `.md`
—특히 CJK 표—가 타겟 **자기 포매터의 정규형 바이트**로 착지하게 하는 것이다.
그러지 않으면 OMT-raw로 착지한 `.md`를 타겟 prettier가 커밋/CI(`prettier --check`)
마다 재포맷해, 매 sync마다 **가짜 diff(ping-pong churn)**가 떠 진짜 변경을 가린다.

- **대상(소유권 경계)**: 포매터에 넘기는 것은 **OMT-관리 루트만**이다 — 존재하는
  플랫폼 dir(`.claude`/`.gemini`/`.codex`/`.opencode`) + codex 스킬 per-name
  (`.agents/skills/<name>`, OMT가 이번 run에 배포한 이름만 — 공유 공간의 foreign
  resident는 제외) + 배포한 docs leaf 파일. `.`(전체 레포)은 절대 안 넘긴다. 루트
  **내부**의 실제 포맷 대상은 타겟 자기 `.prettierignore`/`.prettierrc`가 결정한다.
  각 루트는 realpath가 deployRoot 하위에 있어야 넘어간다 — 워크트리 밖으로의
  **심링크 탈출**(예: `.claude`가 `$HOME/.claude`로의 링크)은 제외해, 포매터가
  deploy root 밖을 재귀 재작성하지 못하게 한다.
- **실패 처리**: format 실패(non-zero exit 또는 명령 미설치 ENOENT)는 그 워크트리를
  위 "배포 독립성과 실패 처리"의 `failedTargets`로 흘려 **best-effort**로 처리한다 —
  다른 워크트리는 계속되고, 하나라도 실패하면 전체 sync가 non-zero exit이다.
- **dry-run skip**: `make sync-dry`는 이 포맷 패스를 실행하지 않는다.
- 미선언(`format` 없음) 타겟은 이 단계 없이 기존대로 raw 배포된다(하위호환).

## 백업 위치

`make sync`가 덮어쓸 파일을 백업하는 곳은 타겟 레포 안이 아니라 **단일
OMT 소유 루트**다:

```
<base>/sync-backup/<target>-<worktree>-<hex>/<platform>/<category>/
```

- `<base>`는 `$OMT_DIR`, 없으면 `~/.omt/<projectName>`.
- `<target>`은 `sync.yaml`의 `path`(컨테이너), `<worktree>`는 그 경로가
  해석된 개별 워크트리, `<hex>`는 deploy(target×worktree) 하나당 새로
  생성된다.
- 백업은 write-only다 — restore 경로는 없다. 나이 기준으로만
  프룬한다(`backup_retention_days`, 기본 3일).

타겟 레포 안에 `.sync-backup/`이 남던 예전 동작과 달리, 이제 백업이
그 레포의 CI나 prettier를 오염시키지 않는다.

## startup fail-fast

백업 base(`<base>`)가 degenerate하면 — 상대경로, `/`, 또는 홈
디렉토리면 — `make sync`(그리고 `make sync-dry`)는 배포를 시작하기
**전에** `UnsafeBackupRootError`로 중단하고 `process.exit(1)` 한다.
이 경우 워크트리 해석이나 파일 쓰기는 전혀 일어나지 않는다.

## 중복 처리(dedup)

처리된 경로는 컨테이너 경로가 아니라 **정규 워크트리 경로** 기준으로 기록된다.
그래서 두 번째 `sync.yaml`이 워크트리를 직접 가리켜도 "이미 처리됨"으로 인식돼
중복 배포되지 않는다.

## 검증 함의

bare 타겟을 sync한 뒤 **한 워크트리만** 열어 "반영됐다"고 판단하면 안 된다 —
변경은 모든 워크트리에 퍼졌으므로 검증도 워크트리 전반으로 해야 한다. 무엇이
어디로 배포되는지 미리 보려면 `make sync-dry`가 워크트리별 타겟 라인을 나열한다.

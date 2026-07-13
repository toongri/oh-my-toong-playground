# make sync 배포 타겟 해석 — bare 레포 fan-out

`make sync`는 `sync.yaml`의 `path`를 그대로 하나의 디렉토리로 쓰지 않는다. 그
경로를 먼저 **실제로 쓸 배포 타겟 집합**으로 해석하는데, bare 기반 레포(여러
워크트리를 거느린 `.bare` 컨테이너)면 한 경로가 **여러 워크트리로 fan-out**된다.
이 해석은 `tools/lib/resolve-deploy-targets.ts`가 담당한다.

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

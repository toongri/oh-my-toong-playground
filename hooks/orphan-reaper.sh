#!/bin/bash
# =============================================================================
# Orphan Reaper -- SessionStart hook (3계층 방어의 계층 3, 두 번째 트리거)
#
# code-review의 chunk-review job은 워커를 detached 프로세스 그룹으로
# 띄운다. 컨덕터(conductor)가 teardown에 도달하지 못하고 죽으면 그 워커들이
# 고아로 남는다 -- lib/generic-job.ts의 findOrphanJobs/reapOrphanJobs(커밋
# e41027e4)가 판정/회수 엔진이고, job.ts reap(skills/code-review/
# scripts/job.ts, 커밋 a8edc7d3)이 그 서브커맨드다. 지금까지 이 회수의
# 유일한 트리거는 cmdStart -- 즉 "다음 job을 새로 시작할 때"뿐이라, 리뷰를
# 다시 돌리지 않으면 고아는 영영 회수되지 않는다. 이 훅은 "새 세션을 열면
# 거둔다"는 두 번째 트리거를 추가한다.
#
# stdout 계약 (CLAUDE.md 캐시-안전 컨텍스트 주입 규칙): SessionStart 훅의
# stdout은 대화 프리픽스에 직접 주입된다. 회수 건수처럼 세션마다 달라지는
# 값이 거기 섞이면 매 세션 KV 캐시가 통째로 무효화된다 -- 이건 성능
# 최적화가 아니라 정확성 요건이다. job.ts reap은 이미 stdout에 아무것도
# 쓰지 않지만(모든 진단은 stderr), 이 훅은 그 계약을 신뢰하지 않고 호출
# 지점에서 stdout을 구조적으로 /dev/null에 봉인한다 -- 자기 자신도 아무것도
# echo하지 않는다.
#
# 10초 예산: job.ts reap의 기본 유예(grace)는 5초이고, 회수할 고아가
# 1개 이상이면 그 유예를 기다린다(0개면 건너뛴다, lib/generic-job.ts
# reapOrphanJobs). 고아가 있는 세션에서 이 훅이 그것을 동기로 기다리면
# SessionStart 예산(10초)의 절반 이상을 소모한다. --grace-ms를 줄여 동기
# 실행하는 대신(옵션 a), 전체 reap 호출을 백그라운드로 detach한다(옵션 b,
# 채택) -- AC가 요구하는 "SIGTERM 단계만 동기, SIGKILL 단계는 detach"
# 문구에 옵션 b가 더 가깝고, 무엇보다 세션 시작 자체를 절대 지연시키지
# 않는다. 회수는 job.ts reap 프로세스
# 안에서(SIGTERM -> grace -> SIGKILL) 백그라운드로 계속되며, 그 표준출력은
# 여전히 /dev/null로 봉인하고(stdout 계약, 위 문단) 표준에러는
# $OMT_DIR/logs/orphan-reaper.log 파일로 리다이렉트한다. 파일로 리다이렉트
# 하는 것도 /dev/null과 마찬가지로 하니스가 캡처 중인 원래 stdout/stderr
# 파이프의 fd를 더는 참조하지 않게 만든다 -- 이 훅 프로세스가 종료한 뒤에도
# 그 파이프를 열어둔 채로 있으면 하니스가 EOF를 기다리며 백그라운드
# 프로세스가 끝날 때까지 세션 시작이 지연될 수 있는데, 파일이든 /dev/null
# 이든 원래 파이프에서 분리되는 지점은 동일하다. 이 회수 엔진은 그룹 kill이
# 못 잡은 잔여 PID를 죽이지 않고 stderr로만 보고하도록 설계됐다(오살보다
# 미회수 원칙, lib/generic-job.ts reapOrphanJobs) -- 그 보고가 /dev/null로
# 가면 사람이 개입할 유일한 신호가 사라지므로, stdout 계약은 유지한 채
# stderr만 로그로 보존한다.
#
# cwd 고정 (bunfig.toml preload 취약점): bun은 자신의 cwd에 있는
# bunfig.toml을 읽어 그 preload를 엔트리포인트보다 먼저 실행한다. 이 훅은
# SessionStart에서 세션 cwd -- 즉 사용자가 방금 열었을 수 있는 임의의
# 신뢰하지 않는 레포 -- 를 그대로 물려받으므로, 고치지 않으면 그 레포의
# bunfig.toml이 에이전트 동작 없이 사용자 권한으로 실행된다. $JOB_TS가
# 절대경로인 것은 이를 막지 못한다 -- bunfig 탐색 기준은 cwd이지 엔트리
# 포인트의 위치가 아니다. bun은 bunfig.toml을 상위 디렉터리로 탐색하지
# 않으므로(실측: 하위 디렉터리에서 실행하면 상위의 bunfig가 적용되지
# 않음), cwd를 OMT 소유 디렉터리($SCRIPT_DIR)로 고정하는 것만으로 이
# 경로가 닫힌다. OMT_DIR을 명시로 함께 넘기는 이유: job.ts의
# DEFAULT_JOBS_DIR(skills/code-review/scripts/job.ts)은 모듈
# 레벨 상수라 서브커맨드와 무관하게 import 시점에 getOmtDir()를 호출하고,
# 그것이 mkdirSync(recursive)로 디렉터리를 생성한다 -- cwd만 SCRIPT_DIR로
# 옮기면 배포 레이아웃($HOME/.claude/hooks, git 레포 아님)에서
# deriveProjectName이 basename(cwd)로 후퇴해 $HOME/.omt/hooks를 새로
# 만들어버린다. OMT_DIR을 env로 넘기면 resolveOmtDir이 그것을 최우선으로
# 읽어 getOmtDir()의 cwd 의존을 끊는다.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOB_TS="$SCRIPT_DIR/../skills/code-review/scripts/job.ts"

# fail-open: code-review가 배포되지 않은 타겟에서는 아무것도 하지
# 않고 조용히 성공 종료한다. 이 상대경로는 레포 레이아웃
# (<repo>/hooks/../skills/code-review/scripts/job.ts)과 배포 후
# 레이아웃($HOME/.claude/hooks/../skills/code-review/scripts/job.ts
# = $HOME/.claude/skills/code-review/scripts/job.ts) 양쪽에서 성립한다.
if [ ! -f "$JOB_TS" ]; then
  exit 0
fi

# fail-open: jq 부재 시 아무것도 하지 않고 조용히 성공 종료 (기존 훅들의 규약)
if ! command -v jq &> /dev/null; then
  exit 0
fi

INPUT=$(cat)
DIRECTORY=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
if [ -z "$DIRECTORY" ] || [ "$DIRECTORY" = "null" ]; then
  DIRECTORY=$(pwd)
fi

# OMT_DIR 해석은 직접 구현하지 않고 공유 라이브러리를 쓴다
# (pre-tool-enforcer.sh:405-500과 같은 BASH_SOURCE 기준 소싱 패턴).
# shellcheck source=hooks/lib/omt-dir.sh
source "$SCRIPT_DIR/lib/omt-dir.sh"
OMT_DIR_RESOLVED=$(resolve_omt_dir "$DIRECTORY")

# 전체 reap 호출을 백그라운드로 detach -- 위 주석의 10초 예산 근거대로,
# 훅은 이 시점에서 즉시 반환한다. stdout은 /dev/null로 봉인하고(이유는
# 파일 헤더의 stdout 계약 참조), stderr는 로그 파일로 append한다 -- 로그
# 디렉터리가 없거나 만들 수 없으면(권한 없음 등) fail-open으로 예전처럼
# /dev/null로 후퇴한다(훅은 어느 경로든 exit 0으로 조용히 끝난다).
LOG_DIR="$OMT_DIR_RESOLVED/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || true

if [ -d "$LOG_DIR" ]; then
  (cd "$SCRIPT_DIR" && OMT_DIR="$OMT_DIR_RESOLVED" bun "$JOB_TS" reap --jobs-dir "$OMT_DIR_RESOLVED/jobs" > /dev/null 2>>"$LOG_DIR/orphan-reaper.log" &)
else
  (cd "$SCRIPT_DIR" && OMT_DIR="$OMT_DIR_RESOLVED" bun "$JOB_TS" reap --jobs-dir "$OMT_DIR_RESOLVED/jobs" > /dev/null 2>/dev/null &)
fi

exit 0

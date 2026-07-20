# Sync 운영 판단 참조

`make sync`의 배포 타겟 해석·fan-out, per-platform YAML config/hooks의 배포 착지점을 이해해야 할 때 아래 문서를 연다.

- `docs/sync-deploy-targets.md` — **make sync 배포 타겟 해석**: bare 레포 fan-out(`git worktree list`), 워크트리 제외 규칙(bare·prunable·locked·detached), 워크트리별 독립 배포·best-effort 실패 처리(non-zero exit), 0-워크트리 loud 실패(`DeployTargetsError`), 정규경로 dedup, 배포 검증(`make sync-dry`), preflight 게이트(default 브랜치·clean 트리, `--dry-run` 예외)
- `docs/platform-yaml-config-deployment.md` — **per-platform YAML config 배포**: config·hooks·mcps가 대상 `.claude/settings.local.json`으로 deep-merge(전역 sync만 `settings.json`), 2계층 gitignore(OMT `**/*.local.yaml`=버전관리 축 · 대상 `settings.local.json` ignore=팀 유출 차단 축), 개인 절대경로는 `claude.yaml`에 둬도 안전(팀 미유출+OMT 버전관리·워크트리 소실 생존)

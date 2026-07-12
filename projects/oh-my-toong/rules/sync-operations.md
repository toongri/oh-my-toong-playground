# Sync 운영 판단 참조

`make sync`의 배포 타겟 해석·fan-out을 이해해야 할 때 아래 문서를 연다.

- `docs/sync-deploy-targets.md` — **make sync 배포 타겟 해석**: bare 레포 fan-out(`git worktree list`), 워크트리 제외 규칙(bare·prunable·locked·detached), 워크트리별 독립 배포·best-effort 실패 처리(non-zero exit), 0-워크트리 loud 실패(`DeployTargetsError`), 정규경로 dedup, 배포 검증(`make sync-dry`)

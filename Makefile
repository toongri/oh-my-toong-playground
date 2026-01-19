.PHONY: sync sync-dry help

help:
	@echo "사용 가능한 명령어:"
	@echo "  make sync      - 모든 sync.yaml 파일 동기화 실행"
	@echo "  make sync-dry  - 동기화 미리보기 (실제 변경 없음)"

sync:
	@./scripts/sync.sh

sync-dry:
	@./scripts/sync.sh --dry-run

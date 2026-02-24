.PHONY: sync sync-dry validate validate-schema validate-components validate-tests test help

help:
	@echo "사용 가능한 명령어:"
	@echo "  make sync               - 모든 sync.yaml 파일 동기화 실행"
	@echo "  make sync-dry           - 동기화 미리보기 (실제 변경 없음)"
	@echo "  make validate           - 전체 검증 (스키마 + 컴포넌트)"
	@echo "  make validate-schema    - 스키마 검증 (필드, 값 유효성)"
	@echo "  make validate-components - 컴포넌트 검증 (파일 존재 여부)"
	@echo "  make test               - 전체 테스트 실행 (Shell + TypeScript)"

sync: validate validate-tests
	@./scripts/sync.sh

sync-dry: validate
	@./scripts/sync.sh --dry-run

validate: validate-schema validate-components

validate-schema:
	@./scripts/validate-schema.sh

validate-components:
	@./scripts/validate-components.sh

validate-tests:
	@./scripts/run-tests.sh

test: validate-tests

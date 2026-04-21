.PHONY: sync sync-dry validate validate-schema validate-components validate-forbidden-tokens validate-cross-refs validate-tests test pull pull-dry help

help:
	@echo "사용 가능한 명령어:"
	@echo "  make sync               - 모든 sync.yaml 파일 동기화 실행"
	@echo "  make sync-dry           - 동기화 미리보기 (실제 변경 없음)"
	@echo "  make validate           - 전체 검증 (스키마 + 컴포넌트 + 금지 토큰)"
	@echo "  make validate-schema    - 스키마 검증 (필드, 값 유효성)"
	@echo "  make validate-components - 컴포넌트 검증 (파일 존재 여부)"
	@echo "  make validate-forbidden-tokens - 금지 토큰 검증 (레거시 용어 방지)"
	@echo "  make validate-cross-refs    - 교차 참조 대칭 검증 (7 assertion)"
	@echo "  make test               - 전체 테스트 실행 (Shell + TypeScript)"
	@echo "  make pull PROJ=<name>   - 프로젝트 배포 파일을 소스로 풀백"
	@echo "  make pull-dry PROJ=<name> - 풀백 미리보기 (실제 변경 없음)"

sync: validate validate-tests
	@bun run tools/sync.ts

sync-dry: validate
	@bun run tools/sync.ts --dry-run

validate: validate-schema validate-components validate-forbidden-tokens

validate-schema:
	@bun run tools/validators/schema.ts

validate-components:
	@bun run tools/validators/components.ts

validate-forbidden-tokens:
	@bun run tools/validators/forbidden-tokens.ts

validate-cross-refs:
	@bash tools/validators/cross-refs.sh

validate-tests:
	@./tools/run-tests.sh

test: validate-tests

pull:
	@test -n "$(PROJ)" || (echo "PROJ is required. Usage: make pull PROJ=<name>" && exit 1)
	@bun run tools/pull.ts $(PROJ)

pull-dry:
	@test -n "$(PROJ)" || (echo "PROJ is required. Usage: make pull-dry PROJ=<name>" && exit 1)
	@bun run tools/pull.ts $(PROJ) --dry-run

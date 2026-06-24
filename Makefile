VENDOR_DEPS := picomatch

.PHONY: sync sync-dry validate validate-schema validate-components validate-lib-imports validate-tests typecheck test vendor validate-vendor pull pull-dry help

help:
	@echo "사용 가능한 명령어:"
	@echo "  make sync               - 모든 sync.yaml 파일 동기화 실행"
	@echo "  make sync-dry           - 동기화 미리보기 (실제 변경 없음)"
	@echo "  make validate           - 전체 검증 (스키마 + 컴포넌트 + lib import)"
	@echo "  make validate-schema    - 스키마 검증 (필드, 값 유효성)"
	@echo "  make validate-components - 컴포넌트 검증 (파일 존재 여부)"
	@echo "  make validate-lib-imports - lib import 검증 (@lib 별칭 강제)"
	@echo "  make typecheck          - TypeScript strict 타입 검사 (tsc --noEmit)"
	@echo "  make test               - 전체 테스트 실행 (Shell + TypeScript)"
	@echo "  make pull PROJ=<name>   - 프로젝트 배포 파일을 소스로 풀백"
	@echo "  make pull-dry PROJ=<name> - 풀백 미리보기 (실제 변경 없음)"

sync: validate validate-vendor validate-tests
	@bun run tools/sync.ts

sync-dry: validate
	@bun run tools/sync.ts --dry-run

validate: validate-schema validate-components validate-lib-imports typecheck
	@for dep in $(VENDOR_DEPS); do \
		if [ ! -f "lib/vendor/$$dep.ts" ]; then \
			echo "vendor file missing: lib/vendor/$$dep.ts" && exit 1; \
		fi; \
	done

validate-schema:
	@bun run tools/validators/schema.ts

validate-components:
	@bun run tools/validators/components.ts

validate-lib-imports:
	@bun run tools/validators/lib-imports.ts

validate-tests:
	@./tools/run-tests.sh

typecheck:
	@bunx tsc --noEmit

test: validate-tests

vendor:
	@for dep in $(VENDOR_DEPS); do \
		mkdir -p lib/vendor && \
		bun build "$$dep" --target=node --outfile "lib/vendor/$$dep.ts"; \
	done

validate-vendor:
	@for dep in $(VENDOR_DEPS); do \
		if [ -d "node_modules/$$dep" ]; then \
			tmp=$$(mktemp); \
			bun build "$$dep" --target=node --outfile "$$tmp"; \
			if ! diff -q "$$tmp" "lib/vendor/$$dep.ts" > /dev/null 2>&1; then \
				echo "vendor drift detected: $$dep" && rm -f "$$tmp" && exit 1; \
			fi; \
			rm -f "$$tmp"; \
		else \
			echo "vendor check skipped (node_modules/$$dep absent): $$dep"; \
		fi; \
	done

pull:
	@test -n "$(PROJ)" || (echo "PROJ is required. Usage: make pull PROJ=<name>" && exit 1)
	@bun run tools/pull.ts $(PROJ)

pull-dry:
	@test -n "$(PROJ)" || (echo "PROJ is required. Usage: make pull-dry PROJ=<name>" && exit 1)
	@bun run tools/pull.ts $(PROJ) --dry-run

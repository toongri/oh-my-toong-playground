BUN_MIN := 1.2.21

.PHONY: sync sync-dry install-frozen validate validate-schema validate-components validate-lib-imports validate-ac-rules-ssot validate-tests typecheck lint test help

help:
	@echo "사용 가능한 명령어:"
	@echo "  make sync               - 모든 sync.yaml 파일 동기화 실행"
	@echo "  make sync-dry           - 동기화 미리보기 (실제 변경 없음)"
	@echo "  make validate           - 전체 검증 (스키마 + 컴포넌트 + lib import + lint)"
	@echo "  make validate-schema    - 스키마 검증 (필드, 값 유효성)"
	@echo "  make validate-components - 컴포넌트 검증 (파일 존재 여부)"
	@echo "  make validate-lib-imports - lib import 검증 (@lib 별칭 강제)"
	@echo "  make validate-ac-rules-ssot - AC 규칙 SSOT byte-identity 검증"
	@echo "  make typecheck          - TypeScript strict 타입 검사 (tsc --noEmit)"
	@echo "  make lint               - ESLint 정적 검사 (eslint .)"
	@echo "  make test               - 전체 테스트 실행 (Shell + TypeScript)"

sync: validate validate-tests
	@bun run tools/sync.ts

install-frozen:
	@bun install --frozen-lockfile

sync-dry: validate
	@bun run tools/sync.ts --dry-run

validate: install-frozen validate-schema validate-components validate-lib-imports validate-ac-rules-ssot typecheck lint
	@bun -e 'process.exit(Bun.semver.satisfies(Bun.version, ">=$(BUN_MIN)") ? 0 : 1)' \
	  || { printf '\033[0;31m[ERROR]\033[0m bun >= $(BUN_MIN) 필요 (현재: %s)\n' "$$(bun --version)" >&2; exit 1; }

validate-schema:
	@bun run tools/validators/schema.ts

validate-components:
	@bun run tools/validators/components.ts

validate-lib-imports:
	@bun run tools/validators/lib-imports.ts

validate-ac-rules-ssot:
	@bun run tools/validators/ac-rules-ssot.ts

validate-tests:
	@./tools/run-tests.sh

typecheck:
	@bunx tsc --noEmit

lint:
	@bun run lint

test: validate-tests

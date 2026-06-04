/**
 * Lib-import convention validator.
 *
 * Deployable component sources must import shared lib (lib/**) through the
 * `@lib/` alias, never a relative path. `make sync`'s dependency collector only
 * follows `@lib/` aliases for non-lib files, so a relative import reaching into
 * lib/ is silently dropped from the deployed bundle — the deployed component
 * then dies at runtime with "Cannot find module". Relative imports resolve in
 * the repo, so this slips past typecheck and tests; only this source-level
 * check catches it before deployment.
 *
 * CLI usage: bun run tools/validators/lib-imports.ts
 */

import { existsSync } from "fs";
import { join } from "path";
import { getRootDir } from "../lib/config.ts";
import { collectFiles } from "../lib/sync-directory.ts";
import { findRelativeLibImports } from "../adapters/ts-lib-deps.ts";

// Source directories that may hold deployable .ts components.
const COMPONENT_DIRS = ["hooks", "skills", "scripts", "agents", "commands", "rules"];

export async function findLibImportViolations(rootDir: string): Promise<string[]> {
  const libSourceDir = join(rootDir, "lib");
  const violations: string[] = [];

  for (const dir of COMPONENT_DIRS) {
    const base = join(rootDir, dir);
    if (!existsSync(base)) continue;

    for (const rel of await collectFiles(base)) {
      if (!rel.endsWith(".ts") || rel.endsWith(".test.ts")) continue;
      const filePath = join(base, rel);
      for (const specifier of await findRelativeLibImports(filePath, libSourceDir)) {
        violations.push(`${dir}/${rel}: '${specifier}'`);
      }
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const rootDir = getRootDir();
  if (!rootDir) {
    process.stderr.write("[LIB-IMPORT] config.yaml를 찾을 수 없습니다\n");
    process.exit(1);
  }

  const violations = await findLibImportViolations(rootDir);

  if (violations.length > 0) {
    for (const v of violations) {
      process.stderr.write(`\x1b[0;31m[ERROR]\x1b[0m ${v}\n`);
    }
    process.stderr.write(
      `\x1b[0;31m[ERROR]\x1b[0m lib import 검증 실패: ${violations.length} 개 위반 — ` +
        `공유 lib은 @lib/ 별칭으로 import (상대경로는 make sync 배포에서 누락됨)\n`,
    );
    process.exit(1);
  }

  process.stderr.write(`\x1b[0;32m[LIB-IMPORT]\x1b[0m lib import 검증 통과\n`);
  process.exit(0);
}

if (import.meta.main) {
  main();
}

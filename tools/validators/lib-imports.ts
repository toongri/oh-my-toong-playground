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

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { getRootDir } from "../lib/config.ts";
import { collectFiles } from "../lib/sync-directory.ts";
import { findRelativeLibImports, findBareNpmImports, readPackageJsonDeps } from "../adapters/ts-lib-deps.ts";

// Source directories that may hold deployable .ts components.
const COMPONENT_DIRS = ["hooks", "skills", "scripts", "agents", "commands", "rules"];

/** Returns `{ label, base }` entries for each `projects/<name>/<dir>` that exists. */
function projectLocalDirs(rootDir: string): Array<{ label: string; base: string }> {
  const projectsRoot = join(rootDir, "projects");
  if (!existsSync(projectsRoot)) return [];
  const entries: Array<{ label: string; base: string }> = [];
  for (const name of readdirSync(projectsRoot)) {
    for (const dir of COMPONENT_DIRS) {
      const base = join(projectsRoot, name, dir);
      if (existsSync(base)) {
        entries.push({ label: `projects/${name}/${dir}`, base });
      }
    }
  }
  return entries;
}

export async function findLibImportViolations(rootDir: string): Promise<string[]> {
  const libSourceDir = join(rootDir, "lib");
  const violations: string[] = [];

  // Pass 1: relative-into-lib detection (existing pass — DO NOT alter).
  const pass1Dirs: Array<{ label: string; base: string }> = [
    ...COMPONENT_DIRS.map((dir) => ({ label: dir, base: join(rootDir, dir) })),
    ...projectLocalDirs(rootDir),
  ];

  for (const { label, base } of pass1Dirs) {
    if (!existsSync(base)) continue;

    for (const rel of await collectFiles(base)) {
      if (!rel.endsWith(".ts") || rel.endsWith(".test.ts") || rel.endsWith(".d.ts")) continue;
      const filePath = join(base, rel);
      for (const specifier of await findRelativeLibImports(filePath, libSourceDir)) {
        violations.push(`${label}/${rel}: '${specifier}'`);
      }
    }
  }

  // Pass 2: bare-npm import detection.
  // Scans lib/ + COMPONENT_DIRS + project-local component dirs (the deployed surface).
  // tools/ is excluded: it runs where bun install exists so npm imports are legal there.
  // .test.ts files are excluded (handled inside findBareNpmImports).
  //
  // Allowed = specifiers EXACTLY matching a declared dep (deps ∪ devDeps from package.json).
  // Sub-paths of declared packages (e.g. 'picomatch/lib/x') are still rejected because
  // the check is strict equality against the declared root name (D-7).
  const declaredDeps = await readPackageJsonDeps(rootDir);

  const bareNpmDirs: Array<{ label: string; base: string }> = [
    { label: "lib", base: libSourceDir },
    ...COMPONENT_DIRS.map((dir) => ({ label: dir, base: join(rootDir, dir) })),
    ...projectLocalDirs(rootDir),
  ];

  for (const { label, base } of bareNpmDirs) {
    if (!existsSync(base)) continue;

    for (const rel of await collectFiles(base)) {
      if (!rel.endsWith(".ts") || rel.endsWith(".test.ts") || rel.endsWith(".d.ts")) continue;
      const filePath = join(base, rel);
      for (const specifier of await findBareNpmImports(filePath)) {
        // Pass if the specifier is EXACTLY a declared package name (no sub-paths).
        if (declaredDeps.has(specifier)) continue;
        violations.push(
          `bare-npm import not allowed (vendor or eliminate): ${label}/${rel}: '${specifier}'`,
        );
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

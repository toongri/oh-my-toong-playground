import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { findBareNpmImports } from "../adapters/ts-lib-deps.ts";
import { findLibImportViolations } from "./lib-imports.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `lib-imports-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTs(dir: string, name: string, content: string): string {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Suite: findBareNpmImports — unit tests for the classifier
// ---------------------------------------------------------------------------

describe("findBareNpmImports", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- Specifiers that MUST be flagged ---

  it("flags a bare third-party package import", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(tmpDir, "bad.ts", `import x from 'definitely-not-a-pkg';\n`);
    const result = await findBareNpmImports(file);
    expect(result).toContain("definitely-not-a-pkg");
  });

  it("flags a scoped bare package import", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(tmpDir, "bad.ts", `import { S3Client } from '@aws-sdk/client-s3';\n`);
    const result = await findBareNpmImports(file);
    expect(result).toContain("@aws-sdk/client-s3");
  });

  it("does NOT flag @lib/ alias (scoped @lib/ must not be confused with bare @scope/pkg)", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(tmpDir, "ok.ts", `import { utils } from '@lib/utils';\n`);
    const result = await findBareNpmImports(file);
    expect(result).not.toContain("@lib/utils");
    expect(result).toHaveLength(0);
  });

  it("flags a sub-path import whose root segment is a bare package", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(tmpDir, "bad.ts", `import x from 'picomatch/lib/picomatch';\n`);
    const result = await findBareNpmImports(file);
    expect(result).toContain("picomatch/lib/picomatch");
  });

  // --- Specifiers that MUST NOT be flagged ---

  it("does NOT flag a Node builtin (unprefixed)", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(tmpDir, "ok.ts", `import { existsSync } from 'fs';\n`);
    const result = await findBareNpmImports(file);
    expect(result).toHaveLength(0);
  });

  it("does NOT flag node: prefixed builtins", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(
      tmpDir,
      "ok.ts",
      `import path from 'node:path';\nimport { readFile } from 'node:fs/promises';\n`,
    );
    const result = await findBareNpmImports(file);
    expect(result).toHaveLength(0);
  });

  it("does NOT flag bun: prefixed specifiers", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(tmpDir, "ok.ts", `import { test } from 'bun:test';\n`);
    const result = await findBareNpmImports(file);
    expect(result).toHaveLength(0);
  });

  it("does NOT flag @lib/ alias imports", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(tmpDir, "ok.ts", `import { foo } from '@lib/utils';\n`);
    const result = await findBareNpmImports(file);
    expect(result).toHaveLength(0);
  });

  it("does NOT flag @lib/vendor/ sub-paths", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(tmpDir, "ok.ts", `import picomatch from '@lib/vendor/picomatch';\n`);
    const result = await findBareNpmImports(file);
    expect(result).toHaveLength(0);
  });

  it("does NOT flag relative imports (./)", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(tmpDir, "ok.ts", `import { bar } from './rel';\n`);
    const result = await findBareNpmImports(file);
    expect(result).toHaveLength(0);
  });

  it("does NOT flag parent-relative imports (../)", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(tmpDir, "ok.ts", `import { bar } from '../rel';\n`);
    const result = await findBareNpmImports(file);
    expect(result).toHaveLength(0);
  });

  it("does NOT flag commented-out bare imports", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(tmpDir, "ok.ts", `// import x from 'lodash';\n`);
    const result = await findBareNpmImports(file);
    expect(result).toHaveLength(0);
  });

  it("does NOT flag .test.ts files", async () => {
    tmpDir = makeTempDir();
    const file = writeTs(tmpDir, "bad.test.ts", `import x from 'definitely-not-a-pkg';\n`);
    const result = await findBareNpmImports(file);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: findLibImportViolations — bare-npm pass integration
// ---------------------------------------------------------------------------

describe("findLibImportViolations — bare-npm second pass", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("flags a bare npm import in lib/ and includes the distinctive marker text", async () => {
    tmpDir = makeTempDir();
    // Minimal OMT-root-like structure: config.yaml so getRootDir works
    writeTs(tmpDir, "config.yaml", "");
    const libDir = join(tmpDir, "lib");
    writeTs(libDir, "bad.ts", `import x from 'definitely-not-a-pkg';\n`);

    const violations = await findLibImportViolations(tmpDir);
    expect(violations.some((v) => v.includes("bare-npm import not allowed"))).toBe(true);
    expect(violations.some((v) => v.includes("bad.ts"))).toBe(true);
    expect(violations.some((v) => v.includes("definitely-not-a-pkg"))).toBe(true);
  });

  it("does NOT flag a lib/ file that only uses builtins and @lib/ imports", async () => {
    tmpDir = makeTempDir();
    writeTs(tmpDir, "config.yaml", "");
    const libDir = join(tmpDir, "lib");
    writeTs(
      libDir,
      "ok.ts",
      `import { join } from 'node:path';\nimport { helper } from '@lib/helper';\n`,
    );

    const violations = await findLibImportViolations(tmpDir);
    const bareViolations = violations.filter((v) => v.includes("bare-npm import not allowed"));
    expect(bareViolations).toHaveLength(0);
  });

  it("does NOT flag .test.ts files inside lib/", async () => {
    tmpDir = makeTempDir();
    writeTs(tmpDir, "config.yaml", "");
    const libDir = join(tmpDir, "lib");
    writeTs(libDir, "bad.test.ts", `import x from 'definitely-not-a-pkg';\n`);

    const violations = await findLibImportViolations(tmpDir);
    const bareViolations = violations.filter((v) => v.includes("bare-npm import not allowed"));
    expect(bareViolations).toHaveLength(0);
  });

  it("flags bare npm imports in COMPONENT_DIRS (e.g. hooks/)", async () => {
    tmpDir = makeTempDir();
    writeTs(tmpDir, "config.yaml", "");
    const hooksDir = join(tmpDir, "hooks");
    writeTs(hooksDir, "myhook.ts", `import x from 'some-npm-pkg';\n`);

    const violations = await findLibImportViolations(tmpDir);
    expect(violations.some((v) => v.includes("bare-npm import not allowed"))).toBe(true);
    expect(violations.some((v) => v.includes("myhook.ts"))).toBe(true);
    expect(violations.some((v) => v.includes("some-npm-pkg"))).toBe(true);
  });

  it("flags a bare npm import in a project-local component dir (projects/<name>/hooks/)", async () => {
    tmpDir = makeTempDir();
    writeTs(tmpDir, "config.yaml", "");
    const projectHooksDir = join(tmpDir, "projects", "my-project", "hooks");
    writeTs(projectHooksDir, "local-hook.ts", `import x from 'lodash';\n`);

    const violations = await findLibImportViolations(tmpDir);
    expect(violations.some((v) => v.includes("bare-npm import not allowed"))).toBe(true);
    expect(violations.some((v) => v.includes("local-hook.ts"))).toBe(true);
    expect(violations.some((v) => v.includes("lodash"))).toBe(true);
  });

  it("does NOT flag project-local .test.ts files", async () => {
    tmpDir = makeTempDir();
    writeTs(tmpDir, "config.yaml", "");
    const projectHooksDir = join(tmpDir, "projects", "my-project", "hooks");
    writeTs(projectHooksDir, "local-hook.test.ts", `import x from 'lodash';\n`);

    const violations = await findLibImportViolations(tmpDir);
    const bareViolations = violations.filter((v) => v.includes("bare-npm import not allowed"));
    expect(bareViolations).toHaveLength(0);
  });

  it("does NOT flag a .d.ts file in lib/ with a type-only typeof import", async () => {
    tmpDir = makeTempDir();
    writeTs(tmpDir, "config.yaml", "");
    const libDir = join(tmpDir, "lib", "vendor");
    writeTs(
      libDir,
      "picomatch.d.ts",
      `declare const picomatch: typeof import('picomatch');\nexport default picomatch;\n`,
    );

    const violations = await findLibImportViolations(tmpDir);
    const bareViolations = violations.filter((v) => v.includes("bare-npm import not allowed"));
    expect(bareViolations).toHaveLength(0);
  });

  it("does NOT flag a .d.ts file in a component dir (hooks/) with a bare import", async () => {
    tmpDir = makeTempDir();
    writeTs(tmpDir, "config.yaml", "");
    const hooksDir = join(tmpDir, "hooks");
    writeTs(
      hooksDir,
      "types.d.ts",
      `declare const x: typeof import('some-pkg');\nexport default x;\n`,
    );

    const violations = await findLibImportViolations(tmpDir);
    const bareViolations = violations.filter((v) => v.includes("bare-npm import not allowed"));
    expect(bareViolations).toHaveLength(0);
  });
});

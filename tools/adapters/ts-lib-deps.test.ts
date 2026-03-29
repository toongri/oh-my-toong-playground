import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";

import {
  resolveTsLibDependencies,
  collectRequiredLibModules,
} from "./ts-lib-deps.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let libDir: string;
let platformDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-lib-deps-test-"));
  libDir = path.join(tmpDir, "lib");
  platformDir = path.join(tmpDir, "platform");
  await fs.mkdir(libDir, { recursive: true });
  await fs.mkdir(platformDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveTsLibDependencies
// ---------------------------------------------------------------------------

describe("resolveTsLibDependencies", () => {
  it('기본 `from "@lib/foo"` 매칭 — 의존성 1개 반환', async () => {
    const fooLib = path.join(libDir, "foo.ts");
    await writeFile(fooLib, "// foo lib");

    const entryFile = path.join(platformDir, "entry.ts");
    await writeFile(entryFile, 'import { something } from "@lib/foo";\n');

    const deps = await resolveTsLibDependencies(entryFile, libDir);
    expect(deps).toEqual([fooLib]);
  });

  it('`from \'@lib/foo.ts\'` (.ts 확장자 포함) 매칭', async () => {
    const fooLib = path.join(libDir, "foo.ts");
    await writeFile(fooLib, "// foo lib");

    const entryFile = path.join(platformDir, "entry.ts");
    await writeFile(entryFile, "import { something } from '@lib/foo.ts';\n");

    const deps = await resolveTsLibDependencies(entryFile, libDir);
    expect(deps).toEqual([fooLib]);
  });

  it('주석 처리된 import 무시 (`// import ... from "@lib/foo"`)', async () => {
    const fooLib = path.join(libDir, "foo.ts");
    await writeFile(fooLib, "// foo lib");

    const entryFile = path.join(platformDir, "entry.ts");
    await writeFile(entryFile, '// import { something } from "@lib/foo";\n');

    const deps = await resolveTsLibDependencies(entryFile, libDir);
    expect(deps).toEqual([]);
  });

  it("`*.test.ts` 파일은 스캔 대상에서 제외 (resolveTsLibDependencies에 직접 전달 시도 시 빈 배열)", async () => {
    const fooLib = path.join(libDir, "foo.ts");
    await writeFile(fooLib, "// foo lib");

    // 테스트 파일은 인식되지 않아야 함 — 직접 호출 시에도 결과는 정상이나
    // collectRequiredLibModules 스캔 시 제외됨을 별도로 검증
    const testFile = path.join(platformDir, "entry.test.ts");
    await writeFile(testFile, 'import { something } from "@lib/foo";\n');

    // test.ts 파일에 대해 직접 호출해도 구현에서 결과를 반환하지 않아야 함
    const deps = await resolveTsLibDependencies(testFile, libDir);
    expect(deps).toEqual([]);
  });

  it("transitive 의존성 추적 — A imports @lib/B, B imports @lib/C → A의 deps에 B와 C 모두 포함", async () => {
    const cLib = path.join(libDir, "c.ts");
    const bLib = path.join(libDir, "b.ts");
    await writeFile(cLib, "// c lib");
    await writeFile(bLib, 'import { c } from "@lib/c";\n');

    const entryFile = path.join(platformDir, "a.ts");
    await writeFile(entryFile, 'import { b } from "@lib/b";\n');

    const deps = await resolveTsLibDependencies(entryFile, libDir);
    expect(deps).toContain(bLib);
    expect(deps).toContain(cLib);
    expect(deps.length).toBe(2);
  });

  it("cycle detection — A→B→A 순환 시 무한루프 방지", async () => {
    const aLib = path.join(libDir, "a.ts");
    const bLib = path.join(libDir, "b.ts");
    await writeFile(aLib, 'import { b } from "@lib/b";\n');
    await writeFile(bLib, 'import { a } from "@lib/a";\n');

    const entryFile = path.join(platformDir, "entry.ts");
    await writeFile(entryFile, 'import { a } from "@lib/a";\n');

    // Should not throw or hang
    const deps = await resolveTsLibDependencies(entryFile, libDir);
    expect(deps).toContain(aLib);
    expect(deps).toContain(bLib);
    // No infinite loop: total is exactly 2
    expect(deps.length).toBe(2);
  });

  it("존재하지 않는 lib 모듈은 경고 로그 후 스킵", async () => {
    const existingLib = path.join(libDir, "exists.ts");
    await writeFile(existingLib, "// exists");

    const entryFile = path.join(platformDir, "entry.ts");
    await writeFile(
      entryFile,
      'import { missing } from "@lib/missing";\nimport { exists } from "@lib/exists";\n',
    );

    const deps = await resolveTsLibDependencies(entryFile, libDir);
    expect(deps).toEqual([existingLib]);
  });

  it("import가 없는 .ts 파일은 빈 배열 반환", async () => {
    const entryFile = path.join(platformDir, "no-imports.ts");
    await writeFile(entryFile, "export const foo = 42;\n");

    const deps = await resolveTsLibDependencies(entryFile, libDir);
    expect(deps).toEqual([]);
  });

  it("`import \"@lib/foo\"` (side-effect import) 매칭", async () => {
    const fooLib = path.join(libDir, "foo.ts");
    await writeFile(fooLib, "// foo lib");

    const entryFile = path.join(platformDir, "entry.ts");
    await writeFile(entryFile, 'import "@lib/foo";\n');

    const deps = await resolveTsLibDependencies(entryFile, libDir);
    expect(deps).toEqual([fooLib]);
  });
});

// ---------------------------------------------------------------------------
// collectRequiredLibModules
// ---------------------------------------------------------------------------

describe("collectRequiredLibModules", () => {
  it("platformDir 하위 .ts 파일에서 lib 의존성 수집 — 중복 제거 후 반환", async () => {
    const fooLib = path.join(libDir, "foo.ts");
    const barLib = path.join(libDir, "bar.ts");
    await writeFile(fooLib, "// foo");
    await writeFile(barLib, "// bar");

    // Two files, both import foo; one also imports bar
    const fileA = path.join(platformDir, "a.ts");
    const fileB = path.join(platformDir, "b.ts");
    await writeFile(fileA, 'import { foo } from "@lib/foo";\nimport { bar } from "@lib/bar";\n');
    await writeFile(fileB, 'import { foo } from "@lib/foo";\n');

    const result = await collectRequiredLibModules(platformDir, libDir);
    expect(result.has(fooLib)).toBe(true);
    expect(result.has(barLib)).toBe(true);
    expect(result.size).toBe(2);
  });

  it("platformDir 내 lib/ 디렉토리 자체는 스캔 제외", async () => {
    const fooLib = path.join(libDir, "foo.ts");
    await writeFile(fooLib, "// foo");

    // lib/ 하위에 .ts 파일이 있어도 스캔하지 않아야 함
    const libSubFile = path.join(platformDir, "lib", "helper.ts");
    await writeFile(libSubFile, 'import { foo } from "@lib/foo";\n');

    // platformDir에 lib/가 없으므로 libDir은 platformDir 외부 tmpDir/lib
    // 하지만 platformDir/lib가 스캔 제외인지 검증하기 위해 platformDir 내 lib 디렉토리 생성
    const result = await collectRequiredLibModules(platformDir, libDir);
    // lib/helper.ts가 스캔됐다면 fooLib이 결과에 있을 것임
    // 스캔 제외가 맞다면 빈 Set이어야 함
    expect(result.size).toBe(0);
  });

  it("*.test.ts 파일은 스캔 제외", async () => {
    const fooLib = path.join(libDir, "foo.ts");
    await writeFile(fooLib, "// foo");

    const testFile = path.join(platformDir, "worker.test.ts");
    await writeFile(testFile, 'import { foo } from "@lib/foo";\n');

    const result = await collectRequiredLibModules(platformDir, libDir);
    expect(result.size).toBe(0);
  });

  it("빈 platformDir — 빈 Set 반환", async () => {
    const result = await collectRequiredLibModules(platformDir, libDir);
    expect(result.size).toBe(0);
  });
});

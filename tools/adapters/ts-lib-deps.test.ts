import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";

import {
  resolveTsLibDependencies,
  collectRequiredLibModules,
  collectLibDataFiles,
  findRelativeLibImports,
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

  it('`import("@lib/foo")` (동적 import) 매칭', async () => {
    const fooLib = path.join(libDir, "foo.ts");
    await writeFile(fooLib, "// foo lib");

    const entryFile = path.join(platformDir, "entry.ts");
    await writeFile(entryFile, 'const mod = import("@lib/foo");\n');

    const deps = await resolveTsLibDependencies(entryFile, libDir);
    expect(deps).toEqual([fooLib]);
  });

  it('`await import("@lib/foo")` (async 동적 import) 매칭', async () => {
    const fooLib = path.join(libDir, "foo.ts");
    await writeFile(fooLib, "// foo lib");

    const entryFile = path.join(platformDir, "entry.ts");
    await writeFile(entryFile, 'const mod = await import("@lib/foo");\n');

    const deps = await resolveTsLibDependencies(entryFile, libDir);
    expect(deps).toEqual([fooLib]);
  });

  it("`import('@lib/foo')` (싱글 쿼트 동적 import) 매칭", async () => {
    const fooLib = path.join(libDir, "foo.ts");
    await writeFile(fooLib, "// foo lib");

    const entryFile = path.join(platformDir, "entry.ts");
    await writeFile(entryFile, "const mod = import('@lib/foo');\n");

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

// ---------------------------------------------------------------------------
// Relative import tracking (regression for side-effect + relative imports)
// ---------------------------------------------------------------------------

describe("relative import tracking inside lib modules", () => {
  it("lib 모듈이 상대경로 side-effect import로 참조하는 모듈도 수집한다 (worker-utils → agent-drivers 패턴)", async () => {
    // Fixture: entry.ts imports @lib/worker-utils via @lib alias
    //          worker-utils imports ./agent-drivers/opencode as side-effect
    //          opencode is never referenced via @lib/ anywhere else
    const agentDriversDir = path.join(libDir, "agent-drivers");
    await fs.mkdir(agentDriversDir, { recursive: true });

    const opencodeLib = path.join(agentDriversDir, "opencode.ts");
    await writeFile(opencodeLib, "// opencode driver registration\nexport const name = 'opencode';\n");

    const workerUtilsLib = path.join(libDir, "worker-utils.ts");
    await writeFile(
      workerUtilsLib,
      "// worker utils\nimport './agent-drivers/opencode';\nexport const foo = 1;\n",
    );

    const entryFile = path.join(platformDir, "entry.ts");
    await writeFile(entryFile, 'import { foo } from "@lib/worker-utils";\n');

    const result = await collectRequiredLibModules(platformDir, libDir);

    expect(result.has(workerUtilsLib)).toBe(true);
    expect(result.has(opencodeLib)).toBe(true);
    expect(result.size).toBe(2);
  });

  it("lib 모듈의 상대 import가 libSourceDir 밖을 가리키면 수집하지 않는다", async () => {
    // Fixture: worker-utils imports '../outside/helper' which resolves outside libDir
    const workerUtilsLib = path.join(libDir, "worker-utils.ts");
    await writeFile(
      workerUtilsLib,
      "// worker utils\nimport '../outside/helper';\nexport const foo = 1;\n",
    );

    // Create the outside file so it would be picked up if the guard were missing
    const outsideHelper = path.join(tmpDir, "outside", "helper.ts");
    await writeFile(outsideHelper, "// outside helper\n");

    const entryFile = path.join(platformDir, "entry.ts");
    await writeFile(entryFile, 'import { foo } from "@lib/worker-utils";\n');

    const result = await collectRequiredLibModules(platformDir, libDir);

    expect(result.has(workerUtilsLib)).toBe(true);
    // outsideHelper must NOT be collected
    expect(result.has(outsideHelper)).toBe(false);
    expect(result.size).toBe(1);
  });

  it("lib 모듈의 transitive 상대 import도 재귀 추적한다", async () => {
    // Fixture: entry → @lib/a → ./b (relative) → ./c (relative)
    //          none of b or c are referenced via @lib/
    const cLib = path.join(libDir, "c.ts");
    await writeFile(cLib, "// c\n");

    const bLib = path.join(libDir, "b.ts");
    await writeFile(bLib, "import './c';\n");

    const aLib = path.join(libDir, "a.ts");
    await writeFile(aLib, "import './b';\n");

    const entryFile = path.join(platformDir, "entry.ts");
    await writeFile(entryFile, 'import { a } from "@lib/a";\n');

    const result = await collectRequiredLibModules(platformDir, libDir);

    expect(result.has(aLib)).toBe(true);
    expect(result.has(bLib)).toBe(true);
    expect(result.has(cLib)).toBe(true);
    expect(result.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// collectLibDataFiles (static data-file reference trace)
// ---------------------------------------------------------------------------

describe("collectLibDataFiles", () => {
  it('`join(import.meta.dir, "data.yaml")` 패턴 → data.yaml로 끝나는 데이터 파일 추적', async () => {
    const dataFile = path.join(libDir, "data.yaml");
    await writeFile(dataFile, "key: value\n");

    const loaderFile = path.join(libDir, "loader.ts");
    await writeFile(
      loaderFile,
      'import { join } from "path";\nconst P = join(import.meta.dir, "data.yaml");\n',
    );

    const result = await collectLibDataFiles(libDir);
    const traced = [...result];
    expect(traced.length).toBe(1);
    expect(traced[0].endsWith("data.yaml")).toBe(true);
    expect(result.has(dataFile)).toBe(true);
  });

  it("`import.meta.dir`/`import.meta.dirname` 패턴이 없는 .ts → 빈 Set", async () => {
    const plainFile = path.join(libDir, "plain.ts");
    await writeFile(plainFile, "export const foo = 42;\n");

    const result = await collectLibDataFiles(libDir);
    expect(result.size).toBe(0);
  });

  it("`path.join(import.meta.dirname, 'x.yaml')` (dirname + 싱글쿼트) 변형 매칭", async () => {
    const dataFile = path.join(libDir, "x.yaml");
    await writeFile(dataFile, "k: v\n");

    const loaderFile = path.join(libDir, "loader.ts");
    await writeFile(
      loaderFile,
      "import path from 'path';\nconst P = path.join(import.meta.dirname, 'x.yaml');\n",
    );

    const result = await collectLibDataFiles(libDir);
    expect(result.has(dataFile)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findRelativeLibImports (deployment-hazard detector)
// ---------------------------------------------------------------------------

describe("findRelativeLibImports", () => {
  it("컴포넌트가 상대경로로 lib을 import하면 위반 specifier 반환", async () => {
    const compFile = path.join(platformDir, "comp.ts");
    await writeFile(compFile, "import { x } from '../lib/foo.ts';\n");

    const offenders = await findRelativeLibImports(compFile, libDir);
    expect(offenders).toEqual(["../lib/foo.ts"]);
  });

  it("@lib/ 별칭 import는 위반 아님", async () => {
    const compFile = path.join(platformDir, "comp.ts");
    await writeFile(compFile, 'import { x } from "@lib/foo";\n');

    expect(await findRelativeLibImports(compFile, libDir)).toEqual([]);
  });

  it("컴포넌트 로컬 상대 import(./types)는 lib 밖이라 위반 아님", async () => {
    const compFile = path.join(platformDir, "comp.ts");
    await writeFile(compFile, "import { x } from './types.ts';\n");

    expect(await findRelativeLibImports(compFile, libDir)).toEqual([]);
  });

  it("lib 내부 파일의 상대 import는 정상 스타일이므로 위반 아님", async () => {
    const libFile = path.join(libDir, "a.ts");
    await writeFile(libFile, "import { b } from './b.ts';\n");

    expect(await findRelativeLibImports(libFile, libDir)).toEqual([]);
  });

  it("*.test.ts 파일은 배포 대상이 아니므로 검사 제외", async () => {
    const testFile = path.join(platformDir, "comp.test.ts");
    await writeFile(testFile, "import { x } from '../lib/foo.ts';\n");

    expect(await findRelativeLibImports(testFile, libDir)).toEqual([]);
  });

  it("'lib' 부분문자열 형제 디렉토리(../calibration)는 오탐하지 않음", async () => {
    const compFile = path.join(platformDir, "comp.ts");
    await writeFile(compFile, "import { x } from '../calibration/helper.ts';\n");

    expect(await findRelativeLibImports(compFile, libDir)).toEqual([]);
  });
});

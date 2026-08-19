import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";

import {
	resolveShellDependencies,
	syncShellDependencies,
	syncShellDepsForDir,
} from "./hook-deps.ts";
import type { DeployMutationHooks } from "../lib/deploy-transaction.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function writeFile(filePath: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, "utf8");
}

async function exists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let hooksDir: string;
let targetDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hook-deps-test-"));
	hooksDir = path.join(tmpDir, "hooks");
	targetDir = path.join(tmpDir, "target");
	await fs.mkdir(hooksDir, { recursive: true });
	await fs.mkdir(targetDir, { recursive: true });
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveShellDependencies
// ---------------------------------------------------------------------------

describe("resolveShellDependencies", () => {
	it('기본 `source "$VAR/lib/foo.sh"` 매칭 — 의존성 1개 반환', async () => {
		const libFile = path.join(hooksDir, "lib", "foo.sh");
		await writeFile(libFile, "# lib");

		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, 'source "$HOOKS_DIR/lib/foo.sh"\n');

		const deps = await resolveShellDependencies(entryFile, hooksDir);
		expect(deps).toEqual([libFile]);
	});

	it('`. "$VAR/lib/foo.sh"` (dot notation) 매칭', async () => {
		const libFile = path.join(hooksDir, "lib", "bar.sh");
		await writeFile(libFile, "# bar");

		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, '. "$HOOKS_DIR/lib/bar.sh"\n');

		const deps = await resolveShellDependencies(entryFile, hooksDir);
		expect(deps).toEqual([libFile]);
	});

	it("`${VAR}` 형태 변수 매칭", async () => {
		const libFile = path.join(hooksDir, "lib", "baz.sh");
		await writeFile(libFile, "# baz");

		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, 'source "${HOOKS_DIR}/lib/baz.sh"\n');

		const deps = await resolveShellDependencies(entryFile, hooksDir);
		expect(deps).toEqual([libFile]);
	});

	it("주석 줄(`# source ...`) 스킵 확인", async () => {
		const libFile = path.join(hooksDir, "lib", "foo.sh");
		await writeFile(libFile, "# lib");

		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, '# source "$HOOKS_DIR/lib/foo.sh"\n');

		const deps = await resolveShellDependencies(entryFile, hooksDir);
		expect(deps).toEqual([]);
	});

	it("`_test.sh` 파일 제외 확인", async () => {
		const testFile = path.join(hooksDir, "lib", "foo_test.sh");
		await writeFile(testFile, "# test");

		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, 'source "$HOOKS_DIR/lib/foo_test.sh"\n');

		const deps = await resolveShellDependencies(entryFile, hooksDir);
		expect(deps).toEqual([]);
	});

	it("cycle detection — A sources B, B sources A → 무한루프 없이 반환", async () => {
		const fileA = path.join(hooksDir, "a.sh");
		const fileB = path.join(hooksDir, "b.sh");
		await writeFile(fileA, 'source "$HOOKS_DIR/b.sh"\n');
		await writeFile(fileB, 'source "$HOOKS_DIR/a.sh"\n');

		// Should not throw or hang
		const deps = await resolveShellDependencies(fileA, hooksDir);
		expect(deps).toContain(fileB);
		// fileA itself should NOT appear again (cycle stopped)
		expect(deps.filter((d) => d === fileA).length).toBe(0);
	});

	it("transitive deps — A sources B, B sources C → A, B, C 모두 반환", async () => {
		const fileC = path.join(hooksDir, "lib", "c.sh");
		const fileB = path.join(hooksDir, "lib", "b.sh");
		const fileA = path.join(hooksDir, "a.sh");

		await writeFile(fileC, "# c\n");
		await writeFile(fileB, 'source "$HOOKS_DIR/lib/c.sh"\n');
		await writeFile(fileA, 'source "$HOOKS_DIR/lib/b.sh"\n');

		const deps = await resolveShellDependencies(fileA, hooksDir);
		expect(deps).toContain(fileB);
		expect(deps).toContain(fileC);
		expect(deps.length).toBe(2);
	});

	it("존재하지 않는 파일 참조 시 graceful skip (나머지 의존성 반환)", async () => {
		const existingFile = path.join(hooksDir, "lib", "exists.sh");
		await writeFile(existingFile, "# exists");

		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(
			entryFile,
			'source "$HOOKS_DIR/lib/missing.sh"\nsource "$HOOKS_DIR/lib/exists.sh"\n',
		);

		const deps = await resolveShellDependencies(entryFile, hooksDir);
		expect(deps).toEqual([existingFile]);
	});

	it("빈 파일 → 빈 배열 반환", async () => {
		const entryFile = path.join(hooksDir, "empty.sh");
		await writeFile(entryFile, "");

		const deps = await resolveShellDependencies(entryFile, hooksDir);
		expect(deps).toEqual([]);
	});

	it("source 문 없는 파일 → 빈 배열 반환", async () => {
		const entryFile = path.join(hooksDir, "no-source.sh");
		await writeFile(entryFile, "#!/bin/bash\necho hello\n");

		const deps = await resolveShellDependencies(entryFile, hooksDir);
		expect(deps).toEqual([]);
	});

	it("single quotes 매칭", async () => {
		const libFile = path.join(hooksDir, "lib", "sq.sh");
		await writeFile(libFile, "# sq");

		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, "source '$HOOKS_DIR/lib/sq.sh'\n");

		const deps = await resolveShellDependencies(entryFile, hooksDir);
		expect(deps).toEqual([libFile]);
	});

	it("no quotes 매칭", async () => {
		const libFile = path.join(hooksDir, "lib", "nq.sh");
		await writeFile(libFile, "# nq");

		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, "source $HOOKS_DIR/lib/nq.sh\n");

		const deps = await resolveShellDependencies(entryFile, hooksDir);
		expect(deps).toEqual([libFile]);
	});

	it("`# omt-hook-dep: <relpath>` 디렉티브 매칭 — 문자열 내부 참조라 source 정규식이 못 잡는 companion 파일도 의존성으로 반환", async () => {
		const ledgerFile = path.join(hooksDir, "omt-ledger.sh");
		await writeFile(ledgerFile, "#!/bin/bash\necho ledger\n");

		const entryFile = path.join(hooksDir, "session-start.sh");
		await writeFile(
			entryFile,
			'#!/bin/bash\n# omt-hook-dep: omt-ledger.sh\necho ".claude/hooks/omt-ledger.sh append Foo"\n',
		);

		const deps = await resolveShellDependencies(entryFile, hooksDir);
		expect(deps).toEqual([ledgerFile]);
	});

	it("omt-hook-dep 디렉티브가 가리키는 파일이 없으면 skip (throw 없음)", async () => {
		const entryFile = path.join(hooksDir, "session-start.sh");
		await writeFile(entryFile, "#!/bin/bash\n# omt-hook-dep: missing-ledger.sh\n");

		const deps = await resolveShellDependencies(entryFile, hooksDir);
		expect(deps).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// syncShellDependencies
// ---------------------------------------------------------------------------

describe("syncShellDependencies", () => {
	it("mutation hook이 exact target에서 operation을 감싸고 성공 뒤 legacy callback을 호출함", async () => {
		const libFile = path.join(hooksDir, "lib", "hooked.sh");
		await writeFile(libFile, "hooked");
		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, 'source "$HOOKS_DIR/lib/hooked.sh"\n');
		const target = path.join(targetDir, "lib", "hooked.sh");
		const operations: string[] = [];
		let callbackCount = 0;
		const mutationHooks: DeployMutationHooks = {
			async mutate(targetPath, operation) {
				operations.push(targetPath);
				await operation();
			},
		};
		await syncShellDependencies(entryFile, hooksDir, targetDir, false, async (writtenPath) => {
			callbackCount += 1;
			expect(writtenPath).toBe(target);
			expect(await fs.readFile(writtenPath, "utf8")).toBe("hooked");
		}, mutationHooks);
		expect(operations).toEqual([target]);
		expect(callbackCount).toBe(1);
	});

	it("mutation hook pre-operation conflict 시 operation·callback 없이 resident와 temp를 보존함", async () => {
		const libFile = path.join(hooksDir, "lib", "conflict.sh");
		await writeFile(libFile, "new");
		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, 'source "$HOOKS_DIR/lib/conflict.sh"\n');
		const target = path.join(targetDir, "lib", "conflict.sh");
		await writeFile(target, "resident");
		let operationCount = 0;
		let callbackCount = 0;
		const mutationHooks: DeployMutationHooks = {
			async mutate(_targetPath, operation) {
				if ((await fs.readFile(target, "utf8")) === "resident") {
					throw new Error("conflict");
				}
				operationCount += 1;
				await operation();
			},
		};
		await expect(
			syncShellDependencies(entryFile, hooksDir, targetDir, false, () => {
				callbackCount += 1;
			}, mutationHooks),
		).rejects.toThrow("conflict");
		expect(operationCount).toBe(0);
		expect(callbackCount).toBe(0);
		expect(await fs.readFile(target, "utf8")).toBe("resident");
		expect((await fs.readdir(path.dirname(target))).filter((name) => name.includes(".tmp-")).length).toBe(0);
	});

	it("mutation wrapper 내부 rename 실패를 전파하고 callback을 호출하지 않음", async () => {
		const libFile = path.join(hooksDir, "lib", "rename-failure.sh");
		await writeFile(libFile, "new");
		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, 'source "$HOOKS_DIR/lib/rename-failure.sh"\n');
		const target = path.join(targetDir, "lib", "rename-failure.sh");
		await fs.mkdir(target, { recursive: true });
		await writeFile(path.join(target, "resident.txt"), "resident");
		let callbackCount = 0;
		const mutationHooks: DeployMutationHooks = {
			async mutate(_targetPath, operation) {
				await operation();
			},
		};
		await expect(
			syncShellDependencies(entryFile, hooksDir, targetDir, false, () => {
				callbackCount += 1;
			}, mutationHooks),
		).rejects.toThrow();
		expect(callbackCount).toBe(0);
		expect(await fs.readFile(path.join(target, "resident.txt"), "utf8")).toBe("resident");
		expect((await fs.readdir(path.dirname(target))).filter((name) => name.includes(".tmp-")).length).toBe(0);
	});
	it("각 dependency를 원자 교체하고 rename 직후 callback에서 최종 바이트를 확인함", async () => {
		const first = path.join(hooksDir, "lib", "first.sh");
		const second = path.join(hooksDir, "lib", "second.sh");
		await writeFile(first, "first-new");
		await writeFile(second, "second-new");
		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(
			entryFile,
			'source "$HOOKS_DIR/lib/first.sh"\nsource "$HOOKS_DIR/lib/second.sh"\n',
		);
		const observed: string[] = [];
		await syncShellDependencies(entryFile, hooksDir, targetDir, false, async (targetPath) => {
			observed.push(path.basename(targetPath));
			expect(await fs.readFile(targetPath, "utf8")).toBe(`${path.basename(targetPath, ".sh")}-new`);
		});
		expect(observed).toEqual(["first.sh", "second.sh"]);
	});

	it("rename 실패 시 이전 resident와 temp residue를 보존하고 실패 dependency callback은 호출하지 않음", async () => {
		const first = path.join(hooksDir, "lib", "first.sh");
		const second = path.join(hooksDir, "lib", "second.sh");
		await writeFile(first, "first-new");
		await writeFile(second, "second-new");
		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(
			entryFile,
			'source "$HOOKS_DIR/lib/first.sh"\nsource "$HOOKS_DIR/lib/second.sh"\n',
		);
		const secondTarget = path.join(targetDir, "lib", "second.sh");
		await fs.mkdir(secondTarget, { recursive: true });
		await writeFile(path.join(secondTarget, "resident.txt"), "resident");
		const observed: string[] = [];
		await expect(
			syncShellDependencies(entryFile, hooksDir, targetDir, false, (targetPath) => {
				observed.push(path.basename(targetPath));
			}),
		).rejects.toThrow();
		expect(observed).toEqual(["first.sh"]);
		expect(await fs.readFile(path.join(targetDir, "lib", "first.sh"), "utf8")).toBe("first-new");
		expect(await fs.readFile(path.join(secondTarget, "resident.txt"), "utf8")).toBe("resident");
		expect((await fs.readdir(path.join(targetDir, "lib"))).filter((name) => name.includes(".tmp-")).length).toBe(0);
	});

	it("callback 오류는 mutation 이후 전파되고 temp residue가 없음", async () => {
		const libFile = path.join(hooksDir, "lib", "callback.sh");
		await writeFile(libFile, "final");
		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, 'source "$HOOKS_DIR/lib/callback.sh"\n');
		const target = path.join(targetDir, "lib", "callback.sh");
		await expect(
			syncShellDependencies(entryFile, hooksDir, targetDir, false, async (targetPath) => {
				expect(targetPath).toBe(target);
				expect(await fs.readFile(targetPath, "utf8")).toBe("final");
				throw new Error("checkpoint failed");
			}),
		).rejects.toThrow("checkpoint failed");
		expect(await exists(target)).toBe(true);
		expect((await fs.readdir(path.dirname(target))).filter((name) => name.includes(".tmp-")).length).toBe(0);
	});

	it("의존성 파일이 targetHooksDir 하위에 올바른 상대경로로 복사됨", async () => {
		const libFile = path.join(hooksDir, "lib", "foo.sh");
		await writeFile(libFile, "# foo");

		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, 'source "$HOOKS_DIR/lib/foo.sh"\n');

		await syncShellDependencies(entryFile, hooksDir, targetDir, false);

		const expected = path.join(targetDir, "lib", "foo.sh");
		expect(await exists(expected)).toBe(true);
		const content = await fs.readFile(expected, "utf8");
		expect(content).toBe("# foo");
	});

	it("dryRun=true 시 파일 복사 안 됨", async () => {
		const libFile = path.join(hooksDir, "lib", "dry.sh");
		await writeFile(libFile, "# dry");

		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, 'source "$HOOKS_DIR/lib/dry.sh"\n');

		await syncShellDependencies(entryFile, hooksDir, targetDir, true);

		const expected = path.join(targetDir, "lib", "dry.sh");
		expect(await exists(expected)).toBe(false);
	});

	it("dryRun=true 시 callback 호출 안 됨", async () => {
		const libFile = path.join(hooksDir, "lib", "dry-callback.sh");
		await writeFile(libFile, "# dry");
		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, 'source "$HOOKS_DIR/lib/dry-callback.sh"\n');
		let callbackCount = 0;
		await syncShellDependencies(entryFile, hooksDir, targetDir, true, () => {
			callbackCount += 1;
		});
		expect(callbackCount).toBe(0);
	});

	it("dryRun=true 시 mutation hook도 호출 안 됨", async () => {
		const libFile = path.join(hooksDir, "lib", "dry-hook.sh");
		await writeFile(libFile, "# dry");
		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, 'source "$HOOKS_DIR/lib/dry-hook.sh"\n');
		let mutationCount = 0;
		const mutationHooks: DeployMutationHooks = {
			async mutate(_targetPath, operation) {
				mutationCount += 1;
				await operation();
			},
		};
		await syncShellDependencies(entryFile, hooksDir, targetDir, true, undefined, mutationHooks);
		expect(mutationCount).toBe(0);
	});

	it("중첩 디렉토리 의존성(lib/sub/foo.sh) 복사 시 mkdir -p 동작 확인", async () => {
		const nestedFile = path.join(hooksDir, "lib", "sub", "deep.sh");
		await writeFile(nestedFile, "# deep");

		const entryFile = path.join(hooksDir, "entry.sh");
		await writeFile(entryFile, 'source "$HOOKS_DIR/lib/sub/deep.sh"\n');

		await syncShellDependencies(entryFile, hooksDir, targetDir, false);

		const expected = path.join(targetDir, "lib", "sub", "deep.sh");
		expect(await exists(expected)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// syncShellDepsForDir
// ---------------------------------------------------------------------------

describe("syncShellDepsForDir", () => {
	it("디렉토리 내 .sh 파일들의 의존성이 모두 수집·복사됨", async () => {
		// lib dependency shared by both hooks
		const libFile = path.join(hooksDir, "lib", "shared.sh");
		await writeFile(libFile, "# shared");

		const hookA = path.join(hooksDir, "hook-a.sh");
		const hookB = path.join(hooksDir, "hook-b.sh");
		await writeFile(hookA, 'source "$HOOKS_DIR/lib/shared.sh"\n');
		await writeFile(hookB, 'source "$HOOKS_DIR/lib/shared.sh"\n');

		await syncShellDepsForDir(hooksDir, hooksDir, targetDir, false);

		const expected = path.join(targetDir, "lib", "shared.sh");
		expect(await exists(expected)).toBe(true);
	});

	it("디렉토리 내 _test.sh 파일은 스캔 대상에서 제외", async () => {
		// If hook-a_test.sh were scanned, lib/test-only.sh would be copied.
		// We verify it is NOT copied.
		const testOnlyLib = path.join(hooksDir, "lib", "test-only.sh");
		await writeFile(testOnlyLib, "# test-only");

		const testHook = path.join(hooksDir, "hook-a_test.sh");
		await writeFile(testHook, 'source "$HOOKS_DIR/lib/test-only.sh"\n');

		await syncShellDepsForDir(hooksDir, hooksDir, targetDir, false);

		const expected = path.join(targetDir, "lib", "test-only.sh");
		expect(await exists(expected)).toBe(false);
	});

	it("디렉토리 내 비-.sh 파일(.ts, .json 등)은 무시", async () => {
		const libFile = path.join(hooksDir, "lib", "ts-dep.sh");
		await writeFile(libFile, "# ts-dep");

		// A .ts file that contains a source-like line — should be ignored
		const tsFile = path.join(hooksDir, "hook.ts");
		await writeFile(tsFile, 'source "$HOOKS_DIR/lib/ts-dep.sh"\n');

		const jsonFile = path.join(hooksDir, "config.json");
		await writeFile(jsonFile, '{"key": "value"}');

		await syncShellDepsForDir(hooksDir, hooksDir, targetDir, false);

		const expected = path.join(targetDir, "lib", "ts-dep.sh");
		expect(await exists(expected)).toBe(false);
	});

	it("존재하지 않는 hookDir — 오류 없이 반환", async () => {
		const nonExistentDir = path.join(tmpDir, "does-not-exist");
		// Should not throw
		await expect(
			syncShellDepsForDir(nonExistentDir, hooksDir, targetDir, false),
		).resolves.toBeUndefined();
	});

	it("디렉토리 훅 내 .sh가 상위 lib/ 경로를 source할 때 hooksBaseDir 기반으로 resolve", async () => {
		// Structure: hooksDir/lib/shared.sh + hooksDir/myhook/entry.sh
		// entry.sh sources $VAR/lib/shared.sh (relative to hooksDir, not myhook/)
		const sharedLib = path.join(hooksDir, "lib", "shared.sh");
		await writeFile(sharedLib, "# shared from lib");

		const hookSubDir = path.join(hooksDir, "myhook");
		const entryFile = path.join(hookSubDir, "entry.sh");
		await writeFile(entryFile, 'source "$HOOKS_DIR/lib/shared.sh"\n');

		// hooksBaseDir = hooksDir (the hooks root), not hookSubDir
		await syncShellDepsForDir(hookSubDir, hooksDir, targetDir, false);

		// Should copy lib/shared.sh relative to hooksDir into targetDir
		const expected = path.join(targetDir, "lib", "shared.sh");
		expect(await exists(expected)).toBe(true);
		const content = await fs.readFile(expected, "utf8");
		expect(content).toBe("# shared from lib");
	});

	it("syncShellDepsForDir가 callback을 각 dependency로 전달함", async () => {
		const libFile = path.join(hooksDir, "lib", "forwarded.sh");
		await writeFile(libFile, "forwarded");
		const hookFile = path.join(hooksDir, "hook.sh");
		await writeFile(hookFile, 'source "$HOOKS_DIR/lib/forwarded.sh"\n');
		const observed: string[] = [];
		await syncShellDepsForDir(hooksDir, hooksDir, targetDir, false, (targetPath) => {
			observed.push(targetPath);
		});
		expect(observed).toEqual([path.join(targetDir, "lib", "forwarded.sh")]);
	});

	it("syncShellDepsForDir가 mutation hook과 callback을 각 dependency로 전달함", async () => {
		const libFile = path.join(hooksDir, "lib", "forwarded-hook.sh");
		await writeFile(libFile, "forwarded");
		const hookFile = path.join(hooksDir, "hook.sh");
		await writeFile(hookFile, 'source "$HOOKS_DIR/lib/forwarded-hook.sh"\n');
		const observed: string[] = [];
		const mutated: string[] = [];
		const mutationHooks: DeployMutationHooks = {
			async mutate(targetPath, operation) {
				mutated.push(targetPath);
				await operation();
			},
		};
		await syncShellDepsForDir(hooksDir, hooksDir, targetDir, false, (targetPath) => {
			observed.push(targetPath);
		}, mutationHooks);
		expect(observed).toEqual([path.join(targetDir, "lib", "forwarded-hook.sh")]);
		expect(mutated).toEqual(observed);
	});
});

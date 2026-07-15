import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { syncDirectory, copyFile, rewriteLibImports } from "./sync-directory.ts";
import { detectBareImports } from "../adapters/ts-lib-deps.ts";

async function writeFile(filePath: string, content: string, mode?: number): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content);
	if (mode !== undefined) {
		await fs.chmod(filePath, mode);
	}
}

async function exists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

async function isExecutable(p: string): Promise<boolean> {
	const stat = await fs.stat(p);
	return Boolean(stat.mode & 0o111);
}

describe("syncDirectory", () => {
	let tmpDir: string;
	let src: string;
	let tgt: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-directory-test-"));
		src = path.join(tmpDir, "src");
		tgt = path.join(tmpDir, "tgt");
		await fs.mkdir(src, { recursive: true });
		await fs.mkdir(tgt, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	describe("중첩 디렉토리 재귀 복사", () => {
		it("copies nested source files to target", async () => {
			await writeFile(path.join(src, "a.ts"), "a");
			await writeFile(path.join(src, "sub/b.ts"), "b");
			await writeFile(path.join(src, "sub/deep/c.ts"), "c");

			await syncDirectory(src, tgt);

			expect(await exists(path.join(tgt, "a.ts"))).toBe(true);
			expect(await exists(path.join(tgt, "sub/b.ts"))).toBe(true);
			expect(await exists(path.join(tgt, "sub/deep/c.ts"))).toBe(true);

			const content = await fs.readFile(path.join(tgt, "sub/b.ts"), "utf8");
			expect(content).toBe("b");
		});
	});

	describe("고아 파일 삭제 (--delete 동작)", () => {
		it("deletes target files absent from source", async () => {
			await writeFile(path.join(src, "keep.ts"), "keep");
			await writeFile(path.join(tgt, "keep.ts"), "keep");
			await writeFile(path.join(tgt, "orphan.ts"), "orphan");

			await syncDirectory(src, tgt);

			expect(await exists(path.join(tgt, "keep.ts"))).toBe(true);
			expect(await exists(path.join(tgt, "orphan.ts"))).toBe(false);
		});

		it("deletes orphan files in nested directories", async () => {
			await writeFile(path.join(src, "a.ts"), "a");
			await writeFile(path.join(tgt, "a.ts"), "a");
			await writeFile(path.join(tgt, "sub/orphan.ts"), "orphan");

			await syncDirectory(src, tgt);

			expect(await exists(path.join(tgt, "sub/orphan.ts"))).toBe(false);
		});
	});

	describe("제외 패턴 (*.test.ts 기본값)", () => {
		it("does not copy *.test.ts files", async () => {
			await writeFile(path.join(src, "foo.ts"), "foo");
			await writeFile(path.join(src, "foo.test.ts"), "test");

			await syncDirectory(src, tgt);

			expect(await exists(path.join(tgt, "foo.ts"))).toBe(true);
			expect(await exists(path.join(tgt, "foo.test.ts"))).toBe(false);
		});

		it("excludes *.test.ts files in nested paths", async () => {
			await writeFile(path.join(src, "sub/bar.ts"), "bar");
			await writeFile(path.join(src, "sub/bar.test.ts"), "bartest");

			await syncDirectory(src, tgt);

			expect(await exists(path.join(tgt, "sub/bar.ts"))).toBe(true);
			expect(await exists(path.join(tgt, "sub/bar.test.ts"))).toBe(false);
		});

		it("does not delete excluded files that exist only in target", async () => {
			await writeFile(path.join(src, "foo.ts"), "foo");
			await writeFile(path.join(tgt, "foo.ts"), "foo");
			await writeFile(path.join(tgt, "foo.test.ts"), "test");

			await syncDirectory(src, tgt);

			expect(await exists(path.join(tgt, "foo.ts"))).toBe(true);
			expect(await exists(path.join(tgt, "foo.test.ts"))).toBe(true);
		});

		it("applies custom exclude patterns", async () => {
			await writeFile(path.join(src, "script.sh"), "#!/bin/bash");
			await writeFile(path.join(src, "readme.md"), "docs");

			await syncDirectory(src, tgt, { exclude: ["*.md"] });

			expect(await exists(path.join(tgt, "script.sh"))).toBe(true);
			expect(await exists(path.join(tgt, "readme.md"))).toBe(false);
		});

		it("excludes python cache artifacts", async () => {
			// A local pytest run leaves __pycache__/.pytest_cache + *.pyc on disk.
			// sync copies directories verbatim (not from git), so .gitignore does not
			// protect the walk — these must be pruned during the FS walk.
			await writeFile(path.join(src, "mod.py"), "print('hi')");
			await writeFile(path.join(src, "__pycache__/mod.cpython-312.pyc"), "bytecode");
			await writeFile(path.join(src, ".pytest_cache/CACHEDIR.TAG"), "tag");
			await writeFile(path.join(src, "pkg/sub.py"), "x = 1");
			await writeFile(path.join(src, "pkg/__pycache__/sub.cpython-312.pyc"), "bytecode");

			await syncDirectory(src, tgt);

			// Legitimate .py source is still deployed (prune scoping).
			expect(await exists(path.join(tgt, "mod.py"))).toBe(true);
			expect(await exists(path.join(tgt, "pkg/sub.py"))).toBe(true);

			// Cache directories and their *.pyc contents are pruned during the walk.
			expect(await exists(path.join(tgt, "__pycache__"))).toBe(false);
			expect(await exists(path.join(tgt, "__pycache__/mod.cpython-312.pyc"))).toBe(false);
			expect(await exists(path.join(tgt, ".pytest_cache"))).toBe(false);
			expect(await exists(path.join(tgt, "pkg/__pycache__"))).toBe(false);
			expect(await exists(path.join(tgt, "pkg/__pycache__/sub.cpython-312.pyc"))).toBe(false);
		});

		it("prunes python cache even when custom exclude is passed", async () => {
			// Regression: callers like claude.ts pass { exclude: ["*.test.ts"] }.
			// Under the old `?? DEFAULT_EXCLUDE` logic this REPLACES DEFAULT_EXCLUDE,
			// so __pycache__/.pytest_cache/*.pyc are no longer excluded. The fix must
			// always union PY_CACHE_EXCLUDE with the caller's list.
			await writeFile(path.join(src, "script.sh"), "#!/bin/bash\necho hi");
			await writeFile(path.join(src, "helper.ts"), "export const x = 1;");
			await writeFile(path.join(src, "helper.test.ts"), "import './helper.ts'");
			await writeFile(path.join(src, "__pycache__/mod.cpython-312.pyc"), "bytecode");
			await writeFile(
				path.join(src, ".pytest_cache/CACHEDIR.TAG"),
				"Signature: 8a477f597d28d172789f06886806bc55",
			);
			await writeFile(path.join(src, "pkg/sub.py"), "x = 1");
			await writeFile(path.join(src, "pkg/__pycache__/sub.cpython-312.pyc"), "bytecode");

			// Custom exclude passed — currently replaces DEFAULT_EXCLUDE (bug).
			await syncDirectory(src, tgt, { exclude: ["*.test.ts"] });

			// Regular files are still copied.
			expect(await exists(path.join(tgt, "script.sh"))).toBe(true);
			expect(await exists(path.join(tgt, "helper.ts"))).toBe(true);
			expect(await exists(path.join(tgt, "pkg/sub.py"))).toBe(true);

			// Custom exclude still applies.
			expect(await exists(path.join(tgt, "helper.test.ts"))).toBe(false);

			// Python cache must be pruned regardless of custom exclude.
			expect(await exists(path.join(tgt, "__pycache__/mod.cpython-312.pyc"))).toBe(false);
			expect(await exists(path.join(tgt, ".pytest_cache/CACHEDIR.TAG"))).toBe(false);
			expect(await exists(path.join(tgt, "pkg/__pycache__/sub.cpython-312.pyc"))).toBe(false);
		});

		it("prunes __fixtures__ with the default exclude (no options passed)", async () => {
			await writeFile(path.join(src, "helper.ts"), "export const x = 1;");
			await writeFile(path.join(src, "__fixtures__/sample.md"), "fixture content");

			await syncDirectory(src, tgt);

			expect(await exists(path.join(tgt, "helper.ts"))).toBe(true);
			expect(await exists(path.join(tgt, "__fixtures__/sample.md"))).toBe(false);
		});

		it("prunes __fixtures__ even when a custom exclude is passed", async () => {
			// Regression: callers like { exclude: ["*.test.ts"] } must not lose
			// __fixtures__ pruning, mirroring the PY_CACHE_EXCLUDE union above.
			await writeFile(path.join(src, "helper.ts"), "export const x = 1;");
			await writeFile(path.join(src, "helper.test.ts"), "import './helper.ts'");
			await writeFile(path.join(src, "__fixtures__/sample.md"), "fixture content");

			await syncDirectory(src, tgt, { exclude: ["*.test.ts"] });

			expect(await exists(path.join(tgt, "helper.ts"))).toBe(true);
			expect(await exists(path.join(tgt, "helper.test.ts"))).toBe(false);
			expect(await exists(path.join(tgt, "__fixtures__/sample.md"))).toBe(false);
		});
	});

	describe("실행 권한 보존", () => {
		it("sets +x permission on target for executable source files", async () => {
			const scriptPath = path.join(src, "hook.sh");
			await writeFile(scriptPath, "#!/bin/bash\necho hi", 0o755);

			await syncDirectory(src, tgt);

			expect(await isExecutable(path.join(tgt, "hook.sh"))).toBe(true);
		});

		it("copies non-executable files without +x permission", async () => {
			const filePath = path.join(src, "data.json");
			await writeFile(filePath, "{}", 0o644);

			await syncDirectory(src, tgt);

			const stat = await fs.stat(path.join(tgt, "data.json"));
			expect(stat.mode & 0o111).toBe(0);
		});
	});

	describe("고아 제거 후 빈 디렉토리 정리", () => {
		it("removes empty directory after orphan file deletion", async () => {
			await writeFile(path.join(src, "a.ts"), "a");
			await writeFile(path.join(tgt, "a.ts"), "a");
			await writeFile(path.join(tgt, "empty-dir/orphan.ts"), "orphan");

			await syncDirectory(src, tgt);

			expect(await exists(path.join(tgt, "empty-dir/orphan.ts"))).toBe(false);
			expect(await exists(path.join(tgt, "empty-dir"))).toBe(false);
		});

		it("removes all nested empty directories", async () => {
			await writeFile(path.join(src, "a.ts"), "a");
			await writeFile(path.join(tgt, "a.ts"), "a");
			await writeFile(path.join(tgt, "deep/nested/orphan.ts"), "orphan");

			await syncDirectory(src, tgt);

			expect(await exists(path.join(tgt, "deep/nested"))).toBe(false);
			expect(await exists(path.join(tgt, "deep"))).toBe(false);
		});
	});
});

describe("@lib/ alias rewrite at copy time (platformRoot option)", () => {
	let tmpDir: string;
	let src: string;
	let tgt: string;
	let platformRoot: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-directory-rewrite-test-"));
		platformRoot = path.join(tmpDir, "platform");
		src = path.join(tmpDir, "src");
		tgt = path.join(platformRoot, "hooks", "my-hook");
		await fs.mkdir(src, { recursive: true });
		await fs.mkdir(platformRoot, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("immediately-written .ts file contains no raw @lib/ after syncDirectory with platformRoot", async () => {
		// hooks/my-hook/index.ts lives at depth 2 from platformRoot
		// so @lib/ should become ../../lib/
		await writeFile(path.join(src, "index.ts"), "import { foo } from '@lib/types.ts';\n");

		await syncDirectory(src, tgt, { platformRoot });

		const content = await fs.readFile(path.join(tgt, "index.ts"), "utf8");
		expect(content).not.toContain("@lib/");
		expect(content).toContain("'../../lib/types.ts'");
	});

	it("rewrites @lib/ in nested .ts files using correct depth", async () => {
		// hooks/my-hook/sub/deep.ts lives at depth 3 from platformRoot
		await writeFile(path.join(src, "sub", "deep.ts"), `import { X } from "@lib/foo.ts";\n`);

		await syncDirectory(src, tgt, { platformRoot });

		const content = await fs.readFile(path.join(tgt, "sub", "deep.ts"), "utf8");
		expect(content).not.toContain("@lib/");
		expect(content).toContain('"../../../lib/foo.ts"');
	});

	it("non-.ts files are copied verbatim even with platformRoot", async () => {
		const original = "some raw content with @lib/ mention";
		await writeFile(path.join(src, "readme.md"), original);

		await syncDirectory(src, tgt, { platformRoot });

		const content = await fs.readFile(path.join(tgt, "readme.md"), "utf8");
		expect(content).toBe(original);
	});

	it(".ts files without @lib/ are byte-identical after copy with platformRoot", async () => {
		const original = "import { X } from './local.ts';\n";
		await writeFile(path.join(src, "clean.ts"), original);

		await syncDirectory(src, tgt, { platformRoot });

		const content = await fs.readFile(path.join(tgt, "clean.ts"), "utf8");
		expect(content).toBe(original);
	});

	it("post-pass rewrite is a no-op when syncDirectory already rewrote aliases", async () => {
		await writeFile(path.join(src, "index.ts"), "import { foo } from '@lib/types.ts';\n");

		await syncDirectory(src, tgt, { platformRoot });

		const contentBefore = await fs.readFile(path.join(tgt, "index.ts"), "utf8");

		// Simulate post-pass: rewrite again. Result must be identical (idempotent).
		const depth = path.relative(platformRoot, tgt).split(path.sep).length;
		const prefix = "../".repeat(depth);
		const rewritten = contentBefore
			.replace(/'@lib\//g, `'${prefix}lib/`)
			.replace(/"@lib\//g, `"${prefix}lib/`);

		expect(rewritten).toBe(contentBefore);
	});
});

describe("rewriteLibImports bare specifier rule (bundled vendor packages)", () => {
	// Mirrors the @lib/ rewrite assertion style: not.toContain(raw) + toContain(rewritten).
	// The platformRoot is fixed; targetFile depth is varied to assert the relative prefix.
	const platformRoot = "/p/.claude";
	const bundled = new Set(["picomatch"]);

	it("depth 0 — bare 'picomatch' → './lib/vendor/picomatch.js'", () => {
		const content = "import picomatch from 'picomatch';\n";
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).not.toContain("'picomatch'");
		expect(result).toContain("'./lib/vendor/picomatch.js'");
	});

	it('depth 1 — bare "picomatch" → "../lib/vendor/picomatch.js"', () => {
		const content = 'import picomatch from "picomatch";\n';
		const targetFile = path.join(platformRoot, "agents", "oracle.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).not.toContain('"picomatch"');
		expect(result).toContain('"../lib/vendor/picomatch.js"');
	});

	it("depth 2 — bare 'picomatch' → '../../lib/vendor/picomatch.js'", () => {
		const content = "import picomatch from 'picomatch';\n";
		const targetFile = path.join(platformRoot, "skills", "pin-thing", "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).not.toContain("'picomatch'");
		expect(result).toContain("'../../lib/vendor/picomatch.js'");
	});

	it("collision-safety (D-4): rewrites 'picomatch' but leaves 'picomatch-extra', the 'picomatch/lib/x' sub-path, and the bare identifier picomatchResult untouched", () => {
		const content = [
			"import picomatch from 'picomatch';",
			"import extra from 'picomatch-extra';",
			"import sub from 'picomatch/lib/x';",
			"const picomatchResult = picomatch('*.js');",
			"",
		].join("\n");
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		// Exact 'picomatch' specifier is repointed at the bundle.
		expect(result).toContain("'./lib/vendor/picomatch.js'");
		// Look-alikes are NOT rewritten.
		expect(result).toContain("'picomatch-extra'");
		expect(result).toContain("'picomatch/lib/x'");
		expect(result).toContain("const picomatchResult = picomatch('*.js');");
		// No quoted bare 'picomatch' specifier survives, but the look-alikes prove
		// the rewrite did not touch them (their quoted forms differ).
		expect(result).not.toContain("from 'picomatch';");
	});

	it("@lib/ rewrite UNREGRESSED: @lib/ still rewrites alongside a bundled bare specifier", () => {
		const content = [
			"import { x } from '@lib/types.ts';",
			"import picomatch from 'picomatch';",
			"",
		].join("\n");
		const targetFile = path.join(platformRoot, "agents", "oracle.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		// @lib/ rewrite preserved at depth 1 (mirrors existing @lib/ assertions).
		expect(result).not.toContain("@lib/");
		expect(result).toContain("'../lib/types.ts'");
		// Bare specifier repointed at the vendored bundle.
		expect(result).toContain("'../lib/vendor/picomatch.js'");
	});

	it("no bundled package present — content with only an unrelated bare name is unchanged", () => {
		const content = "import chalk from 'chalk';\n";
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		// 'chalk' is not in the bundled set → left untouched.
		expect(result).toBe(content);
	});

	it("non-import string literal with same name is NOT rewritten", () => {
		// F4 anchor fix: a plain string literal that is NOT a module specifier must
		// not be touched, even though it contains the exact same quoted text.
		const content = [
			"import picomatch from 'picomatch';",
			"const packageName = 'picomatch';",
			"",
		].join("\n");
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		// The import specifier is rewritten.
		expect(result).toContain("'./lib/vendor/picomatch.js'");
		// The plain string literal is NOT rewritten.
		expect(result).toContain("const packageName = 'picomatch';");
	});

	it("side-effect import 'pkg' is rewritten", () => {
		const content = "import 'picomatch';\n";
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).not.toContain("import 'picomatch'");
		expect(result).toContain("'./lib/vendor/picomatch.js'");
	});

	it("dynamic import('pkg') is rewritten", () => {
		const content = "const m = import('picomatch');\n";
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).not.toContain("import('picomatch')");
		expect(result).toContain("'./lib/vendor/picomatch.js'");
	});

	it("F4: a dynamic import() shape inside a string literal is NOT rewritten", () => {
		const content = "const snippet = \"import('picomatch')\";\n";
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).toBe(content);
	});

	it("require('pkg') is NOT rewritten (F5: discovery is ESM-only, no require)", () => {
		// Discovery (findBareNpmImports) never detects require(), so the rewrite must
		// not act on it either — the two sides must agree. The project is ESM-only.
		const content = "const m = require('picomatch');\n";
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).toBe(content);
	});

	it("F4: package name inside a // line comment is NOT rewritten", () => {
		const content = "// import 'picomatch'\nconst noop = 1;\n";
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).toBe(content);
	});

	it("F4: package name inside a JSDoc continuation line is NOT rewritten", () => {
		const content = "/**\n * from 'picomatch'\n */\nconst noop = 1;\n";
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).toBe(content);
	});

	it("F4: an import-shaped string literal is NOT rewritten", () => {
		const content = "const example = \"import x from 'picomatch';\";\n";
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).toBe(content);
	});

	it("F4: a 'from pkg' fragment inside a string literal is NOT rewritten", () => {
		const content = "console.log(\"rewrote from 'picomatch'\");\n";
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).toBe(content);
	});

	it("export ... from 'pkg' is rewritten", () => {
		const content = "export { default } from 'picomatch';\n";
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).not.toContain("from 'picomatch'");
		expect(result).toContain("'./lib/vendor/picomatch.js'");
	});

	it("double-quoted import specifier is rewritten", () => {
		const content = 'import picomatch from "picomatch";\n';
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).not.toContain('"picomatch"');
		expect(result).toContain('"./lib/vendor/picomatch.js"');
	});

	it("double-quoted non-import literal is NOT rewritten", () => {
		const content = ['import picomatch from "picomatch";', 'const pkg = "picomatch";', ""].join(
			"\n",
		);
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).toContain('"./lib/vendor/picomatch.js"');
		expect(result).toContain('const pkg = "picomatch";');
	});

	it("regex-special chars in package name are escaped (e.g. @scope/pkg)", () => {
		const scopedBundled = new Set(["@scope/some.pkg"]);
		const content = "import x from '@scope/some.pkg';\nconst s = '@scope/some.pkg';\n";
		const targetFile = path.join(platformRoot, "run.ts");

		const result = rewriteLibImports(content, targetFile, platformRoot, scopedBundled);

		// import is rewritten
		expect(result).toContain("'./lib/vendor/@scope/some.pkg.js'");
		// plain literal is NOT rewritten
		expect(result).toContain("const s = '@scope/some.pkg';");
	});
});

describe("rewriteLibImports post-condition guard (fail-fast on unrewritten bare bundled import)", () => {
	const platformRoot = "/p/.claude";
	const bundled = new Set(["picomatch"]);
	const targetFile = path.join(platformRoot, "run.ts");

	it("(a) multi-line static import of bundled package throws after rewrite", () => {
		// `} from "picomatch"` line starts with `}` — rewrite regex misses it.
		const content = ["import {", "  foo,", '} from "picomatch";', ""].join("\n");

		expect(() => rewriteLibImports(content, targetFile, platformRoot, bundled)).toThrow(
			/picomatch/,
		);
	});

	it("(b) single-line import rewrites normally — no throw", () => {
		const content = 'import picomatch from "picomatch";\n';

		const result = rewriteLibImports(content, targetFile, platformRoot, bundled);

		expect(result).toContain('"./lib/vendor/picomatch.js"');
		expect(result).not.toContain('"picomatch"');
	});

	it("(c) package name only in a // comment — no throw (false-positive guard)", () => {
		// detectBareImports skips comment lines, so the guard must not fire here.
		const content = "// import picomatch from 'picomatch'\nconst noop = 1;\n";

		expect(() => rewriteLibImports(content, targetFile, platformRoot, bundled)).not.toThrow();
	});

	it("(c2) package name only in a string literal — no throw (false-positive guard)", () => {
		const content = 'const s = "picomatch";\n';

		expect(() => rewriteLibImports(content, targetFile, platformRoot, bundled)).not.toThrow();
	});
});

describe("detectBareImports (content-based bare import detection)", () => {
	it("(d1) single-line import returns the package name", () => {
		const content = "import picomatch from 'picomatch';\n";
		expect(detectBareImports(content)).toEqual(["picomatch"]);
	});

	it("(d2) multi-line import — `} from 'pkg'` line — returns the package name", () => {
		const content = ["import {", "  foo,", "} from 'picomatch';", ""].join("\n");
		expect(detectBareImports(content)).toContain("picomatch");
	});

	it("(d3) comment lines are excluded", () => {
		const content = "// import x from 'picomatch'\n/* from 'picomatch' */\nconst n = 1;\n";
		expect(detectBareImports(content)).toEqual([]);
	});

	it("(d4) relative paths are excluded", () => {
		const content = "import x from './local.ts';\nimport y from '../utils.ts';\n";
		expect(detectBareImports(content)).toEqual([]);
	});

	it("(d5) @lib/ aliases are excluded", () => {
		const content = "import { x } from '@lib/types.ts';\n";
		expect(detectBareImports(content)).toEqual([]);
	});

	it("(d6) node: and bun: builtins are excluded", () => {
		const content = "import fs from 'node:fs';\nimport { serve } from 'bun:test';\n";
		expect(detectBareImports(content)).toEqual([]);
	});

	it("(d7) unprefixed node builtins are excluded", () => {
		const content = "import fs from 'fs';\nimport path from 'path';\n";
		expect(detectBareImports(content)).toEqual([]);
	});

	it("(d8) already-rewritten vendor path (relative) does not fire", () => {
		// After rewrite, 'picomatch' → './lib/vendor/picomatch.js' (relative path).
		const content = "import picomatch from './lib/vendor/picomatch.js';\n";
		expect(detectBareImports(content)).toEqual([]);
	});
});

describe("copyFile", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "copy-file-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	describe("파일 복사", () => {
		it("copies file contents", async () => {
			const src = path.join(tmpDir, "src.txt");
			const tgt = path.join(tmpDir, "nested/tgt.txt");
			await fs.writeFile(src, "hello");

			await copyFile(src, tgt);

			const content = await fs.readFile(tgt, "utf8");
			expect(content).toBe("hello");
		});

		it("creates target directory when it does not exist", async () => {
			const src = path.join(tmpDir, "src.txt");
			const tgt = path.join(tmpDir, "new/deep/tgt.txt");
			await fs.writeFile(src, "data");

			await copyFile(src, tgt);

			expect(await exists(tgt)).toBe(true);
		});
	});

	describe("실행 권한 보존", () => {
		it("makes target executable when source is executable", async () => {
			const src = path.join(tmpDir, "script.sh");
			const tgt = path.join(tmpDir, "out/script.sh");
			await fs.writeFile(src, "#!/bin/bash");
			await fs.chmod(src, 0o755);

			await copyFile(src, tgt);

			const stat = await fs.stat(tgt);
			expect(stat.mode & 0o111).toBeTruthy();
		});

		it("target is non-executable when source is non-executable", async () => {
			const src = path.join(tmpDir, "config.json");
			const tgt = path.join(tmpDir, "out/config.json");
			await fs.writeFile(src, "{}");
			await fs.chmod(src, 0o644);

			await copyFile(src, tgt);

			const stat = await fs.stat(tgt);
			expect(stat.mode & 0o111).toBe(0);
		});
	});
});

import { describe, it, expect } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { parseCodexVersion, assertCodexVersionAllowed } from "./codex-version.ts";
import { assertCodexVersionIfTargeted } from "../sync.ts";

// ---------------------------------------------------------------------------
// parseCodexVersion
// ---------------------------------------------------------------------------

describe("parseCodexVersion", () => {
	it("extracts the version from real `codex --version` output", () => {
		expect(parseCodexVersion("codex-cli 0.144.1")).toBe("0.144.1");
	});

	it("returns null when no version-shaped substring is present", () => {
		expect(parseCodexVersion("not a version string")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// assertCodexVersionAllowed
// ---------------------------------------------------------------------------

describe("assertCodexVersionAllowed", () => {
	it("does not throw when the observed version is in the allowlist", () => {
		expect(() => assertCodexVersionAllowed("0.144.1", ["0.144.1"])).not.toThrow();
	});

	it("throws naming both the observed version and the allowed set when observed is outside the allowlist", () => {
		let thrown: unknown;
		try {
			assertCodexVersionAllowed("0.145.0", ["0.144.1"]);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(Error);
		const message = (thrown as Error).message;
		expect(message).toContain("0.145.0");
		expect(message).toContain("0.144.1");
	});
});

// ---------------------------------------------------------------------------
// assertCodexVersionIfTargeted (sync.ts entry-point wiring)
// ---------------------------------------------------------------------------

describe("assertCodexVersionIfTargeted (sync.ts entry-point wiring)", () => {
	it("skips cleanly when codex is not a configured target platform (no codex install required)", async () => {
		let fetchCalled = false;
		await assertCodexVersionIfTargeted({
			isCodexTargetPlatform: async () => false,
			fetchVersion: () => {
				fetchCalled = true;
				return "codex-cli 0.144.1";
			},
		});
		expect(fetchCalled).toBe(false);
	});

	it("positive control: real installed codex (probe-verified 0.144.1) is in the real allowlist -> resolves", async () => {
		// No fetchVersion override: exercises the real installed `codex` binary on
		// PATH and the real config.yaml codex-versions allowlist.
		await expect(
			assertCodexVersionIfTargeted({ isCodexTargetPlatform: async () => true }),
		).resolves.toBeUndefined();
	});

	it("negative control: a codex version outside the allowlist, stubbed on a temp PATH, throws naming both versions", async () => {
		const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-version-test-"));
		const stubPath = path.join(stubDir, "codex");
		fs.writeFileSync(stubPath, "#!/bin/sh\necho 'codex-cli 0.145.0'\n");
		fs.chmodSync(stubPath, 0o755);

		const originalPath = process.env.PATH;
		process.env.PATH = `${stubDir}:${originalPath}`;
		try {
			let thrown: unknown;
			try {
				await assertCodexVersionIfTargeted({ isCodexTargetPlatform: async () => true });
			} catch (err) {
				thrown = err;
			}
			expect(thrown).toBeInstanceOf(Error);
			const message = (thrown as Error).message;
			expect(message).toContain("0.145.0");
			expect(message).toContain("0.144.1");
		} finally {
			process.env.PATH = originalPath;
			fs.rmSync(stubDir, { recursive: true, force: true });
		}
	});
});

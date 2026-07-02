#!/usr/bin/env bun

/**
 * Integration tests for the record.ts CLI wrapper.
 *
 * C10: invalid entity whose id.md already exists must report "escaped", not "recorded".
 * Valid entity must report "recorded".
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

const RECORD_PATH = path.join(import.meta.dirname, "record.ts");

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pin-record-test-"));
}

/** Write a minimal pins.yaml into dir so requireManifest can resolve it. */
function writePinsYaml(dir: string, pinsDir: string): void {
	fs.writeFileSync(path.join(dir, "pins.yaml"), `location: ${pinsDir}\nscope: private\n`, "utf8");
}

/**
 * Spawn record.ts with the given JSON payload as stdin.
 * cwd and OMT_DIR are both set to projectDir so requireManifest finds pins.yaml there.
 */
async function runRecord(
	projectDir: string,
	entityJson: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["bun", RECORD_PATH], {
		cwd: projectDir,
		stdin: new TextEncoder().encode(entityJson),
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, OMT_DIR: projectDir },
	});
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	return { exitCode, stdout, stderr };
}

/** Minimal valid Frontmatter that passes tbox validation. */
function validFrontmatter(id: string) {
	return {
		id,
		type: "code",
		source: "github",
		authority: "test",
		source_url: "https://example.com",
		tier: "1",
		tags: "test",
		sensitivity: "private",
		status: "active" as const,
		updated_at: "2026-01-01T00:00:00Z",
		checked_at: "2026-01-01T00:00:00Z",
		created_at: "2026-01-01T00:00:00Z",
		relations: [],
	};
}

/** Frontmatter with an invalid type — triggers unknown_type validation failure. */
function invalidFrontmatter(id: string) {
	return {
		...validFrontmatter(id),
		type: "not-a-real-type",
	};
}

// ── C10: existing .md + invalid entity → escaped, not recorded ───────────────

describe("C10 — existing id.md + invalid entity reports escaped", () => {
	let tmpDir: string;
	let pinsDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		pinsDir = path.join(tmpDir, "pins");
		fs.mkdirSync(pinsDir, { recursive: true });
		writePinsYaml(tmpDir, pinsDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("reports escaped when id.md exists and entity is invalid", async () => {
		const id = "test-entity-c10";

		// Pre-create the .md file to simulate an existing pin
		fs.writeFileSync(path.join(pinsDir, `${id}.md`), "# existing pin\n", "utf8");

		const payload = JSON.stringify({
			frontmatter: invalidFrontmatter(id),
			body: "## 한 줄 요지\ntest",
		});

		const { exitCode, stdout } = await runRecord(tmpDir, payload);

		expect(exitCode).toBe(0);
		const result = JSON.parse(stdout.trim());
		expect(result.id).toBe(id);
		// C10: must be "escaped", not "recorded"
		expect(result.status).toBe("escaped");
	});

	test(".escape.jsonl grows when entity is invalid", async () => {
		const id = "test-entity-c10-size";

		fs.writeFileSync(path.join(pinsDir, `${id}.md`), "# existing pin\n", "utf8");

		const escapePath = path.join(pinsDir, ".escape.jsonl");
		const sizeBefore = fs.existsSync(escapePath) ? fs.statSync(escapePath).size : 0;

		const payload = JSON.stringify({
			frontmatter: invalidFrontmatter(id),
			body: "## 한 줄 요지\ntest",
		});

		await runRecord(tmpDir, payload);

		const sizeAfter = fs.existsSync(escapePath) ? fs.statSync(escapePath).size : 0;
		expect(sizeAfter).toBeGreaterThan(sizeBefore);
	});
});

// ── Valid entity with no existing .md → recorded ─────────────────────────────

describe("Valid entity reports recorded", () => {
	let tmpDir: string;
	let pinsDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		pinsDir = path.join(tmpDir, "pins");
		fs.mkdirSync(pinsDir, { recursive: true });
		writePinsYaml(tmpDir, pinsDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("reports recorded when entity is valid and no existing .md", async () => {
		const id = "test-entity-valid-new";

		const payload = JSON.stringify({
			frontmatter: validFrontmatter(id),
			body: "## 한 줄 요지\ntest\n## SSOT 위치\nhere\n## 전후 컨텍스트\nctx\n## 관련 cross-link\nnone",
		});

		const { exitCode, stdout } = await runRecord(tmpDir, payload);

		expect(exitCode).toBe(0);
		const result = JSON.parse(stdout.trim());
		expect(result.id).toBe(id);
		expect(result.status).toBe("recorded");
	});
});

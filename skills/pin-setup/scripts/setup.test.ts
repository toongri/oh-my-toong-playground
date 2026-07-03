#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

const SETUP_PATH = path.join(import.meta.dirname, "setup.ts");

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pin-setup-test-"));
}

/**
 * Runs setup.ts as a subprocess in cwd=projectDir with the given extra args.
 * Overrides HOME to tmpHome so resolvePinsHome() resolves to a
 * test-controlled location instead of the real ~/.pins/.
 * Returns { exitCode, stdout, stderr }.
 */
async function runSetup(
	projectDir: string,
	args: string[],
	tmpHome: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["bun", SETUP_PATH, ...args], {
		cwd: projectDir,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			OMT_DIR: undefined as unknown as string,
			HOME: tmpHome,
		},
	});
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	return { exitCode, stdout, stderr };
}

/**
 * Returns the expected resolvePinsHome() value for a subprocess running with
 * cwd=projectDir and HOME=tmpHome.  Since projectDir is not a git repo,
 * deriveProjectName falls back to basename(projectDir).
 */
function expectedPinsHome(tmpHome: string, projectDir: string): string {
	return path.join(tmpHome, ".pins", path.basename(projectDir));
}

// ── C6: non-existent location does not crash ────────────────────────────────

describe("C6 — missing location directory", () => {
	let tmpDir: string;
	let tmpHome: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		tmpHome = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	test("exits 0 when --location directory does not exist", async () => {
		const missingLocation = path.join(tmpDir, "pins-not-yet-created");
		// Do NOT create missingLocation on disk.

		const { exitCode, stderr } = await runSetup(
			tmpDir,
			["--location", missingLocation, "--scope", "private"],
			tmpHome,
		);

		expect(stderr).not.toContain("ENOENT");
		expect(exitCode).toBe(0);
	});
});

// ── AC3: fixed-home manifest target, optional --location ────────────────────

describe("AC3.1 — no --location → manifest written to resolvePinsHome()", () => {
	let tmpDir: string;
	let tmpHome: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		tmpHome = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	test("creates pins.yaml at ~/.pins/{name}/pins.yaml when --location is omitted", async () => {
		const { exitCode } = await runSetup(tmpDir, ["--scope", "private"], tmpHome);

		expect(exitCode).toBe(0);
		const pinsHome = expectedPinsHome(tmpHome, tmpDir);
		const manifestPath = path.join(pinsHome, "pins.yaml");
		expect(fs.existsSync(manifestPath)).toBe(true);
	});
});

describe("AC3.2 — no --location → manifest location field defaults to resolvePinsHome()", () => {
	let tmpDir: string;
	let tmpHome: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		tmpHome = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	test("manifest location field equals resolvePinsHome() when --location is omitted", async () => {
		const { exitCode } = await runSetup(tmpDir, ["--scope", "private"], tmpHome);

		expect(exitCode).toBe(0);
		const pinsHome = expectedPinsHome(tmpHome, tmpDir);
		const manifestPath = path.join(pinsHome, "pins.yaml");
		const text = fs.readFileSync(manifestPath, "utf8");
		const parsed = Bun.YAML.parse(text) as { location: string; scope: string };
		expect(parsed.location).toBe(pinsHome);
	});
});

describe("AC3.3 — --location /custom → file at pins home, location field = custom", () => {
	let tmpDir: string;
	let tmpHome: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		tmpHome = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	test("manifest file is at pins home and location field reflects custom path", async () => {
		const customLocation = path.join(tmpDir, "custom-data");

		const { exitCode } = await runSetup(
			tmpDir,
			["--location", customLocation, "--scope", "shared"],
			tmpHome,
		);

		expect(exitCode).toBe(0);
		const pinsHome = expectedPinsHome(tmpHome, tmpDir);
		const manifestPath = path.join(pinsHome, "pins.yaml");
		expect(fs.existsSync(manifestPath)).toBe(true);

		const text = fs.readFileSync(manifestPath, "utf8");
		const parsed = Bun.YAML.parse(text) as { location: string; scope: string };
		expect(parsed.location).toBe(customLocation);
	});
});

describe("AC3.4 — creates ~/.pins/{name}/ recursively if absent", () => {
	let tmpDir: string;
	let tmpHome: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		tmpHome = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	test("creates pins home directory when it does not yet exist", async () => {
		// tmpHome is a fresh dir with no .pins subdirectory.
		const pinsHome = expectedPinsHome(tmpHome, tmpDir);
		expect(fs.existsSync(pinsHome)).toBe(false);

		const { exitCode } = await runSetup(tmpDir, ["--scope", "private"], tmpHome);

		expect(exitCode).toBe(0);
		expect(fs.existsSync(pinsHome)).toBe(true);
	});
});

// ── C8: special characters in location survive yaml round-trip ──────────────

describe("C8 — special characters in location", () => {
	let tmpDir: string;
	let tmpHome: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		tmpHome = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	test("location with # is preserved after yaml round-trip", async () => {
		// Path containing a hash — would be mis-parsed as a comment by naive interpolation.
		const hashLocation = path.join(tmpDir, "pins #1");

		const { exitCode } = await runSetup(
			tmpDir,
			["--location", hashLocation, "--scope", "private"],
			tmpHome,
		);

		expect(exitCode).toBe(0);
		const pinsHome = expectedPinsHome(tmpHome, tmpDir);
		const manifestPath = path.join(pinsHome, "pins.yaml");
		const text = fs.readFileSync(manifestPath, "utf8");
		const parsed = Bun.YAML.parse(text) as { location: string; scope: string };
		expect(parsed.location).toBe(hashLocation);
	});

	test("location with leading/trailing spaces is preserved after yaml round-trip", async () => {
		// Use a symlink-style indirect test: the path itself contains a space (common).
		const spaceLocation = path.join(tmpDir, "my pins");

		const { exitCode } = await runSetup(
			tmpDir,
			["--location", spaceLocation, "--scope", "private"],
			tmpHome,
		);

		expect(exitCode).toBe(0);
		const pinsHome = expectedPinsHome(tmpHome, tmpDir);
		const manifestPath = path.join(pinsHome, "pins.yaml");
		const text = fs.readFileSync(manifestPath, "utf8");
		const parsed = Bun.YAML.parse(text) as { location: string; scope: string };
		expect(parsed.location).toBe(spaceLocation);
	});
});

// ── Round-trip: write→Bun.YAML.parse deep-equal ─────────────────────────────

describe("manifest round-trip — Bun.YAML.parse", () => {
	let tmpDir: string;
	let tmpHome: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		tmpHome = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	test("Bun.YAML.parse round-trips full manifest object written by setup", async () => {
		const customLocation = path.join(tmpDir, "custom-pins");
		const { exitCode } = await runSetup(
			tmpDir,
			["--location", customLocation, "--scope", "shared", "--git", "true"],
			tmpHome,
		);

		expect(exitCode).toBe(0);
		const pinsHome = expectedPinsHome(tmpHome, tmpDir);
		const manifestPath = path.join(pinsHome, "pins.yaml");
		const text = fs.readFileSync(manifestPath, "utf8");

		// Strip the comment header line before parsing.
		const body = text.replace(/^#[^\n]*\n/, "");
		const parsed = Bun.YAML.parse(body) as { location: string; scope: string; git: boolean };

		expect(parsed).toEqual({ location: customLocation, scope: "shared", git: true });
	});
});

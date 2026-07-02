import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { resolveManifest } from "./manifest.ts";

let dirsToClean: string[] = [];

function makeTmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pins-manifest-test-"));
	dirsToClean.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirsToClean) {
		rmSync(dir, { recursive: true, force: true });
	}
	dirsToClean = [];
});

describe("precedence", () => {
	test("returns project-root pins.yaml when both project-root and user-root have one", async () => {
		const projectRoot = makeTmpDir();
		const userRoot = makeTmpDir();

		writeFileSync(join(projectRoot, "pins.yaml"), "location: project-pins\nscope: project-scope\n");
		writeFileSync(join(userRoot, "pins.yaml"), "location: user-pins\nscope: user-scope\n");

		const result = await resolveManifest({ projectRoot, userRoot });

		expect(result.kind).toBe("resolved");
		if (result.kind !== "resolved") return;
		expect(result.manifest.location).toBe("project-pins");
		expect(result.manifest.scope).toBe("project-scope");
	});

	test("falls back to user-root pins.yaml when only user-root has one", async () => {
		const projectRoot = makeTmpDir();
		const userRoot = makeTmpDir();
		const pinsHome = makeTmpDir(); // empty — must not shadow userRoot

		writeFileSync(join(userRoot, "pins.yaml"), "location: user-pins\nscope: user-scope\n");

		const result = await resolveManifest({ projectRoot, userRoot, pinsHome });

		expect(result.kind).toBe("resolved");
		if (result.kind !== "resolved") return;
		expect(result.manifest.location).toBe("user-pins");
		expect(result.manifest.scope).toBe("user-scope");
	});
});

describe("git field", () => {
	test("git: true in yaml → manifest.git === true", async () => {
		const projectRoot = makeTmpDir();
		const userRoot = makeTmpDir();

		writeFileSync(
			join(projectRoot, "pins.yaml"),
			"location: some-pins\nscope: some-scope\ngit: true\n",
		);

		const result = await resolveManifest({ projectRoot, userRoot });

		expect(result.kind).toBe("resolved");
		if (result.kind !== "resolved") return;
		expect(result.manifest.git).toBe(true);
	});

	test("no git field in yaml → manifest.git === false", async () => {
		const projectRoot = makeTmpDir();
		const userRoot = makeTmpDir();

		writeFileSync(join(projectRoot, "pins.yaml"), "location: some-pins\nscope: some-scope\n");

		const result = await resolveManifest({ projectRoot, userRoot });

		expect(result.kind).toBe("resolved");
		if (result.kind !== "resolved") return;
		expect(result.manifest.git).toBe(false);
	});

	test('non-boolean git in yaml (e.g. "yes") → manifest.git === false', async () => {
		const projectRoot = makeTmpDir();
		const userRoot = makeTmpDir();

		writeFileSync(
			join(projectRoot, "pins.yaml"),
			'location: some-pins\nscope: some-scope\ngit: "yes"\n',
		);

		const result = await resolveManifest({ projectRoot, userRoot });

		expect(result.kind).toBe("resolved");
		if (result.kind !== "resolved") return;
		expect(result.manifest.git).toBe(false);
	});
});

describe("read failure propagation", () => {
	test("pins.yaml exists as a directory (EISDIR) → throws instead of returning absent", async () => {
		const projectRoot = makeTmpDir();
		const userRoot = makeTmpDir();

		// Place a directory at the pins.yaml path to trigger EISDIR on readFile
		const { mkdirSync } = await import("fs");
		mkdirSync(join(projectRoot, "pins.yaml"));

		await expect(resolveManifest({ projectRoot, userRoot })).rejects.toThrow();
	});
});

describe("absent signal", () => {
	test("returns absent when neither project-root nor user-root has a pins.yaml", async () => {
		const projectRoot = makeTmpDir();
		const userRoot = makeTmpDir();
		const pinsHome = makeTmpDir(); // empty — must not resolve

		const result = await resolveManifest({ projectRoot, userRoot, pinsHome });

		expect(result.kind).toBe("absent");
	});

	test("does not throw when neither manifest exists", async () => {
		const projectRoot = makeTmpDir();
		const userRoot = makeTmpDir();
		const pinsHome = makeTmpDir(); // empty

		const call = () => resolveManifest({ projectRoot, userRoot, pinsHome });

		await expect(call()).resolves.toBeDefined();
	});

	test("does not create any file when absent", async () => {
		const projectRoot = makeTmpDir();
		const userRoot = makeTmpDir();
		const pinsHome = makeTmpDir(); // empty

		await resolveManifest({ projectRoot, userRoot, pinsHome });

		const { readdirSync } = await import("fs");
		expect(readdirSync(projectRoot)).toHaveLength(0);
		expect(readdirSync(userRoot)).toHaveLength(0);
	});

	test("absent resolution creates no dir", async () => {
		// Simulate OMT_DIR unset: use a tmp dir as cwd base so the derived
		// ~/.omt/<project> path is known and verifiably absent.
		const savedOmtDir = process.env.OMT_DIR;
		const savedHome = process.env.HOME;
		const savedCwd = process.cwd();

		const tmpCwd = makeTmpDir();

		let derivedDir: string;
		try {
			delete process.env.OMT_DIR;
			// Sandbox HOME so derivations never touch the real ~/.pins or ~/.omt
			process.env.HOME = makeTmpDir();
			// Derive what resolveOmtDir() would compute for this cwd (non-git dir):
			// basename(tmpCwd) → ~/.omt/<basename>
			// Must be computed AFTER HOME is set so homedir() reflects the sandbox.
			derivedDir = join(homedir(), ".omt", tmpCwd.split("/").pop()!);
			process.chdir(tmpCwd);

			// Pre-condition: derived dir must not exist before the call
			const existedBefore = existsSync(derivedDir);

			const result = await resolveManifest();

			expect(result.kind).toBe("absent");
			// If the dir didn't exist before, it must still not exist after
			if (!existedBefore) {
				expect(existsSync(derivedDir)).toBe(false);
			}
		} finally {
			process.chdir(savedCwd);
			if (savedOmtDir !== undefined) {
				process.env.OMT_DIR = savedOmtDir;
			} else {
				delete process.env.OMT_DIR;
			}
			if (savedHome !== undefined) {
				process.env.HOME = savedHome;
			} else {
				delete process.env.HOME;
			}
			// Clean up derivedDir if it was unexpectedly created
			if (!existsSync(derivedDir!) === false) {
				rmSync(derivedDir!, { recursive: true, force: true });
			}
		}
	});
});

describe("pinsHome tier", () => {
	test("AC2.1: resolves pinsHome/pins.yaml when no projectRoot manifest exists", async () => {
		const projectRoot = makeTmpDir();
		const pinsHome = makeTmpDir();
		const userRoot = makeTmpDir();

		writeFileSync(
			join(pinsHome, "pins.yaml"),
			"location: pins-home-location\nscope: pins-home-scope\n",
		);

		const result = await resolveManifest({ projectRoot, pinsHome, userRoot });

		expect(result.kind).toBe("resolved");
		if (result.kind !== "resolved") return;
		expect(result.manifest.location).toBe("pins-home-location");
		expect(result.manifest.scope).toBe("pins-home-scope");
	});

	test("AC2.2: projectRoot/pins.yaml wins over pinsHome/pins.yaml when both exist", async () => {
		const projectRoot = makeTmpDir();
		const pinsHome = makeTmpDir();
		const userRoot = makeTmpDir();

		writeFileSync(
			join(projectRoot, "pins.yaml"),
			"location: project-location\nscope: project-scope\n",
		);
		writeFileSync(
			join(pinsHome, "pins.yaml"),
			"location: pins-home-location\nscope: pins-home-scope\n",
		);

		const result = await resolveManifest({ projectRoot, pinsHome, userRoot });

		expect(result.kind).toBe("resolved");
		if (result.kind !== "resolved") return;
		expect(result.manifest.location).toBe("project-location");
		expect(result.manifest.scope).toBe("project-scope");
	});

	test("QA: pinsHome wins over userRoot when both exist and projectRoot is absent", async () => {
		const projectRoot = makeTmpDir();
		const pinsHome = makeTmpDir();
		const userRoot = makeTmpDir();

		// Only pinsHome and userRoot have manifests — no projectRoot manifest
		writeFileSync(
			join(pinsHome, "pins.yaml"),
			"location: pins-home-location\nscope: pins-home-scope\n",
		);
		writeFileSync(
			join(userRoot, "pins.yaml"),
			"location: user-root-location\nscope: user-root-scope\n",
		);

		const result = await resolveManifest({ projectRoot, pinsHome, userRoot });

		// pinsHome must be returned — a stale userRoot manifest cannot shadow it
		expect(result.kind).toBe("resolved");
		if (result.kind !== "resolved") return;
		expect(result.manifest.location).toBe("pins-home-location");
		expect(result.manifest.scope).toBe("pins-home-scope");
	});
});

describe("corruption: multi-document project manifest surfaces error", () => {
	test("multi-doc pins.yaml (--- separator) in projectRoot throws instead of silently falling back to another manifest", async () => {
		const projectRoot = makeTmpDir();
		const userRoot = makeTmpDir();

		// Multi-document YAML — Bun.YAML.parse returns an array; parseYamlStrict must throw.
		writeFileSync(
			join(projectRoot, "pins.yaml"),
			"location: project-pins\nscope: project-scope\n---\nlocation: second-doc\nscope: second-scope\n",
		);
		// User-root has a valid manifest — must NOT be silently selected on corruption.
		writeFileSync(join(userRoot, "pins.yaml"), "location: user-pins\nscope: user-scope\n");

		// The corrupt project manifest must surface an error, not silently fall through.
		await expect(resolveManifest({ projectRoot, userRoot })).rejects.toThrow();
	});
});

describe("project root resolution", () => {
	test("resolveManifest() finds the git-root pins.yaml when cwd is a subdirectory", async () => {
		const savedCwd = process.cwd();
		const savedOmtDir = process.env.OMT_DIR;
		const repo = makeTmpDir();

		try {
			execSync("git init -q", { cwd: repo });
			writeFileSync(join(repo, "pins.yaml"), "location: repo-pins\nscope: shared\n");
			const sub = join(repo, "src", "deep");
			mkdirSync(sub, { recursive: true });

			// Point the user-root fallback at a guaranteed-absent dir so success
			// can only come from resolving the project (git) root.
			process.env.OMT_DIR = join(repo, "no-user-dir");
			process.chdir(sub);

			const result = await resolveManifest();

			expect(result.kind).toBe("resolved");
			if (result.kind !== "resolved") return;
			expect(result.manifest.location).toBe("repo-pins");
		} finally {
			process.chdir(savedCwd);
			if (savedOmtDir !== undefined) process.env.OMT_DIR = savedOmtDir;
			else delete process.env.OMT_DIR;
		}
	});
});

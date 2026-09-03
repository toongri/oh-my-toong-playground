import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProvision } from "./provision.ts";
import type { ProvisionItem } from "./types.ts";

const ROOT_SYNC_YAML_PATH = path.join(import.meta.dir, "..", "..", "sync.yaml");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mktemp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "provision-test-"));
}

// Resolve the marker path <dir>/<name> (does not create the file)
function markerPath(dir: string, name: string): string {
	return path.join(dir, name);
}

function markerExists(dir: string, name: string): boolean {
	return fs.existsSync(markerPath(dir, name));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runProvision", () => {
	const tmpdirs: string[] = [];

	afterEach(() => {
		for (const d of tmpdirs.splice(0)) {
			try {
				fs.rmSync(d, { recursive: true, force: true });
			} catch {
				// best-effort
			}
		}
	});

	it("(a) check exits 0 — commands NOT run", () => {
		const dir = mktemp();
		tmpdirs.push(dir);

		// check: true (always exits 0) → commands should NOT run
		const item: ProvisionItem = {
			check: "true",
			commands: [`touch ${markerPath(dir, "ran.txt")}`],
		};

		runProvision([item], [dir], { dryRun: false });

		expect(markerExists(dir, "ran.txt")).toBe(false);
	});

	it("(b) check exits non-zero — commands run", () => {
		const dir = mktemp();
		tmpdirs.push(dir);

		// check: false (always exits 1) → commands SHOULD run
		const item: ProvisionItem = {
			check: "false",
			commands: [`touch ${markerPath(dir, "ran.txt")}`],
		};

		runProvision([item], [dir], { dryRun: false });

		expect(markerExists(dir, "ran.txt")).toBe(true);
	});

	it("(c) no check — commands run", () => {
		const dir = mktemp();
		tmpdirs.push(dir);

		const item: ProvisionItem = {
			commands: [`touch ${markerPath(dir, "ran.txt")}`],
		};

		runProvision([item], [dir], { dryRun: false });

		expect(markerExists(dir, "ran.txt")).toBe(true);
	});

	it("(d) dryRun — nothing executed (only logs)", () => {
		const dir = mktemp();
		tmpdirs.push(dir);

		const item: ProvisionItem = {
			commands: [`touch ${markerPath(dir, "ran.txt")}`],
		};

		runProvision([item], [dir], { dryRun: true });

		// File must NOT have been created
		expect(markerExists(dir, "ran.txt")).toBe(false);
	});

	it("(e) non-existent target dir — skipped", () => {
		const nonExistent = path.join(
			os.tmpdir(),
			"provision-noexist-" + Math.random().toString(36).slice(2),
		);

		// Should not throw; simply skip
		expect(() =>
			runProvision([{ commands: ["true"] }], [nonExistent], { dryRun: false }),
		).not.toThrow();
	});

	it("(f) multiple items run in order", () => {
		const dir = mktemp();
		tmpdirs.push(dir);

		// Item 0: write "0" to order.txt
		// Item 1: append "1" to order.txt
		// If order is wrong, content would be "10" instead of "01"
		const items: ProvisionItem[] = [
			{ commands: [`printf '0' > ${markerPath(dir, "order.txt")}`] },
			{ commands: [`printf '1' >> ${markerPath(dir, "order.txt")}`] },
		];

		runProvision(items, [dir], { dryRun: false });

		const content = fs.readFileSync(markerPath(dir, "order.txt"), "utf8");
		expect(content).toBe("01");
	});
});

// ---------------------------------------------------------------------------
// Root sync.yaml provision readiness checks
//
// These tests read the actual root sync.yaml (not a hardcoded copy of its
// check string) so a future edit to sync.yaml's provision block is caught
// here instead of silently drifting from what's actually deployed.
// ---------------------------------------------------------------------------

/** Loads the `provision` array straight from the tracked root sync.yaml. */
function loadRootProvisionItems(): ProvisionItem[] {
	const parsed = Bun.YAML.parse(fs.readFileSync(ROOT_SYNC_YAML_PATH, "utf8")) as {
		provision?: ProvisionItem[];
	};
	return parsed.provision ?? [];
}

/** Finds the `check` of the provision item whose `commands` mention `commandSubstring`. */
function findCheckByCommandSubstring(items: ProvisionItem[], commandSubstring: string): string {
	const item = items.find((i) => i.commands.some((c) => c.includes(commandSubstring)));
	if (!item?.check) {
		throw new Error(`no provision item with a check found for command substring: ${commandSubstring}`);
	}
	return item.check;
}

function writeStub(dir: string, name: string, script: string): void {
	const p = path.join(dir, name);
	fs.writeFileSync(p, script);
	fs.chmodSync(p, 0o755);
}

// The check strings shell out to bash/grep/sort/head (printf is a bash builtin,
// no binary needed). PATH is built stub-dir-first so a stubbed agent-device/,
// agent-browser, or mmdc always shadows any real install on this machine, with
// /bin and /usr/bin appended only so bash itself and those coreutils can still
// resolve.
function stubPath(stubDir: string): string {
	return `${stubDir}:/bin:/usr/bin`;
}

function runCheck(check: string, stubDir: string): number {
	const proc = Bun.spawnSync(["bash", "-c", check], { env: { PATH: stubPath(stubDir) } });
	return proc.exitCode ?? 1;
}

describe("sync.yaml provision: agent-device 버전 readiness 체크", () => {
	const tmpdirs: string[] = [];

	afterEach(() => {
		for (const d of tmpdirs.splice(0)) {
			try {
				fs.rmSync(d, { recursive: true, force: true });
			} catch {
				// best-effort
			}
		}
	});

	function newStubDir(): string {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "provision-check-test-"));
		tmpdirs.push(d);
		return d;
	}

	it("0.19.9 설치본 — exit != 0 (프로비저닝 필요)", () => {
		const check = findCheckByCommandSubstring(loadRootProvisionItems(), "agent-device");
		const dir = newStubDir();
		writeStub(dir, "agent-device", "#!/bin/sh\necho '0.19.9'\n");

		expect(runCheck(check, dir)).not.toBe(0);
	});

	it("0.20.0 설치본 — 경계값, exit 0 (통과)", () => {
		const check = findCheckByCommandSubstring(loadRootProvisionItems(), "agent-device");
		const dir = newStubDir();
		writeStub(dir, "agent-device", "#!/bin/sh\necho '0.20.0'\n");

		expect(runCheck(check, dir)).toBe(0);
	});

	it("0.20.2 설치본 — exit 0 (통과)", () => {
		const check = findCheckByCommandSubstring(loadRootProvisionItems(), "agent-device");
		const dir = newStubDir();
		writeStub(dir, "agent-device", "#!/bin/sh\necho '0.20.2'\n");

		expect(runCheck(check, dir)).toBe(0);
	});

	it("agent-device가 PATH에 없음 — exit != 0", () => {
		const check = findCheckByCommandSubstring(loadRootProvisionItems(), "agent-device");
		const dir = newStubDir(); // empty — no `agent-device` stub written

		expect(runCheck(check, dir)).not.toBe(0);
	});
});

describe("sync.yaml provision: agent-browser Chrome readiness 체크 (doctor)", () => {
	const tmpdirs: string[] = [];

	afterEach(() => {
		for (const d of tmpdirs.splice(0)) {
			try {
				fs.rmSync(d, { recursive: true, force: true });
			} catch {
				// best-effort
			}
		}
	});

	function newStubDir(): string {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "provision-check-test-"));
		tmpdirs.push(d);
		return d;
	}

	it("`doctor`가 `pass  Google Chrome` 줄을 출력 — exit 0", () => {
		const check = findCheckByCommandSubstring(loadRootProvisionItems(), "agent-browser install");
		const dir = newStubDir();
		writeStub(
			dir,
			"agent-browser",
			'#!/bin/sh\necho "  pass  Google Chrome for Testing 151.0.7922.34 at /path"\n',
		);

		expect(runCheck(check, dir)).toBe(0);
	});

	it("`doctor`가 그 줄을 출력하지 않음 — exit != 0", () => {
		const check = findCheckByCommandSubstring(loadRootProvisionItems(), "agent-browser install");
		const dir = newStubDir();
		writeStub(dir, "agent-browser", '#!/bin/sh\necho "  fail  Google Chrome not found"\n');

		expect(runCheck(check, dir)).not.toBe(0);
	});
});

describe("sync.yaml provision: mmdc readiness 체크", () => {
	const tmpdirs: string[] = [];

	afterEach(() => {
		for (const d of tmpdirs.splice(0)) {
			try {
				fs.rmSync(d, { recursive: true, force: true });
			} catch {
				// best-effort
			}
		}
	});

	function newStubDir(): string {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "provision-check-test-"));
		tmpdirs.push(d);
		return d;
	}

	it("mmdc가 PATH에 없음 — exit != 0 (프로비저닝 필요)", () => {
		const check = findCheckByCommandSubstring(
			loadRootProvisionItems(),
			"@mermaid-js/mermaid-cli",
		);
		const dir = newStubDir();

		expect(runCheck(check, dir)).not.toBe(0);
	});

	it("mmdc가 PATH에 있음 — exit 0 (통과)", () => {
		const check = findCheckByCommandSubstring(
			loadRootProvisionItems(),
			"@mermaid-js/mermaid-cli",
		);
		const dir = newStubDir();
		writeStub(dir, "mmdc", "#!/bin/sh\nexit 0\n");

		expect(runCheck(check, dir)).toBe(0);
	});
});

describe("sync.yaml provision: mmdc Chrome headless shell smoke 체크", () => {
	const tmpdirs: string[] = [];

	afterEach(() => {
		for (const d of tmpdirs.splice(0)) {
			try {
				fs.rmSync(d, { recursive: true, force: true });
			} catch {
				// best-effort
			}
		}
	});

	function newStubDir(): string {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "provision-check-test-"));
		tmpdirs.push(d);
		return d;
	}

	function smokeCheck(): string {
		const item = loadRootProvisionItems().find((candidate) =>
			candidate.check?.includes("mmdc -i"),
		);
		if (!item?.check) {
			throw new Error("no mmdc smoke provision check found");
		}
		return item.check;
	}

	it("mmdc가 렌더에 실패 — exit != 0 (브라우저 프로비저닝 필요)", () => {
		const dir = newStubDir();
		writeStub(dir, "mmdc", "#!/bin/sh\nexit 1\n");

		expect(runCheck(smokeCheck(), dir)).not.toBe(0);
	});

	it("mmdc가 작은 SVG를 렌더 — exit 0 (headless shell 준비 완료)", () => {
		const dir = newStubDir();
		writeStub(
			dir,
			"mmdc",
			'#!/bin/sh\noutput=""\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in\n    -o) output="$2"; shift 2 ;;\n    *) shift ;;\n  esac\ndone\n[ -n "$output" ] || exit 1\nprintf "%s\\n" "<svg xmlns=\\"http://www.w3.org/2000/svg\\"></svg>" >"$output"\n',
		);

		expect(runCheck(smokeCheck(), dir)).toBe(0);
	});
});

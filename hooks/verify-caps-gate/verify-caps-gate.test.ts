import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decide, loadConfig, processHookInput, type VerifyCapsConfig } from "./index.ts";

// -----------------------------------------------------------------------------
// Fixture config mirroring verify-caps.yaml's shipped schema (vitest=env,
// jest=flag, turbo=env+flag+inject_scripts+deny, pnpm=env+inject_scripts+deny).
// pnpm/turbo carry an inject_scripts allowlist (general-purpose runners inject
// only on verification scripts); vitest/jest omit it (dedicated runners inject
// unconditionally). decide() is pure and takes this fixture directly — no file
// I/O needed for the core truth table.
// -----------------------------------------------------------------------------
const FIXTURE: VerifyCapsConfig = {
	runners: {
		vitest: {
			env: { VITEST_MAX_FORKS: "2", VITEST_MAX_THREADS: "2" },
		},
		jest: {
			flag: "--maxWorkers=2",
		},
		turbo: {
			env: { VITEST_MAX_FORKS: "2", VITEST_MAX_THREADS: "2" },
			flag: "--concurrency=1",
			flag_requires_scope: true,
			inject_scripts: ["test", "lint", "build", "typecheck"],
			deny: { scripts: ["test", "lint"], scope_flags: ["--filter", "-F", "--affected"] },
		},
		pnpm: {
			env: { VITEST_MAX_FORKS: "2", VITEST_MAX_THREADS: "2" },
			inject_scripts: ["test", "lint", "verify"],
			deny: { scripts: ["test", "lint"], scope_flags: ["--filter", "-F", "--affected"] },
		},
	},
};

describe("decide — deny (unfiltered root test/lint)", () => {
	test("`pnpm test` denies", () => {
		const result = decide("pnpm test", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("`turbo test` denies", () => {
		const result = decide("turbo test", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("`turbo run lint` denies", () => {
		const result = decide("turbo run lint", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("`cd apps/backend && pnpm test` denies (segment split catches non-first segment)", () => {
		const result = decide("cd apps/backend && pnpm test", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("`CI=1 turbo test` denies (leading env-var prefix doesn't defeat the guard)", () => {
		const result = decide("CI=1 turbo test", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("defect2: `pnpm test && pnpm --filter=web build` denies (seg2's --filter doesn't rescue seg1's unfiltered test)", () => {
		const result = decide("pnpm test && pnpm --filter=web build", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("defect7: `pnpm dev & pnpm test` denies (bare `&` splits into segments, seg2's unfiltered test is caught)", () => {
		const result = decide("pnpm dev & pnpm test", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("defect7: `pnpm dev & pnpm test --filter=web` is not denied (seg2 has a scope flag)", () => {
		const result = decide("pnpm dev & pnpm test --filter=web", FIXTURE);
		expect(result.action).not.toBe("deny");
	});

	test("defect7: `cd apps/backend && pnpm test` still denies (bare-`&` fix doesn't regress `&&` splitting)", () => {
		const result = decide("cd apps/backend && pnpm test", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("deny reason names a scope flag so the caller knows how to unblock", () => {
		const result = decide("pnpm test", FIXTURE);
		expect(result.action).toBe("deny");
		if (result.action === "deny") {
			expect(result.reason.length).toBeGreaterThan(0);
			expect(result.reason).toContain("--filter");
		}
	});

	test("denyBypass: `turbo run test -- --affected` denies (a scope flag after `--` is a positional task arg, not turbo's own flag, so turbo actually runs unfiltered)", () => {
		const result = decide("turbo run test -- --affected", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("denyBypass: `pnpm test -- --filter=web` denies (same end-of-options bypass via pnpm)", () => {
		const result = decide("pnpm test -- --filter=web", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("denyBypass regression: `turbo run test --affected` (no `--`) is still not denied", () => {
		const result = decide("turbo run test --affected", FIXTURE);
		expect(result.action).not.toBe("deny");
	});

	test("denyBypass regression: `pnpm test --filter=web` (no `--`) is still not denied", () => {
		const result = decide("pnpm test --filter=web", FIXTURE);
		expect(result.action).not.toBe("deny");
	});

	test("recursive: `pnpm -r test` denies (`-r` runs the script in every workspace package — a whole-monorepo run, and `-r` is not a scope flag)", () => {
		const result = decide("pnpm -r test", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("recursive: `pnpm --recursive lint` denies (long-form whole-workspace run)", () => {
		const result = decide("pnpm --recursive lint", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("recursive: `pnpm -r run test` denies (`-r` sits before the `run` keyword)", () => {
		const result = decide("pnpm -r run test", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("recursive regression: `pnpm -r test --filter=web` is not denied (a real scope flag still rescues even alongside -r)", () => {
		const result = decide("pnpm -r test --filter=web", FIXTURE);
		expect(result.action).not.toBe("deny");
	});
});

describe("decide — allow (not a deny match)", () => {
	test.each([
		["pnpm test --filter=@algocare/backend"],
		["turbo run test --affected"],
		["pnpm verify:quick"],
		["pnpm test:changed"],
		["pnpm build"],
	])("%s is not denied", (command) => {
		const result = decide(command, FIXTURE);
		expect(result.action).not.toBe("deny");
	});
});

describe("decide — env prepend (vitest/turbo/pnpm inherit caps)", () => {
	test("vitest gets VITEST_MAX_FORKS + VITEST_MAX_THREADS prepended", () => {
		const result = decide("vitest run --changed origin/main", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).toBe(
				"VITEST_MAX_FORKS=2 VITEST_MAX_THREADS=2 vitest run --changed origin/main",
			);
		}
	});

	test("`pnpm verify:quick` gets env prepended (pnpm may spawn vitest as a child)", () => {
		const result = decide("pnpm verify:quick", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).toBe("VITEST_MAX_FORKS=2 VITEST_MAX_THREADS=2 pnpm verify:quick");
		}
	});

	test("`turbo run test:changed --affected` gets env prepended AND flag appended (turbo has both caps)", () => {
		const result = decide("turbo run test:changed --affected", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).toBe(
				"VITEST_MAX_FORKS=2 VITEST_MAX_THREADS=2 turbo run test:changed --affected --concurrency=1",
			);
		}
	});

	test("a VAR already present in the command is not duplicated", () => {
		const result = decide("VITEST_MAX_FORKS=4 vitest run", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			// VITEST_MAX_FORKS already present -> skipped; VITEST_MAX_THREADS still prepended
			expect(result.command).toBe("VITEST_MAX_THREADS=2 VITEST_MAX_FORKS=4 vitest run");
		}
	});
});

describe("decide — flag append (jest/turbo)", () => {
	test("jest gets --maxWorkers=2 appended", () => {
		const result = decide("jest --changedSince=origin/main", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command.endsWith("--maxWorkers=2")).toBe(true);
			expect(result.command).not.toContain("VITEST_MAX_FORKS");
		}
	});

	test("turbo gets --concurrency=1 appended (alongside its own env prepend)", () => {
		const result = decide("turbo run test --affected", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).toContain("--concurrency=1");
			expect(result.command).toContain("VITEST_MAX_FORKS=2");
		}
	});

	test("an existing --concurrency is not duplicated (env prepend still applies)", () => {
		const result = decide("turbo run test --affected --concurrency=1", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			const occurrences = result.command.match(/--concurrency=1/g) ?? [];
			expect(occurrences.length).toBe(1);
			expect(result.command).toContain("VITEST_MAX_FORKS=2");
		}
	});
});

describe("decide — defect1: turbo --concurrency requires a scope flag", () => {
	test("`turbo run build` has no scope flag: --concurrency is not appended (env prepend still applies)", () => {
		const result = decide("turbo run build", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).not.toContain("--concurrency");
			expect(result.command).toContain("VITEST_MAX_FORKS=2");
		}
	});

	test("`turbo run local` (persistent task, not a verification script) is passthrough — untouched, so no --concurrency can land on it", () => {
		// `local` is not in turbo's inject_scripts, so it never reaches flag
		// injection at all — a stronger guarantee than the old env-inject+scope
		// gate. The flag_requires_scope gate for a real verification task with no
		// scope flag is still covered by the `turbo run build` test above.
		const result = decide("turbo run local", FIXTURE);
		expect(result.action).toBe("passthrough");
	});

	test("`turbo run test --affected` (has scope flag) still gets --concurrency appended", () => {
		const result = decide("turbo run test --affected", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).toContain("--concurrency=1");
		}
	});
});

describe("decide — `--` and compound guards (`--` keeps env; compound skips injection entirely)", () => {
	test("`vitest run -- --coverage` still gets env prepended", () => {
		const result = decide("vitest run -- --coverage", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).toBe("VITEST_MAX_FORKS=2 VITEST_MAX_THREADS=2 vitest run -- --coverage");
		}
	});

	test("`turbo run build -- --coverage --affected` gets env prepended but NOT --concurrency appended", () => {
		// Uses "build" (not "test"/"lint") so this only exercises the flag-skip
		// guard, not the deny path: "test"/"lint" here would also match turbo's
		// deny.scripts, and the trailing `--affected` sits after the `--`
		// end-of-options marker — same shape as the denyBypass fix above — so
		// it would now correctly deny rather than reach flag injection.
		const result = decide("turbo run build -- --coverage --affected", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).toBe(
				"VITEST_MAX_FORKS=2 VITEST_MAX_THREADS=2 turbo run build -- --coverage --affected",
			);
			expect(result.command).not.toContain("--concurrency");
		}
	});

	// A compound command must never be injected+allowed: allow covers the whole
	// command, so a verification first segment would auto-approve every later
	// segment past the Bash prompt.
	test("`pnpm test:changed && pnpm publish` is passthrough (compound must not auto-approve the trailing segment)", () => {
		const result = decide("pnpm test:changed && pnpm publish", FIXTURE);
		expect(result.action).toBe("passthrough");
	});

	test("`pnpm test --filter=web && pnpm publish` is passthrough (a scope-flagged verification segment still can't smuggle an auto-approval)", () => {
		const result = decide("pnpm test --filter=web && pnpm publish", FIXTURE);
		expect(result.action).toBe("passthrough");
	});

	test("`vitest run && rm -rf tmp` is passthrough (dedicated runner too — no cap+allow on a compound)", () => {
		const result = decide("vitest run && rm -rf tmp", FIXTURE);
		expect(result.action).toBe("passthrough");
	});

	test("`cd x && jest` is untouched (jest isn't the command's first token)", () => {
		const result = decide("cd x && jest", FIXTURE);
		expect(result.action).toBe("passthrough");
	});

	test("defect5: `jest &` (bare background `&`) does not get --maxWorkers appended", () => {
		const result = decide("jest &", FIXTURE);
		expect(result.action).toBe("passthrough");
	});
});

describe("decide — general-purpose runners inject only on verification scripts", () => {
	// pnpm/turbo are general-purpose: injecting env forces permissionDecision
	// "allow" (auto-approve), so a non-verification command must NOT be injected
	// — otherwise the hook silently bypasses the Bash permission prompt for
	// pnpm publish / pnpm dlx / turbo gen etc. (permission broadening). This
	// includes a verification-prefix word sitting in an ARGUMENT position
	// (`pnpm add test`, `pnpm dlx playwright test`): it is not a script run, so
	// only a prefix in script position (first bareword after the runner) injects.
	test.each([
		["pnpm publish"],
		["pnpm dlx cowsay hi"],
		["pnpm add lodash"],
		["pnpm add test"],
		["pnpm dlx playwright test"],
		["pnpm install"],
		["turbo gen component"],
		["turbo login"],
	])("%s is passthrough (no env-inject, permission prompt preserved)", (command) => {
		const result = decide(command, FIXTURE);
		expect(result.action).toBe("passthrough");
	});

	// Verification invocations still inject — including the flags-before-script
	// form (`pnpm --filter x test:changed`), where the `--filter x` value is
	// skipped as a leading token so the script after it stays recognized.
	test("`pnpm test --filter=web` still injects env (verification preserved)", () => {
		const result = decide("pnpm test --filter=web", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).toContain("VITEST_MAX_FORKS=2");
		}
	});

	test("`pnpm --filter @algocare/backend test:changed` injects env (script after flags)", () => {
		const result = decide("pnpm --filter @algocare/backend test:changed", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).toContain("VITEST_MAX_FORKS=2");
		}
	});

	test("`pnpm verify:full` injects env (verify: prefix matches a sub-scripted name)", () => {
		const result = decide("pnpm verify:full", FIXTURE);
		expect(result.action).toBe("allow");
	});

	test("`turbo run build --affected` still injects (build is a turbo verification task)", () => {
		const result = decide("turbo run build --affected", FIXTURE);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).toContain("VITEST_MAX_FORKS=2");
		}
	});

	// A word merely CONTAINING a prefix mid-token must not match: `test-utils`
	// as a package name in `pnpm add test-utils` is not a verification script.
	test("`pnpm add test-utils` is passthrough (prefix must sit at a word boundary)", () => {
		const result = decide("pnpm add test-utils", FIXTURE);
		expect(result.action).toBe("passthrough");
	});

	// Dedicated test runners (vitest/jest) declare no inject_scripts allowlist:
	// they have no dangerous non-test subcommands, so they inject unconditionally.
	test("`vitest --version` still injects (vitest is a dedicated runner, no allowlist)", () => {
		const result = decide("vitest --version", FIXTURE);
		expect(result.action).toBe("allow");
	});

	test("`jest --clearCache` still injects (jest is a dedicated runner, no allowlist)", () => {
		const result = decide("jest --clearCache", FIXTURE);
		expect(result.action).toBe("allow");
	});
});

describe("decide — segment split / env-prefix strip / first-token unit behavior", () => {
	test("3-way split on && and | still finds a deny in the last segment", () => {
		const result = decide("echo one && echo two | pnpm test", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test("multiple leading env-var prefixes are stripped before matching (A=1 B=2 turbo test)", () => {
		const result = decide("A=1 B=2 turbo test", FIXTURE);
		expect(result.action).toBe("deny");
	});

	test('defect4: `echo "a | turbo run test b"` is not denied (a quoted delimiter must not false-split a segment)', () => {
		const result = decide('echo "a | turbo run test b"', FIXTURE);
		expect(result.action).not.toBe("deny");
	});

	test("a bareword mention elsewhere in the command is not the first token", () => {
		const result = decide("grep -rn vitest .", FIXTURE);
		expect(result.action).toBe("passthrough");
	});

	test('defect3: `NODE_OPTIONS="--a --b" pnpm test` denies (quoted env value doesn\'t break env-strip)', () => {
		const result = decide('NODE_OPTIONS="--a --b" pnpm test', FIXTURE);
		expect(result.action).toBe("deny");
	});
});

describe("decide — no matching runner", () => {
	test("an unrelated command passes through untouched", () => {
		const result = decide("ls -la", FIXTURE);
		expect(result.action).toBe("passthrough");
	});
});

// -----------------------------------------------------------------------------
// Drift pin — every test above runs decide() against FIXTURE, a hand-copied
// snapshot of verify-caps.yaml's schema. FIXTURE only ever gets verified
// against itself, so if the shipped yaml drifts (a deny script removed, a
// scope flag renamed, an env cap value changed) the whole suite above stays
// green while the deployed policy silently breaks — false-green. These tests
// load the real verify-caps.yaml through loadConfig() (not FIXTURE) and pin
// the same core truth-table shape against it, so a drift fails here instead.
// -----------------------------------------------------------------------------
describe("decide — real verify-caps.yaml drift pin", () => {
	const moduleDir = fileURLToPath(new URL(".", import.meta.url));
	const realConfig = loadConfig(moduleDir);

	test("`pnpm test` denies against the shipped yaml", () => {
		const result = decide("pnpm test", realConfig);
		expect(result.action).toBe("deny");
	});

	test("`pnpm test --filter=x` is not denied against the shipped yaml", () => {
		const result = decide("pnpm test --filter=x", realConfig);
		expect(result.action).not.toBe("deny");
	});

	test("`vitest run` gets VITEST_MAX_FORKS injected against the shipped yaml", () => {
		const result = decide("vitest run", realConfig);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).toContain("VITEST_MAX_FORKS=2");
		}
	});

	test("`turbo run build` does not get --concurrency appended (flag_requires_scope, no scope flag) against the shipped yaml", () => {
		const result = decide("turbo run build", realConfig);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).not.toContain("--concurrency");
		}
	});

	test("`pnpm publish` is passthrough against the shipped yaml (inject_scripts keeps non-verification commands off the auto-approve path)", () => {
		const result = decide("pnpm publish", realConfig);
		expect(result.action).toBe("passthrough");
	});

	test("`pnpm test --filter=x` still injects env against the shipped yaml", () => {
		const result = decide("pnpm test --filter=x", realConfig);
		expect(result.action).toBe("allow");
		if (result.action === "allow") {
			expect(result.command).toContain("VITEST_MAX_FORKS=2");
		}
	});

	test("`pnpm -r test` denies against the shipped yaml (recursive whole-workspace run)", () => {
		const result = decide("pnpm -r test", realConfig);
		expect(result.action).toBe("deny");
	});
});

// -----------------------------------------------------------------------------
// loadConfig — base+local per-runner merge (mirrors hooks/rules-injector's
// local-config.ts convention: config.yaml base + config.local.yaml override,
// local wins, absent/malformed degrades non-fatally to {}).
// -----------------------------------------------------------------------------
describe("loadConfig", () => {
	const configDirs: string[] = [];

	afterEach(() => {
		while (configDirs.length > 0) {
			const dir = configDirs.pop();
			if (dir !== undefined) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	function makeConfigDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "verify-caps-gate-"));
		configDirs.push(dir);
		return dir;
	}

	test("loads the shipped base config from this module's own directory", () => {
		const moduleDir = fileURLToPath(new URL(".", import.meta.url));
		const config = loadConfig(moduleDir);
		expect(config.runners.vitest?.env?.VITEST_MAX_FORKS).toBe("2");
		expect(config.runners.jest?.flag).toBe("--maxWorkers=2");
		expect(config.runners.turbo?.deny?.scripts).toEqual(["test", "lint"]);
		expect(config.runners.pnpm?.deny?.scope_flags).toContain("--affected");
	});

	test("local override replaces one runner's env, other runners stay from base", () => {
		const dir = makeConfigDir();
		writeFileSync(
			join(dir, "verify-caps.yaml"),
			"runners:\n  vitest:\n    env:\n      VITEST_MAX_FORKS: \"2\"\n      VITEST_MAX_THREADS: \"2\"\n  jest:\n    flag: \"--maxWorkers=2\"\n",
		);
		writeFileSync(
			join(dir, "verify-caps.local.yaml"),
			'runners:\n  vitest:\n    env:\n      VITEST_MAX_FORKS: "1"\n      VITEST_MAX_THREADS: "2"\n',
		);

		const config = loadConfig(dir);
		expect(config.runners.vitest?.env?.VITEST_MAX_FORKS).toBe("1");
		expect(config.runners.jest?.flag).toBe("--maxWorkers=2");
	});

	test("defect6: local partial env override merges with base env, sibling keys preserved", () => {
		const dir = makeConfigDir();
		writeFileSync(
			join(dir, "verify-caps.yaml"),
			'runners:\n  vitest:\n    env:\n      VITEST_MAX_FORKS: "2"\n      VITEST_MAX_THREADS: "2"\n',
		);
		writeFileSync(
			join(dir, "verify-caps.local.yaml"),
			'runners:\n  vitest:\n    env:\n      VITEST_MAX_FORKS: "1"\n',
		);

		const config = loadConfig(dir);
		expect(config.runners.vitest?.env).toEqual({ VITEST_MAX_FORKS: "1", VITEST_MAX_THREADS: "2" });
	});

	test("absent local file degrades to base-only, no throw", () => {
		const dir = makeConfigDir();
		writeFileSync(join(dir, "verify-caps.yaml"), 'runners:\n  jest:\n    flag: "--maxWorkers=2"\n');

		const config = loadConfig(dir);
		expect(config.runners.jest?.flag).toBe("--maxWorkers=2");
		expect(Object.keys(config.runners)).toEqual(["jest"]);
	});

	test("malformed yaml degrades non-fatally to an empty config", () => {
		const dir = makeConfigDir();
		writeFileSync(join(dir, "verify-caps.yaml"), "runners: [invalid: : :");

		expect(() => loadConfig(dir)).not.toThrow();
		const config = loadConfig(dir);
		expect(config.runners).toEqual({});
	});

	test("entirely missing config dir degrades to an empty config, no throw", () => {
		const missingDir = join(tmpdir(), "verify-caps-gate-missing-" + Date.now());
		expect(() => loadConfig(missingDir)).not.toThrow();
		const config = loadConfig(missingDir);
		expect(config.runners).toEqual({});
	});
});

// -----------------------------------------------------------------------------
// processHookInput — the PreToolUse IO contract main() delegates to. Never
// throws; malformed input or a non-Bash tool degrades to "" (passthrough, no
// hook output emitted).
// -----------------------------------------------------------------------------
describe("processHookInput", () => {
	const moduleDir = fileURLToPath(new URL(".", import.meta.url));

	test("non-Bash tool_name passes through silently", () => {
		const output = processHookInput(
			JSON.stringify({ tool_name: "Read", tool_input: { file_path: "x" } }),
			moduleDir,
		);
		expect(output).toBe("");
	});

	test("malformed JSON fails open to passthrough, never throws", () => {
		expect(() => processHookInput("{not json", moduleDir)).not.toThrow();
		expect(processHookInput("{not json", moduleDir)).toBe("");
	});

	test("empty command passes through silently", () => {
		const output = processHookInput(
			JSON.stringify({ tool_name: "Bash", tool_input: { command: "" } }),
			moduleDir,
		);
		expect(output).toBe("");
	});

	test("missing tool_input does not throw and passes through", () => {
		expect(() =>
			processHookInput(JSON.stringify({ tool_name: "Bash" }), moduleDir),
		).not.toThrow();
	});

	test("end-to-end deny: emits a PreToolUse deny envelope", () => {
		const output = processHookInput(
			JSON.stringify({ tool_name: "Bash", tool_input: { command: "pnpm test" } }),
			moduleDir,
		);
		const parsed = JSON.parse(output);
		expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
		expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(typeof parsed.hookSpecificOutput.permissionDecisionReason).toBe("string");
	});

	test("end-to-end allow: emits a PreToolUse allow envelope with updatedInput.command", () => {
		const output = processHookInput(
			JSON.stringify({ tool_name: "Bash", tool_input: { command: "vitest run" } }),
			moduleDir,
		);
		const parsed = JSON.parse(output);
		expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
		expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
		expect(parsed.hookSpecificOutput.updatedInput.command).toContain("VITEST_MAX_FORKS=2");
	});

	test("passthrough emits no output at all", () => {
		const output = processHookInput(
			JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls -la" } }),
			moduleDir,
		);
		expect(output).toBe("");
	});
});

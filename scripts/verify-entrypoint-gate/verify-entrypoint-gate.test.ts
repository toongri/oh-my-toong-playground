import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decide, findWorkspaceRoot, loadConfig, processHookInput, type Policy } from "./index.ts";

// -----------------------------------------------------------------------------
// Fixture policy mirroring verify-entrypoint-gate.yaml's shipped initial
// values. decide() is pure and takes plain data — no file I/O needed to run
// the truth table below.
// -----------------------------------------------------------------------------
const POLICY: Policy = {
	entrypoints: ["verify", "test", "check", "lint"],
	allowedTurboOpts: ["--continue"],
	runners: ["vitest", "jest", "pytest", "eslint", "tsc", "turbo", "uv"],
	via: ["npx", "bunx", "pnpm exec", "pnpm dlx", "node_modules/.bin"],
};

// A plain-data stand-in for the real nebula-dibble root package.json's
// `scripts` keys (verify/test/check/lint present, verify:quick/verify:full
// long gone — see infra/local/scripts/verify.sh in that repo).
const WORKSPACE_ROOT = "/repo";
const REPO_SCRIPTS = [
	"start",
	"stg",
	"local",
	"local:docker",
	"local:backend",
	"local:web",
	"local:admin",
	"local:mobile",
	"local:dispenser",
	"dispenser",
	"local:traefik",
	"local:cron-worker",
	"build",
	"build:web",
	"build:admin",
	"build:codex-rules",
	"test",
	"worker",
	"lint",
	"check",
	"verify",
	"doctor",
	"doctor:diff",
	"prepare",
	"local:funnel",
	"ios",
	"android",
	"local:ios",
	"local:android",
	"seed",
];
const OUTSIDE_WORKSPACE_CWD = "/tmp/nowhere-near-a-workspace";
const NON_ROOT_CWD = `${WORKSPACE_ROOT}/apps/admin`;

// Fixture-only cwd → {workspaceRoot, scripts} resolver (no filesystem): this
// is exactly the "thin outer layer" work decide() itself never does. Real
// resolution (findWorkspaceRoot / readPackageScripts) is exercised
// separately below with real tmpdirs.
function resolveFixtureCwd(cwd: string): { workspaceRoot: string | null; scripts: string[] } {
	if (cwd === OUTSIDE_WORKSPACE_CWD) return { workspaceRoot: null, scripts: [] };
	return { workspaceRoot: WORKSPACE_ROOT, scripts: REPO_SCRIPTS };
}

type Row = { command: string; cwd?: string; expect: "deny" | "passthrough"; note: string };

// -----------------------------------------------------------------------------
// Command → judgment single fixture table. Every row required by the task
// spec is present, including the shell-normalization edge cases absorbed
// from verify-caps-gate.test.ts and the three explicit regression markers
// (rows that passed under the OLD verify-caps-gate and must now deny).
// -----------------------------------------------------------------------------
const TABLE: Row[] = [
	// --- passthrough: the four whitelisted entrypoints, bare and scoped ---
	{ command: "pnpm verify", expect: "passthrough", note: "무필터 verify — 화이트리스트 정확 일치" },
	{ command: "pnpm test admin", expect: "passthrough", note: "앱 이름 스코프" },
	{ command: "pnpm test admin -- src/foo.test.ts", expect: "passthrough", note: "-- 뒤 파일 선택자는 검사하지 않음" },
	{
		command: 'pnpm test backend -- -t "쿠폰 만료"',
		expect: "passthrough",
		note: "-- 뒤 -t 패턴 선택자, 공백 포함 값도 검사 대상 아님",
	},
	{ command: "pnpm check", expect: "passthrough", note: "check도 화이트리스트" },
	{ command: "pnpm lint", expect: "passthrough", note: "lint도 화이트리스트 (--fix 여부는 판단축 아님)" },
	{ command: "pnpm test admin --continue", expect: "passthrough", note: "allowed_turbo_opts 플래그 허용" },
	// --- passthrough: not a verification attempt at all (rule 1 short-circuit) ---
	{ command: "pnpm start", expect: "passthrough", note: "검증 시도 아님 — 일상 유틸 스크립트" },
	{ command: "pnpm seed", expect: "passthrough", note: "검증 시도 아님" },
	{ command: "pnpm local:admin", expect: "passthrough", note: "검증 시도 아님" },
	{ command: "pnpm build", expect: "passthrough", note: "검증 시도 아님" },
	{ command: "pnpm ios", expect: "passthrough", note: "검증 시도 아님" },
	{ command: "pnpm install", expect: "passthrough", note: "검증 시도 아님" },
	{ command: "pnpm dlx foo", expect: "passthrough", note: "via(pnpm dlx) 뒤 토큰이 runners에 없어 검증 시도 아님" },

	// --- deny: --all / whole-monorepo scope ---
	{
		command: "pnpm verify --all",
		expect: "deny",
		note: "REGRESSION MARKER — 구 verify-caps-gate에서는 이 명령이 allow로 통과했다",
	},
	{ command: "pnpm test --all", expect: "deny", note: "--all은 positional로 취급되어도 명시적으로 실패" },

	// --- deny: pnpm이 가로채는 자리(스크립트명 앞 플래그) ---
	{ command: "pnpm -r test", expect: "deny", note: "스크립트명 앞 -r" },
	{ command: "pnpm --recursive test", expect: "deny", note: "스크립트명 앞 --recursive" },
	{ command: "pnpm --filter @algocare/admin test", expect: "deny", note: "스크립트명 앞 --filter" },
	{ command: "pnpm -F admin test", expect: "deny", note: "스크립트명 앞 -F" },

	// --- deny: 스크립트명 뒤 비허용 플래그 ---
	{ command: "pnpm test --force", expect: "deny", note: "--force는 allowed_turbo_opts에 없음(캐시 무시)" },
	{ command: "pnpm test --filter=web", expect: "deny", note: "--filter=... 는 allowed_turbo_opts에 없음" },

	// --- deny: via 경유 러너 직접 호출 ---
	{
		command: "npx vitest run",
		expect: "deny",
		note: "REGRESSION MARKER — 구 verify-caps-gate에서는 무개입(passthrough)이었다",
	},
	{ command: "bunx jest", expect: "deny", note: "via(bunx) 경유 러너 직접 호출" },
	{ command: "pnpm exec vitest", expect: "deny", note: "via(pnpm exec) 경유 러너 직접 호출" },
	{ command: "./node_modules/.bin/vitest", expect: "deny", note: "via(node_modules/.bin) 경유 — 경로 basename 매칭" },

	// --- deny: 러너 직접 호출 ---
	{ command: "uv run pytest tests/", expect: "deny", note: "runners 직접 호출(uv)" },
	{ command: "pytest", expect: "deny", note: "runners 직접 호출(pytest)" },
	{ command: "eslint .", expect: "deny", note: "runners 직접 호출(eslint)" },
	{ command: "tsc --noEmit", expect: "deny", note: "runners 직접 호출(tsc)" },
	{ command: "turbo run test", expect: "deny", note: "runners 직접 호출(turbo) — 무필터든 아니든 pnpm 형태가 아니면 항상 deny" },

	// --- deny: cwd 관련 (rule 3, 4) ---
	{
		command: "cd apps/admin && pnpm test",
		expect: "deny",
		note: "REGRESSION MARKER — 구 verify-caps-gate에서는 무개입(passthrough)이었다 (compound + 실행 전 cwd 판정 우회)",
	},
	{ command: "pnpm test && echo done", expect: "deny", note: "검증 시도가 compound에 섞임" },
	{
		command: "pnpm verify ;",
		expect: "deny",
		note: "compound 판정을 단독으로 격리하는 행 — `;` 앞에 공백이 있어 토큰화되면 rule 6(형태매칭)은 단일 positional로 오인해 통과시키므로 rule 2(compound)가 반드시 별도로 잡아야 함",
	},
	{ command: "pnpm test", cwd: NON_ROOT_CWD, expect: "deny", note: "cwd가 워크스페이스 루트 자신이 아님" },
	{ command: "pnpm test", cwd: OUTSIDE_WORKSPACE_CWD, expect: "deny", note: "워크스페이스 루트를 찾을 수 없음 (fail-closed)" },

	// --- 셸 정규화 엣지케이스 (verify-caps-gate.test.ts에서 흡수) ---
	{ command: "FOO=1 pnpm test --all", expect: "deny", note: "env 접두사 뒤에도 판정이 동일해야 함" },
	{ command: "pnpm  test   admin", expect: "passthrough", note: "다중 공백 정규화" },
	{
		command: "turbo run test -- --affected",
		expect: "deny",
		note: "-- 뒤 --affected는 러너 인자일 뿐 — 애초에 turbo 직접 호출이라 무조건 deny",
	},
	{ command: "pnpm --filter admin test src/foo.test.ts", expect: "deny", note: "스크립트명 앞 플래그(재확인)" },

	// --- 결함 (a) — isCompound가 splitSegments와 다르게 판정하던 오차단 ---
	{
		command: 'pnpm test admin -- -t "결제|환불"',
		expect: "passthrough",
		note: "REGRESSION FIX — -- 뒤 따옴표 안 `|`는 vitest -t 정규식 교대일 뿐 compound 아님",
	},
	{
		command: 'pnpm test admin -- -t "a;b"',
		expect: "passthrough",
		note: "REGRESSION FIX — -- 뒤 따옴표 안 `;`도 리터럴",
	},
	{
		command: 'pnpm test admin -- -t "a&b"',
		expect: "passthrough",
		note: "REGRESSION FIX — -- 뒤 따옴표 안 `&`도 리터럴",
	},
	{
		command: 'pnpm test admin -- -t "a" && echo done',
		expect: "deny",
		note: "회귀 방지 — -- 뒤라도 따옴표 밖의 진짜 && 는 여전히 compound",
	},
];

describe("decide — command-to-judgment table", () => {
	test.each(TABLE)("$command → $expect ($note)", (row) => {
		const cwd = row.cwd ?? WORKSPACE_ROOT;
		const { workspaceRoot, scripts } = resolveFixtureCwd(cwd);
		const result = decide({
			command: row.command,
			cwd,
			workspaceRoot,
			scripts,
			entrypoints: POLICY.entrypoints,
			allowedTurboOpts: POLICY.allowedTurboOpts,
			runners: POLICY.runners,
			via: POLICY.via,
		});
		expect(result.decision).toBe(row.expect);
	});
});

describe("decide — never produces anything but deny/passthrough", () => {
	test("DecideResult's decision field is structurally closed to deny|passthrough — there is no allow branch", () => {
		for (const row of TABLE) {
			const cwd = row.cwd ?? WORKSPACE_ROOT;
			const { workspaceRoot, scripts } = resolveFixtureCwd(cwd);
			const result = decide({
				command: row.command,
				cwd,
				workspaceRoot,
				scripts,
				entrypoints: POLICY.entrypoints,
				allowedTurboOpts: POLICY.allowedTurboOpts,
				runners: POLICY.runners,
				via: POLICY.via,
			});
			expect(["deny", "passthrough"]).toContain(result.decision);
		}
	});
});

describe("decide — deny reason dynamically lists the intersection", () => {
	test("a shape-mismatch deny names the current whitelist, not a hardcoded/dead script", () => {
		const result = decide({
			command: "pnpm test --force",
			cwd: WORKSPACE_ROOT,
			workspaceRoot: WORKSPACE_ROOT,
			scripts: REPO_SCRIPTS,
			entrypoints: POLICY.entrypoints,
			allowedTurboOpts: POLICY.allowedTurboOpts,
			runners: POLICY.runners,
			via: POLICY.via,
		});
		expect(result.decision).toBe("deny");
		if (result.decision === "deny") {
			expect(result.reason).toContain("verify");
			expect(result.reason).toContain("test");
			expect(result.reason).toContain("check");
			expect(result.reason).toContain("lint");
			expect(result.reason).not.toContain("verify:quick");
			expect(result.reason).not.toContain("verify:full");
		}
	});

	test("the deny reason reflects whatever entrypoints ∩ scripts actually is — shrinks when the repo removes a script", () => {
		const result = decide({
			command: "pnpm test --force",
			cwd: WORKSPACE_ROOT,
			workspaceRoot: WORKSPACE_ROOT,
			scripts: ["verify", "lint"], // simulates a repo where test/check no longer exist
			entrypoints: POLICY.entrypoints,
			allowedTurboOpts: POLICY.allowedTurboOpts,
			runners: POLICY.runners,
			via: POLICY.via,
		});
		expect(result.decision).toBe("deny");
		if (result.decision === "deny") {
			expect(result.reason).toContain("verify");
			expect(result.reason).toContain("lint");
			expect(result.reason).not.toContain("check");
		}
	});
});

// -----------------------------------------------------------------------------
// AC5 (compound branch) — the compound deny reason (step 2, index.ts:88-94)
// must not hardcode any entrypoint script name either, mirroring the shape
// dynamism already required of the step-6 deny reason above. A hardcoded
// "pnpm verify/test/check/lint 등" phrase is wrong even before any future
// rename: isVerificationAttemptSegment recognizes non-pnpm verification
// attempts too (a bare runner call, a via-executor call), so the second row
// below — a non-pnpm compound — is the one that actually falsifies a fix
// that merely swaps in POLICY.entrypoints.join("/") instead of removing the
// names outright.
// -----------------------------------------------------------------------------
describe("decide — compound deny reason never hardcodes an entrypoint name (AC5)", () => {
	test("pnpm-path compound deny reason contains none of the policy's entrypoint names", () => {
		const result = decide({
			command: "pnpm test && echo done",
			cwd: WORKSPACE_ROOT,
			workspaceRoot: WORKSPACE_ROOT,
			scripts: REPO_SCRIPTS,
			entrypoints: POLICY.entrypoints,
			allowedTurboOpts: POLICY.allowedTurboOpts,
			runners: POLICY.runners,
			via: POLICY.via,
		});
		expect(result.decision).toBe("deny");
		if (result.decision === "deny") {
			for (const entrypoint of POLICY.entrypoints) {
				expect(result.reason).not.toContain(entrypoint);
			}
		}
	});

	test("non-pnpm-path compound deny reason also contains none of the policy's entrypoint names — a pnpm-flavored message would misdescribe this path", () => {
		const result = decide({
			command: "npx vitest && echo done",
			cwd: WORKSPACE_ROOT,
			workspaceRoot: WORKSPACE_ROOT,
			scripts: REPO_SCRIPTS,
			entrypoints: POLICY.entrypoints,
			allowedTurboOpts: POLICY.allowedTurboOpts,
			runners: POLICY.runners,
			via: POLICY.via,
		});
		expect(result.decision).toBe("deny");
		if (result.decision === "deny") {
			for (const entrypoint of POLICY.entrypoints) {
				expect(result.reason).not.toContain(entrypoint);
			}
		}
	});
});

// -----------------------------------------------------------------------------
// findWorkspaceRoot — the one piece of new fs-touching logic (the old gate
// never read cwd at all: grep 0 hits). Exercised with real tmpdirs since it's
// the thin outer layer decide() itself doesn't cover.
// -----------------------------------------------------------------------------
describe("findWorkspaceRoot", () => {
	const dirs: string[] = [];

	afterEach(() => {
		while (dirs.length > 0) {
			const dir = dirs.pop();
			if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
		}
	});

	function makeDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "verify-entrypoint-gate-"));
		dirs.push(dir);
		return dir;
	}

	test("finds the root by walking up from a nested cwd", () => {
		const root = makeDir();
		writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
		const nested = join(root, "apps", "admin");
		mkdirSync(nested, { recursive: true });

		expect(findWorkspaceRoot(nested)).toBe(root);
	});

	test("cwd that IS the root resolves to itself", () => {
		const root = makeDir();
		writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");

		expect(findWorkspaceRoot(root)).toBe(root);
	});

	test("returns null when no pnpm-workspace.yaml exists anywhere up the chain", () => {
		const dir = makeDir();
		// A bounded child dir with no anchor above it within our tmp tree; the
		// walk continues past it toward the real filesystem root, but since this
		// test environment's real root has no pnpm-workspace.yaml either, null.
		expect(findWorkspaceRoot(dir)).toBeNull();
	});
});

// -----------------------------------------------------------------------------
// loadConfig — base (this module's own directory) + local (a DIFFERENT,
// caller-supplied directory representing the target workspace root's
// .claude/scripts/verify-entrypoint-gate/) merged one key at a time. This is
// the core difference from verify-caps-gate: base and local dirs can now
// diverge, which is what makes per-project policy overlays possible at all.
// -----------------------------------------------------------------------------
describe("loadConfig", () => {
	const dirs: string[] = [];

	afterEach(() => {
		while (dirs.length > 0) {
			const dir = dirs.pop();
			if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
		}
	});

	function makeDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "verify-entrypoint-gate-cfg-"));
		dirs.push(dir);
		return dir;
	}

	test("loads the shipped base config from this module's own directory", () => {
		const moduleDir = fileURLToPath(new URL(".", import.meta.url));
		const config = loadConfig(moduleDir);
		expect(config.entrypoints).toEqual(["verify", "test", "check", "lint"]);
		expect(config.allowedTurboOpts).toEqual(["--continue"]);
		expect(config.runners).toContain("vitest");
		expect(config.via).toContain("npx");
	});

	test("base-only when localDir is omitted (no workspace root found)", () => {
		const baseDir = makeDir();
		writeFileSync(join(baseDir, "verify-entrypoint-gate.yaml"), "entrypoints: [verify, test]\nrunners: [vitest]\n");

		const config = loadConfig(baseDir);
		expect(config.entrypoints).toEqual(["verify", "test"]);
	});

	test("local dir is a DIFFERENT directory from base — the key structural change from verify-caps-gate", () => {
		const baseDir = makeDir();
		const localDir = makeDir();
		expect(localDir).not.toBe(baseDir);

		writeFileSync(
			join(baseDir, "verify-entrypoint-gate.yaml"),
			"entrypoints: [verify, test, check, lint]\nrunners: [vitest, turbo]\nvia: [npx]\n",
		);
		writeFileSync(join(localDir, "verify-entrypoint-gate.local.yaml"), "entrypoints: [verify]\n");

		const config = loadConfig(baseDir, localDir);
		// local replaces the whole `entrypoints` array...
		expect(config.entrypoints).toEqual(["verify"]);
		// ...but a key local doesn't declare (runners, via) falls through to base.
		expect(config.runners).toEqual(["vitest", "turbo"]);
		expect(config.via).toEqual(["npx"]);
	});

	test("absent local file degrades to base-only, no throw", () => {
		const baseDir = makeDir();
		const localDir = makeDir(); // exists as a dir, but no .local.yaml inside it
		writeFileSync(join(baseDir, "verify-entrypoint-gate.yaml"), "entrypoints: [verify]\n");

		expect(() => loadConfig(baseDir, localDir)).not.toThrow();
		const config = loadConfig(baseDir, localDir);
		expect(config.entrypoints).toEqual(["verify"]);
	});

	test("malformed yaml degrades non-fatally to an empty list for that key", () => {
		const baseDir = makeDir();
		writeFileSync(join(baseDir, "verify-entrypoint-gate.yaml"), "entrypoints: [invalid: : :");

		expect(() => loadConfig(baseDir)).not.toThrow();
		expect(loadConfig(baseDir).entrypoints).toEqual([]);
	});

	test("entirely missing base dir degrades to an empty config, no throw", () => {
		const missingDir = join(tmpdir(), "verify-entrypoint-gate-missing-" + Date.now());
		expect(() => loadConfig(missingDir)).not.toThrow();
		const config = loadConfig(missingDir);
		expect(config.entrypoints).toEqual([]);
		expect(config.runners).toEqual([]);
	});
});

// -----------------------------------------------------------------------------
// processHookInput — the PreToolUse IO contract. Confirms the two-envelope
// contract end to end: deny produces a permissionDecision:"deny" envelope,
// everything else produces "" — and, critically, "allow" never appears
// anywhere in any output this function can produce.
// -----------------------------------------------------------------------------
describe("processHookInput", () => {
	const moduleDir = fileURLToPath(new URL(".", import.meta.url));

	test("non-Bash tool_name passes through silently", () => {
		const output = processHookInput(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "x" } }), moduleDir);
		expect(output).toBe("");
	});

	test("malformed JSON fails to passthrough, never throws", () => {
		expect(() => processHookInput("{not json", moduleDir)).not.toThrow();
		expect(processHookInput("{not json", moduleDir)).toBe("");
	});

	test("empty command passes through silently", () => {
		const output = processHookInput(
			JSON.stringify({ tool_name: "Bash", tool_input: { command: "" }, cwd: "/tmp" }),
			moduleDir,
		);
		expect(output).toBe("");
	});

	test("missing tool_input does not throw and passes through", () => {
		expect(() => processHookInput(JSON.stringify({ tool_name: "Bash", cwd: "/tmp" }), moduleDir)).not.toThrow();
	});

	test("end-to-end deny: emits a PreToolUse deny envelope, never allow", () => {
		const output = processHookInput(
			JSON.stringify({ tool_name: "Bash", tool_input: { command: "npx vitest run" }, cwd: "/tmp" }),
			moduleDir,
		);
		const parsed = JSON.parse(output);
		expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
		expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(typeof parsed.hookSpecificOutput.permissionDecisionReason).toBe("string");
		expect(output).not.toContain('"allow"');
	});

	test("passthrough emits no output at all — never an allow envelope", () => {
		const output = processHookInput(
			JSON.stringify({ tool_name: "Bash", tool_input: { command: "pnpm start" }, cwd: "/tmp" }),
			moduleDir,
		);
		expect(output).toBe("");
	});

	test("a real workspace root round-trip: verify at the root passes through, denies elsewhere", () => {
		const root = mkdtempSync(join(tmpdir(), "verify-entrypoint-gate-e2e-"));
		try {
			writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
			writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { verify: "echo verify" } }));

			const passOutput = processHookInput(
				JSON.stringify({ tool_name: "Bash", tool_input: { command: "pnpm verify" }, cwd: root }),
				moduleDir,
			);
			expect(passOutput).toBe("");

			const nested = join(root, "apps", "admin");
			mkdirSync(nested, { recursive: true });
			const denyOutput = processHookInput(
				JSON.stringify({ tool_name: "Bash", tool_input: { command: "pnpm verify" }, cwd: nested }),
				moduleDir,
			);
			expect(JSON.parse(denyOutput).hookSpecificOutput.permissionDecision).toBe("deny");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

// -----------------------------------------------------------------------------
// Drift pin — every table test above runs decide() against POLICY, a
// hand-copied snapshot of verify-entrypoint-gate.yaml's shipped values. If
// the real yaml drifts (an entrypoint renamed, a runner removed), the table
// above stays green while the deployed policy silently changed — false
// green. This loads the REAL yaml through loadConfig() and pins the same
// shape, so a drift fails here instead.
// -----------------------------------------------------------------------------
describe("real verify-entrypoint-gate.yaml drift pin", () => {
	const moduleDir = fileURLToPath(new URL(".", import.meta.url));
	const real = loadConfig(moduleDir);

	test("shipped entrypoints/allowedTurboOpts/runners/via match what the table's POLICY fixture assumes", () => {
		expect(real.entrypoints).toEqual(POLICY.entrypoints);
		expect(real.allowedTurboOpts).toEqual(POLICY.allowedTurboOpts);
		expect(real.runners).toEqual(POLICY.runners);
		expect(real.via).toEqual(POLICY.via);
	});
});

test("verify-entrypoint-gate.yaml has no leftover cap-injection fields", () => {
	const yamlPath = join(fileURLToPath(new URL(".", import.meta.url)), "verify-entrypoint-gate.yaml");
	const raw = existsSync(yamlPath) ? readFileSync(yamlPath, "utf8") : "";
	for (const forbidden of ["env:", "flag:", "flag_requires_scope", "inject_scripts", "deny_args"]) {
		expect(raw).not.toContain(forbidden);
	}
});

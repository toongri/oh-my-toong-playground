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
	{ command: '"pnpm" test admin', expect: "passthrough", note: "회귀 방지 — 정규화 후 형태매칭도 통과해야 함(새 오차단 금지)" },

	// --- 유한 우회 (b)-1: npm/yarn 계열 ---
	{ command: "npm test", expect: "deny", note: "npm 계열 확장" },
	{ command: "yarn test", expect: "deny", note: "yarn 계열 확장" },

	// --- 유한 우회 (b)-2: 투명 래퍼(command/env) ---
	{ command: "command pnpm test --all", expect: "deny", note: "투명 래퍼 command 벗기고 분석" },
	{ command: "env pnpm test --all", expect: "deny", note: "투명 래퍼 env 벗기고 분석" },
	{
		command: "env FOO=1 pnpm test",
		expect: "deny",
		note: "env 뒤 할당이 stripLeadingEnvAssignments와 맞물려 동작 — 래퍼 형태라 shape 매칭은 항상 실패",
	},

	// --- 유한 우회 (b)-3: 따옴표/백슬래시 난독화 ---
	{ command: "p'n'pm test --all", expect: "deny", note: "따옴표로 쪼갠 pnpm 토큰 정규화" },
	{ command: '"pnpm" test --all', expect: "deny", note: "전체 따옴표로 감싼 pnpm 토큰 정규화" },
	{ command: "\\pnpm test --all", expect: "deny", note: "백슬래시 이스케이프 pnpm 토큰 정규화" },

	// --- 유한 우회 (b)-4: 중첩 셸 ---
	{ command: 'bash -c "pnpm test --all"', expect: "deny", note: "bash -c 안쪽 재탐지" },
	{ command: "sh -c 'pnpm test --all'", expect: "deny", note: "sh -c 안쪽 재탐지" },
	{ command: 'eval "pnpm test --all"', expect: "deny", note: "eval 안쪽 재탐지" },

	// --- 결함 (b) — via 접두사와 러너 사이에 실행기 플래그가 끼면 인덱스가 밀려
	// isVerificationAttemptSegment가 시도 자체를 놓치던 우회. 플래그를 건너뛰고
	// 처음 만나는 비-옵션 토큰을 러너로 봐야 한다 ---
	{ command: "bunx --bun vitest run", expect: "deny", note: "REGRESSION FIX — via(bunx)와 러너 사이 --bun 플래그로 우회하던 것" },
	{
		command: "npx --package=vitest -- vitest run",
		expect: "deny",
		note: "REGRESSION FIX — 플래그+`--` 둘 다 건너뛰어야 vitest를 찾음(npx에게 `--` 뒤는 실행할 명령)",
	},
	{ command: "npx --yes vitest run", expect: "deny", note: "REGRESSION FIX — via(npx) 뒤 --yes 플래그로 우회하던 것" },
	{ command: "npx -y vitest", expect: "deny", note: "REGRESSION FIX — via(npx) 뒤 단축 -y 플래그로 우회하던 것" },
	{ command: "pnpm exec --silent vitest", expect: "deny", note: "REGRESSION FIX — via(pnpm exec) 뒤 --silent 플래그로 우회하던 것" },
	{ command: "pnpm dlx --package=vitest vitest run", expect: "deny", note: "REGRESSION FIX — via(pnpm dlx) 뒤 --package= 플래그로 우회하던 것" },
	{ command: "bunx --bun jest", expect: "deny", note: "REGRESSION FIX — via(bunx) 뒤 --bun 플래그, 러너는 jest" },
	{ command: "npx --no-install turbo run test", expect: "deny", note: "REGRESSION FIX — via(npx) 뒤 --no-install 플래그로 우회하던 것" },

	// --- 오차단 회귀 없음 — 실행기 플래그를 건너뛰되, `--`의 의미는 첫 토큰에
	// 따라 반대이므로 pnpm 쪽 `--` 뒤 러너 셀렉터는 여전히 검사하지 않아야 함 ---
	{
		command: 'pnpm test admin -- -t "결제|환불"',
		cwd: WORKSPACE_ROOT,
		expect: "passthrough",
		note: "최우선 회귀 가드 — (b) 수정이 pnpm의 `--` 뒤 러너 셀렉터까지 들여다보면 안 됨",
	},
	{ command: "npx --yes create-react-app myapp", expect: "passthrough", note: "플래그를 건너뛴 다음 토큰이 runners에 없으면 여전히 시도 아님" },
	{
		command: 'pnpm test admin -- --reporter=verbose',
		expect: "passthrough",
		note: "-- 뒤 러너 플래그도 셀렉터로 취급 — 검사하지 않음",
	},
	{
		command: 'git commit -m "pnpm test --all 로 검증"',
		expect: "passthrough",
		note: "따옴표 안에 박힌 pnpm 문구는 첫 토큰이 git이라 시도로 오인되지 않음",
	},
	{
		command: 'echo "run pnpm test --all"',
		expect: "passthrough",
		note: "따옴표 안에 박힌 pnpm 문구는 첫 토큰이 echo라 시도로 오인되지 않음",
	},

	// --- 결함 (c) — 래퍼가 stripLeadingTransparentWrappers/nestedShellInnerCommand
	// 가정("래퍼 다음 토큰이 곧바로 목표물")을 벗어난 옵션 형태를 취하면
	// isVerificationAttemptSegment가 시도 자체를 놓치던 우회. 세 검사 (a)/(b)/(c)가
	// 모두 실패했을 때만 도는 래퍼 flat-스캔 fallback으로 닫는다 ---
	{
		command: "env -- pnpm test --all",
		expect: "deny",
		note: "REGRESSION FIX — env -- 뒤 pnpm 진입점 우회. stripAfterEndOfOptions가 선두 -- 에도 매치해 tokens.length===0으로 조기 반환하던 경로도 fallback이 닫음",
	},
	{
		command: "env --ignore-environment pnpm test --all",
		expect: "deny",
		note: "REGRESSION FIX — env 뒤 공백-분리 값을 갖지 않는 플래그로 우회하던 것",
	},
	{ command: "env -i pnpm test --all", expect: "deny", note: "REGRESSION FIX — env -i 플래그 우회" },
	{
		command: "env -u PATH pnpm test --all",
		expect: "deny",
		note: "REGRESSION FIX — env -u 는 값을 공백으로 분리해 받아 '-로 시작하는 토큰 건너뛰기'로 안 닫힘",
	},
	{ command: 'env -S "pnpm test --all"', expect: "deny", note: "REGRESSION FIX — env -S 플래그 우회" },
	{ command: "command -p pnpm test --all", expect: "deny", note: "REGRESSION FIX — command -p 플래그 우회" },
	{ command: 'bash --noprofile -c "pnpm test --all"', expect: "deny", note: "REGRESSION FIX — bash --noprofile -c 다중 플래그 우회" },
	{ command: 'sh -e -c "pnpm test --all"', expect: "deny", note: "REGRESSION FIX — sh -e -c 다중 플래그 우회" },
	{ command: 'bash -x -c "pnpm test --all"', expect: "deny", note: "REGRESSION FIX — bash -x -c 다중 플래그 우회" },
	{ command: 'bash -lc "pnpm test --all"', expect: "deny", note: "REGRESSION FIX — bash -lc 결합 단축옵션은 -c 문자열 동등비교로 안 잡힘" },
	{ command: 'bash -xc "pnpm test --all"', expect: "deny", note: "REGRESSION FIX — bash -xc 결합 단축옵션 우회" },
	{ command: 'bash -o errexit -c "pnpm test --all"', expect: "deny", note: "REGRESSION FIX — bash -o errexit -c 값-분리 옵션 우회" },
	{
		command: 'bash --rcfile /dev/null -c "pnpm test --all"',
		expect: "deny",
		note: "REGRESSION FIX — bash --rcfile /dev/null -c 값-분리 옵션 우회",
	},
	{
		command: 'bash --rcfile /dev/null -c "npx vitest"',
		expect: "deny",
		note: "REGRESSION FIX — 같은 래퍼 우회 안쪽이 via(npx)+러너(vitest) 조합인 경우",
	},
	{
		command: 'env -- bash -c "pnpm test --all"',
		expect: "deny",
		note: "REGRESSION FIX — env -- 로 감싼 뒤 다시 bash -c 로 감싼 이중 래퍼 우회",
	},
	{
		command: 'bash --noprofile -c "env -- pnpm test --all"',
		expect: "deny",
		note: "REGRESSION FIX — bash --noprofile -c 로 감싼 뒤 다시 env -- 로 감싼 이중 래퍼 우회",
	},

	// --- 오차단 회귀 없음 — 래퍼 flat-스캔 fallback이 새로 켜졌을 때도 아래는
	// 전부 passthrough 여야 한다 ---
	{
		command: "pnpm start -- test",
		expect: "passthrough",
		note: "fallback 트리거 목록에 pnpm을 넣었다면 -- 뒤 test 를 오탐했을 명령 — pnpm은 트리거 목록에서 제외되어 fallback 자체가 발동하지 않음",
	},
	{ command: "env", expect: "passthrough", note: "래퍼 단독 호출 — flat-스캔이 발동해도 pnpm/러너 단어가 전혀 없음" },
	{
		command: "command -v pnpm",
		expect: "passthrough",
		note: "pnpm 단어가 있어도 그 뒤에 entrypoints 단어가 없어 조건 2가 성립하지 않음",
	},
	{ command: 'bash -lc "git status"', expect: "passthrough", note: "래퍼 안쪽이 검증 명령과 무관 — flat-스캔 조건 전부 불성립" },
	{
		command: "npx --yes create-react-app myapp",
		expect: "passthrough",
		note: "via(npx) 뒤 러너 이름이 없음 — flat-스캔도 기존 (b) 판정과 동일하게 시도로 보지 않음",
	},
	{
		command: 'pnpm test admin -- -t "결제|환불"',
		expect: "passthrough",
		note: "최우선 회귀 가드 — 첫 토큰이 pnpm이라 fallback 자체가 발동하지 않고, 기존 (c)+shape 판정 그대로 통과",
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

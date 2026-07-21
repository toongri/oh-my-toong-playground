import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * verify-entrypoint-gate — a PreToolUse (Bash matcher) hook engine that
 * replaces verify-caps-gate. It no longer injects anything (no memory/
 * concurrency caps, no `permissionDecision: "allow"`); it only ever answers
 * "deny" or says nothing at all (passthrough). The allowed shape is exactly
 * one thing:
 *
 *   pnpm <entrypoint> [<app name>] [<allowed_turbo_opts>...] [-- <runner args>]
 *
 * where `<entrypoint>` is drawn from `entrypoints ∩ root package.json.scripts`
 * — the policy yaml's declared list intersected with what the target repo's
 * root package.json actually exposes right now. Neither side alone is the
 * whitelist: package.json alone would auto-allow any future risky script
 * (e.g. a `test:all`), and the policy list alone drifts the moment the repo
 * renames or removes a script (the verify:quick/verify:full removal that
 * prompted this rewrite).
 *
 * Judgment order (first match wins):
 *   1. Is this command a verification attempt at all — a `pnpm`/`turbo`
 *      entrypoint-family script invocation, a direct `runners` call, or a
 *      `via`-executor call reaching a `runners` name? If not → passthrough,
 *      untouched, regardless of anything else about the command (this is
 *      what keeps `pnpm start`/`seed`/`build`/`install`/etc. unaffected).
 *   2. Is the verification attempt mixed into a compound command (`&&`,
 *      `||`, `|`, `;`, newline, backtick, `$(...)`)? → deny. Splitting is
 *      quote-aware (a delimiter inside a quoted span, e.g. the `|` in
 *      `-t "결제|환불"`, is literal text, not a separator) for everything
 *      except backtick/`$(` (checked on the raw text regardless of quoting,
 *      since both still expand inside double quotes — fail-closed there is
 *      correct, not a false positive). There is no `allow` path left to make
 *      injection-then-cap safe on a compound command, so compounds carrying
 *      a verification attempt are rejected outright rather than risking one
 *      segment's outcome leaking into the next.
 *   3. Walk up from `cwd` looking for `pnpm-workspace.yaml`. Not found →
 *      deny (fail-closed: an undeterminable whitelist must not collapse to
 *      "allowed", or `cd /tmp && npx vitest` becomes a free bypass).
 *   4. `cwd` must BE that workspace root, not a subdirectory of it (running
 *      from `apps/admin` bypasses the shape check other rules assume).
 *   5. Compute `entrypoints ∩ package.json.scripts` — this run's real
 *      whitelist.
 *   6. Does the command match the allowed shape exactly, using that
 *      whitelist? If not → deny.
 *   7. The deny reason for step 6 lists step 5's intersection dynamically —
 *      never a hardcoded script name (a hardcoded name going stale is
 *      exactly what caused the incident this gate redesign responds to).
 */

// -----------------------------------------------------------------------------
// Policy — a flat set of whitelists (no per-runner records, no env/flag
// injection fields). See verify-entrypoint-gate.yaml for what each list means.
// -----------------------------------------------------------------------------
export type Policy = {
	entrypoints: string[];
	allowedTurboOpts: string[];
	runners: string[];
	via: string[];
};

export type DecideInput = {
	command: string;
	cwd: string;
	// Already-resolved by the thin fs-touching outer layer (findWorkspaceRoot /
	// readPackageScripts) — decide() itself never touches the filesystem, so
	// the whole judgment table can run against plain data.
	workspaceRoot: string | null;
	scripts: string[];
	entrypoints: string[];
	allowedTurboOpts: string[];
	runners: string[];
	via: string[];
};

export type DecideResult = { decision: "deny"; reason: string } | { decision: "passthrough" };

// -----------------------------------------------------------------------------
// Pure decide core — no file I/O, no process access. Implements judgment
// steps 1–7 from the header comment in order, first match wins.
// -----------------------------------------------------------------------------
export function decide(input: DecideInput): DecideResult {
	const segments = splitSegments(input.command);
	const isAttempt = segments.some((segment) =>
		isVerificationAttemptSegment(segment, input.entrypoints, input.runners, input.via),
	);
	if (!isAttempt) {
		return { decision: "passthrough" };
	}

	if (isCompound(input.command)) {
		return {
			decision: "deny",
			reason:
				"검증 명령은 다른 명령과 `&&`·`||`·`|`·`;`·개행·백틱·`$()`로 조합해서 실행할 수 없습니다. 검증 명령만 단독으로 실행하세요.",
		};
	}

	if (input.workspaceRoot === null) {
		return {
			decision: "deny",
			reason: "워크스페이스 루트(pnpm-workspace.yaml)를 찾을 수 없어 허용된 진입점을 판단할 수 없습니다. pnpm 워크스페이스 안에서 실행하세요.",
		};
	}

	if (input.cwd !== input.workspaceRoot) {
		return {
			decision: "deny",
			reason: `검증 명령은 워크스페이스 루트(${input.workspaceRoot})에서만 실행할 수 있습니다. 현재 위치: ${input.cwd}`,
		};
	}

	const intersection = input.entrypoints.filter((entrypoint) => input.scripts.includes(entrypoint));
	if (matchesAllowedShape(input.command, intersection, input.allowedTurboOpts)) {
		return { decision: "passthrough" };
	}

	return { decision: "deny", reason: buildShapeMismatchReason(intersection, input.allowedTurboOpts) };
}

function buildShapeMismatchReason(intersection: string[], allowedTurboOpts: string[]): string {
	if (intersection.length === 0) {
		return "이 워크스페이스의 package.json에는 정책의 진입점(entrypoints)과 일치하는 스크립트가 없어 어떤 검증 명령도 허용되지 않습니다.";
	}
	const opts = allowedTurboOpts.length > 0 ? allowedTurboOpts.join("/") : "(없음)";
	return `허용된 검증 명령 형태는 다음뿐입니다: pnpm <${intersection.join("|")}> [앱이름] [${opts}] [-- 러너 인자...]`;
}

// -----------------------------------------------------------------------------
// Step 1 — is this segment a verification attempt? Three independent checks,
// any one match is enough:
//   (a) direct runner call — segment's first token is literally a `runners`
//       name (vitest, turbo, pytest, ...).
//   (b) via-executor call — segment starts with a `via` prefix and the token
//       right after it is a `runners` name (`npx vitest`, `pnpm exec jest`),
//       or (node_modules/.bin special case) the first token's path basename
//       is a `runners` name (`./node_modules/.bin/vitest`).
//   (c) pnpm entrypoint-family script — segment's first token is `pnpm` and
//       ANY later token (before a `--` end-of-options marker) exactly equals
//       one of `entrypoints`. This is intentionally coarse (any position, not
//       just immediately after `pnpm`) so that `pnpm -r test`, `pnpm --filter
//       x test` etc. still register as verification attempts and reach the
//       strict shape check in step 6 — which is where "flag before the
//       script name" actually gets rejected. Being coarse here only affects
//       which HALF of the pipeline (attempt-detection vs shape-match) catches
//       a given bypass; a false positive here just means step 6 also has to
//       reject it, which it already does for anything not exactly matching
//       the allowed shape.
// -----------------------------------------------------------------------------
function isVerificationAttemptSegment(segment: string, entrypoints: string[], runners: string[], via: string[]): boolean {
	const normalized = stripAfterEndOfOptions(stripLeadingEnvAssignments(segment));
	const tokens = tokenize(normalized);
	if (tokens.length === 0) return false;

	const first = tokens[0];
	if (runners.includes(first)) return true;

	if (via.includes("node_modules/.bin")) {
		const match = /(^|\/)node_modules\/\.bin\/([^/]+)$/.exec(first);
		if (match !== null && runners.includes(match[2])) return true;
	}

	for (const entry of via) {
		if (entry === "node_modules/.bin") continue;
		const words = entry.trim().split(/\s+/);
		const isPrefixMatch = words.every((word, i) => tokens[i] === word);
		if (isPrefixMatch && runners.includes(tokens[words.length] ?? "")) return true;
	}

	if (first === "pnpm") {
		for (const tok of tokens.slice(1)) {
			if (entrypoints.includes(tok)) return true;
		}
	}

	return false;
}

// -----------------------------------------------------------------------------
// Step 6 — the ONLY allowed shape:
//   pnpm <entrypoint> [<positional>] [<allowedTurboOpts flags>...] [-- ...]
// - `pnpm` must be the first token and the entrypoint name must sit
//   IMMEDIATELY after it — any token in between (a flag or otherwise) fails,
//   which is what rejects `-r`, `--recursive`, `--filter`, `-F`, `-w`, ...:
//   they all occupy the slot the entrypoint name must be in.
// - after the entrypoint name and before a `--` marker: `--all` fails
//   outright; any other `-`-prefixed token must be in allowedTurboOpts; any
//   non-flag token counts as a positional (app-name) argument, and there can
//   be at most one.
// - anything after `--` is the runner's own selector and is not inspected.
// -----------------------------------------------------------------------------
function matchesAllowedShape(command: string, intersection: string[], allowedTurboOpts: string[]): boolean {
	const before = stripAfterEndOfOptions(stripLeadingEnvAssignments(command));
	const tokens = tokenize(before);
	if (tokens[0] !== "pnpm") return false;
	if (tokens.length < 2) return false;

	const entrypoint = tokens[1];
	if (!intersection.includes(entrypoint)) return false;

	let positionalCount = 0;
	for (let i = 2; i < tokens.length; i++) {
		const tok = tokens[i];
		if (tok === "--all") return false;
		if (tok.startsWith("-")) {
			if (!allowedTurboOpts.includes(tok)) return false;
		} else {
			positionalCount++;
			if (positionalCount > 1) return false;
		}
	}
	return true;
}

// -----------------------------------------------------------------------------
// Shell normalization helpers — ported from verify-caps-gate/index.ts, whose
// comments record the shapes that broke naive versions of these in the past.
// -----------------------------------------------------------------------------

// Quote-aware split on &&/||/|/;/newline/bare-& — a delimiter inside a quoted
// span is literal text, not a shell separator (e.g. the `|` in
// `echo "a | turbo run test b"`), and must not be split on.
function splitSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	let i = 0;
	while (i < command.length) {
		const ch = command[i];
		if (quote !== null) {
			current += ch;
			if (ch === quote) quote = null;
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			current += ch;
			i++;
			continue;
		}
		if ((ch === "&" || ch === "|") && command[i + 1] === ch) {
			segments.push(current);
			current = "";
			i += 2;
			continue;
		}
		if (ch === "&" || ch === "|" || ch === ";" || ch === "\n") {
			segments.push(current);
			current = "";
			i++;
			continue;
		}
		current += ch;
		i++;
	}
	segments.push(current);
	return segments;
}

// `&` (bare background marker) is included alongside `&&`, plus backtick and
// `$(` (command substitution) — none of these leave a single command the
// gate fully controls, so any of them mixed with a verification attempt
// denies outright (there is no `allow` path left to make injection safe on a
// compound, unlike the old gate).
//
// Delegates the &&/||/|/;/newline/bare-& axis to splitSegments so there is
// exactly one quote-aware split implementation in this file, not two that
// can drift apart — a prior version of this function re-implemented that
// axis as a bare regex with no quote awareness, so `-t "결제|환불"` (a
// literal `|` inside a quoted vitest -t pattern) was misread as a pipe and
// false-denied even though splitSegments (used one call site over, for
// attempt-detection) correctly treated it as one segment. Backtick and `$(`
// stay a raw-text scan on purpose (not folded into splitSegments): both
// still expand inside double quotes, so denying on their mere presence
// regardless of quoting is the fail-closed-correct call, not a bug to fix.
function isCompound(command: string): boolean {
	return splitSegments(command).length > 1 || /`|\$\(/.test(command);
}

// A scope/turbo flag written AFTER a segment's `--` end-of-options marker is
// a positional arg forwarded to the runner, not the runner's own flag (e.g.
// `turbo run test -- --affected` passes `--affected` to the test task, not to
// turbo) — so content after `--` must never be inspected. Cuts the segment at
// its first end-of-options marker.
function stripAfterEndOfOptions(segment: string): string {
	const marker = /(^|\s)--(\s|$)/.exec(segment);
	return marker === null ? segment : segment.slice(0, marker.index);
}

function stripLeadingEnvAssignments(segment: string): string {
	let s = segment.replace(/^\s+/, "");
	// Value side is quote-aware: a double- or single-quoted value (which may
	// itself contain spaces, e.g. NODE_OPTIONS="--a --b") is matched whole,
	// falling back to a plain \S* run for an unquoted value.
	const envPrefixRe = /^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*) +/;
	while (envPrefixRe.test(s)) {
		s = s.replace(envPrefixRe, "");
	}
	return s;
}

function tokenize(text: string): string[] {
	return text.trim().split(/\s+/).filter((tok) => tok.length > 0);
}

// -----------------------------------------------------------------------------
// Filesystem-touching outer layer — workspace root discovery and script
// listing. decide() never calls these; the caller resolves them once and
// passes plain data in, which is what keeps decide() testable without a
// filesystem.
// -----------------------------------------------------------------------------
export function findWorkspaceRoot(startDir: string): string | null {
	let dir = resolve(startDir);
	while (true) {
		if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export function readPackageScripts(workspaceRoot: string): string[] {
	try {
		const raw = readFileSync(join(workspaceRoot, "package.json"), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (isRecord(parsed) && isRecord(parsed.scripts)) {
			return Object.keys(parsed.scripts);
		}
		return [];
	} catch {
		return [];
	}
}

// -----------------------------------------------------------------------------
// Config loading — base (this module's own directory, committed) + local
// (the TARGET WORKSPACE ROOT's `.claude/scripts/verify-entrypoint-gate/`,
// deployed there as a project overlay) merged one key at a time: a key local
// declares replaces base's whole array for that key; a key local omits falls
// through to base. `localDir` has no static default — it depends on the
// workspace root resolved from `cwd`, so callers pass it explicitly (or omit
// it to get base-only, e.g. when no workspace root was found at all).
// -----------------------------------------------------------------------------
export function loadConfig(
	baseDir: string = fileURLToPath(new URL(".", import.meta.url)),
	localDir?: string,
): Policy {
	const base = readYamlObject(join(baseDir, "verify-entrypoint-gate.yaml"));
	const local = localDir === undefined ? {} : readYamlObject(join(localDir, "verify-entrypoint-gate.local.yaml"));

	return {
		entrypoints: pickList(local, base, "entrypoints"),
		allowedTurboOpts: pickList(local, base, "allowed_turbo_opts"),
		runners: pickList(local, base, "runners"),
		via: pickList(local, base, "via"),
	};
}

function pickList(local: Record<string, unknown>, base: Record<string, unknown>, key: string): string[] {
	if (Array.isArray(local[key])) return toStringArray(local[key]);
	return toStringArray(base[key]);
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readYamlObject(path: string): Record<string, unknown> {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return {};
	}
	try {
		const parsed: unknown = Bun.YAML.parse(raw);
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

// -----------------------------------------------------------------------------
// PreToolUse IO contract — parses the hook's stdin JSON (which includes
// `cwd`, the Bash tool's working directory — see docs.claude.com/en/docs/
// claude-code/hooks), resolves the workspace root + package.json scripts for
// that cwd, calls decide(), and formats the output envelope. There is no
// "allow" envelope anywhere in this file: a deny produces a permissionDecision
// deny envelope, everything else produces "" (no hook output at all, i.e. the
// tool call proceeds through the harness's normal permission flow untouched).
// -----------------------------------------------------------------------------
type PreToolUseInput = {
	tool_name?: unknown;
	tool_input?: { command?: unknown };
	cwd?: unknown;
};

export function processHookInput(
	raw: string,
	baseDir: string = fileURLToPath(new URL(".", import.meta.url)),
): string {
	try {
		const input: PreToolUseInput = JSON.parse(raw);
		if (input.tool_name !== "Bash") return "";

		const command = input.tool_input?.command;
		if (typeof command !== "string" || command.trim().length === 0) return "";

		const cwd = typeof input.cwd === "string" && input.cwd.length > 0 ? resolve(input.cwd) : resolve(process.cwd());

		const workspaceRoot = findWorkspaceRoot(cwd);
		const localDir = workspaceRoot === null ? undefined : join(workspaceRoot, ".claude", "scripts", "verify-entrypoint-gate");
		const policy = loadConfig(baseDir, localDir);
		const scripts = workspaceRoot === null ? [] : readPackageScripts(workspaceRoot);

		const result = decide({
			command,
			cwd,
			workspaceRoot,
			scripts,
			entrypoints: policy.entrypoints,
			allowedTurboOpts: policy.allowedTurboOpts,
			runners: policy.runners,
			via: policy.via,
		});

		if (result.decision === "deny") {
			return JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "deny",
					permissionDecisionReason: result.reason,
				},
			});
		}
		return "";
	} catch {
		return "";
	}
}

async function readStdin(): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
		process.stdin.on("error", () => resolve(""));
	});
}

export async function main(): Promise<void> {
	try {
		const raw = await readStdin();
		const output = processHookInput(raw);
		if (output.length > 0) {
			// eslint-disable-next-line no-console -- PreToolUse 훅 stdout 프로토콜
			console.log(output);
		}
	} catch {
		// never throw or block the tool call — a hook crash must not break Bash.
	}
}

if (import.meta.main) {
	main();
}

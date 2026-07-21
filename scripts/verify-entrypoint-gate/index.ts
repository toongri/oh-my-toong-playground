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
 *   1. Is this command a verification attempt at all — a `pnpm`/`npm`/`yarn`
 *      entrypoint-family script invocation, a direct `runners` call, a
 *      `via`-executor call reaching a `runners` name, or any of those hidden
 *      behind a transparent wrapper (`command`/`env`, peeled off) or a nested
 *      shell (`bash -c "..."`/`sh -c '...'`/`eval "..."`, whose inner command
 *      is extracted and re-checked)? Token comparisons are quote/backslash-
 *      normalized first (`p'n'pm`, `"pnpm"`, `\pnpm` all read as `pnpm`), so
 *      obfuscating the token doesn't change the answer. If none of this
 *      matches → passthrough, untouched, regardless of anything else about
 *      the command (this is what keeps `pnpm start`/`seed`/`build`/`install`
 *      /etc. unaffected).
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
 *      whitelist? A wrapper (`command`/`env`/`bash -c`/`eval`/...) can make
 *      step 1 detect an attempt without ever making step 6's shape match —
 *      the wrapper tokens themselves occupy the position `pnpm` must be in —
 *      so a wrapped verification attempt always denies here even when the
 *      unwrapped inner command would itself have been allowed. That's
 *      intended: the wrapper is a self-inflicted, trivially-dropped bypass
 *      attempt, not an unrecoverable false deny (drop the wrapper, run the
 *      inner command directly).
 *   7. The deny reason for step 6 lists step 5's intersection dynamically —
 *      never a hardcoded script name (a hardcoded name going stale is
 *      exactly what caused the incident this gate redesign responds to).
 *
 * Known unclosed gap, by design: shell variable/parameter expansion (e.g.
 * `pnpm${IFS}test --all`, `$P npm test`) is invisible to this file — the
 * gate only ever sees the literal argv text, never what the shell expands it
 * to at runtime. No finite static rule closes this without a false-deny cost
 * on ordinary commands: e.g. "deny when the first token contains `$`" also
 * denies `$EDITOR notes.md`. And this gate has no escape hatch (no bypass
 * token, no `ask` fallback) — a false deny here is unrecoverable for the
 * user, which is the exact failure class the compound-detection fix in this
 * same file was written to eliminate, not reintroduce. See
 * `scripts/verify-entrypoint-gate/` in CLAUDE.md for the one-line summary.
 *
 * Wrapper flat-scan fallback (step 1's tail case, when (a)/(b)/(c) all
 * fail): `stripLeadingTransparentWrappers` only peels a bare `command`/`env`
 * word, and `nestedShellInnerCommand` only recognizes a single exact
 * `-c <rest>` argument — neither handles a wrapper option shaped any other
 * way (`env --`, `env -u PATH`, `env -S "..."`, `bash -lc "..."` combined
 * short flags, `bash -x -c "..."` multi-flag, `bash --rcfile /dev/null -c
 * "..."`), so those segments fall through (a)/(b)/(c) unexamined and would
 * otherwise reach `return false` untouched. When that happens AND the
 * segment's first token is one of a fixed list of known wrapper names
 * (`env`, `command`, `bash`, `sh`, `zsh`, `eval`, `npx`, `bunx`), a flat scan
 * runs instead: quote characters are replaced with spaces (so a quoted span
 * doesn't collapse into one opaque token the way `tokenize()` would leave
 * it), the result is split on whitespace, and the word list is checked —
 * ignoring position beyond the stated ordering — for a `runners` name
 * anywhere, a `pnpm`/`npm`/`yarn` word followed later by an `entrypoints`
 * word, or a `via` name (`npx`/`bunx`, or the two consecutive words
 * `pnpm exec`/`pnpm dlx`) followed later by a `runners` name. No
 * per-wrapper option-arity table backs this: `env -u PATH` and
 * `bash -o errexit -c` take their option's value as a SEPARATE following
 * token (space-joined, not `=`-joined), so "skip tokens starting with `-`"
 * can't tell a flag from its value, and a table of exactly which flags on
 * which wrapper take a value would drift with shell/coreutils versions the
 * same way the removed verify:quick/verify:full policy drifted from
 * package.json. `pnpm`/`npm`/`yarn` are deliberately NOT wrapper trigger
 * names here: a flat scan doesn't cut at a `--` marker the way (c) above
 * does, so treating `pnpm` as a trigger would make `pnpm start -- test`
 * register as an attempt purely because the literal word `test` sits
 * somewhere in the text, false-denying an entrypoint-less script forwarding
 * its own `-- test` positional. Residual false-deny risk, accepted rather
 * than closed (the same tradeoff as the `$IFS`-expansion gap above): if a
 * nested-shell reduction fails for an unrelated reason and the leftover raw
 * text happens to contain a `pnpm`/`npm`/`yarn` word followed by an
 * `entrypoints` word, or a `runners` name, purely as inert text — e.g.
 * `bash -lc "echo 'run pnpm test as needed'"` — this scan denies it even
 * though no verification command is actually being run.
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
// Step 1 — is this segment a verification attempt? Before any of the checks
// below, the segment is unwrapped: leading env assignments AND a leading
// transparent wrapper (`command`/`env`, see stripLeadingTransparentWrappers)
// are peeled off, and if what's left is a nested shell invocation
// (`bash -c "..."`/`sh -c '...'`/`eval "..."`) the inner command string is
// extracted and this function recurses on it. Five independent checks on the
// unwrapped segment, any one match is enough:
//   (a) direct runner call — segment's first token is literally a `runners`
//       name (vitest, turbo, pytest, ...). Uses `tokens` (see below).
//   (b) via-executor call — segment starts with a `via` prefix, then skips
//       any number of `-`-prefixed tokens (executor flags, including a bare
//       `--`), and the first non-`-` token reached after that is a `runners`
//       name (`npx vitest`, `pnpm exec jest`, `bunx --bun vitest run`,
//       `npx --package=vitest -- vitest run`) — or (node_modules/.bin
//       special case) the first token's path basename is a `runners` name
//       (`./node_modules/.bin/vitest`). This is the one check that reads
//       `fullTokens` instead of `tokens` — see the note below for why.
//   (c) pnpm/npm/yarn entrypoint-family script — segment's first token is
//       `pnpm`, `npm`, or `yarn`, and ANY later token (before a `--`
//       end-of-options marker) exactly equals one of `entrypoints`. This is
//       intentionally coarse (any position, not just immediately after the
//       package-manager name) so that `pnpm -r test`, `pnpm --filter x test`
//       etc. still register as verification attempts and reach the strict
//       shape check in step 6 — which is where "flag before the script name"
//       (and "not pnpm at all") actually gets rejected. Being coarse here
//       only affects which HALF of the pipeline (attempt-detection vs
//       shape-match) catches a given bypass; a false positive here just
//       means step 6 also has to reject it, which it already does for
//       anything not exactly matching the allowed shape. Uses `tokens` (see
//       below), same as (a).
//
// Two token streams, not one: `tokens` is `stripAfterEndOfOptions(unwrapped)`
// tokenized — cut at the segment's first ` -- ` marker — and (a)/(c) use it
// unchanged. (b) alone uses `fullTokens` (`unwrapped` tokenized WITHOUT that
// cut), because `--` means the opposite thing depending on what precedes it:
// for a via-executor like `npx`, everything after `--` is the command npx
// itself goes on to run, and MUST be inspected (`npx --package=vitest --
// vitest run` really does launch vitest); for `pnpm <entrypoint>`, everything
// after `--` is the runner's own selector forwarded verbatim and must NEVER
// be inspected (inspecting it would false-deny the load-bearing
// `pnpm test admin -- -t "결제|환불"`). One cut can't be right for both, so
// (b) keeps its own uncut stream instead of sharing `tokens`. Residual risk,
// accepted rather than closed: a via flag whose value is space-separated
// instead of `=`-joined (`npx --package vitest some-tool`) reads the value
// `vitest` as the runner name and false-denies — no finite per-executor
// flag-arity table closes this without becoming the kind of speculative
// table this file avoids elsewhere.
// All token comparisons above run against tokenize()'s output, which is
// already quote/backslash-normalized — see normalizeToken.
// -----------------------------------------------------------------------------
function isVerificationAttemptSegment(segment: string, entrypoints: string[], runners: string[], via: string[]): boolean {
	const unwrapped = stripLeadingTransparentWrappers(stripLeadingEnvAssignments(segment));

	const nestedInner = nestedShellInnerCommand(unwrapped);
	if (nestedInner !== null) {
		return isVerificationAttemptSegment(nestedInner, entrypoints, runners, via);
	}

	const normalized = stripAfterEndOfOptions(unwrapped);
	const tokens = tokenize(normalized);
	if (tokens.length === 0) return matchesWrapperFlatScanFallback(segment, entrypoints, runners, via);

	const first = tokens[0];
	if (runners.includes(first)) return true;

	// (b) via-executor call — uses fullTokens (untruncated by
	// stripAfterEndOfOptions), not tokens. See the header comment above.
	const fullTokens = tokenize(unwrapped);

	if (via.includes("node_modules/.bin")) {
		const match = /(^|\/)node_modules\/\.bin\/([^/]+)$/.exec(fullTokens[0] ?? "");
		if (match !== null && runners.includes(match[2])) return true;
	}

	for (const entry of via) {
		if (entry === "node_modules/.bin") continue;
		const words = entry.trim().split(/\s+/);
		const isPrefixMatch = words.every((word, i) => fullTokens[i] === word);
		if (!isPrefixMatch) continue;
		let i = words.length;
		while (i < fullTokens.length && fullTokens[i].startsWith("-")) i++;
		if (runners.includes(fullTokens[i] ?? "")) return true;
	}

	if (first === "pnpm" || first === "npm" || first === "yarn") {
		for (const tok of tokens.slice(1)) {
			if (entrypoints.includes(tok)) return true;
		}
	}

	return matchesWrapperFlatScanFallback(segment, entrypoints, runners, via);
}

// -----------------------------------------------------------------------------
// Wrapper flat-scan fallback — see the header comment's dedicated paragraph
// above for the rationale (why no option-arity table, why pnpm/npm/yarn are
// excluded, and the accepted residual false-deny risk). Mechanics only here:
// this only runs once (a)/(b)/(c) above have already failed to classify the
// segment as an attempt, and only when the segment's first raw token is one
// of the fixed WRAPPER_FLAT_SCAN_TRIGGERS below — pnpm/npm/yarn are never in
// that list. The scan never tokenizes: quote characters are replaced with
// spaces first (so `bash -lc "pnpm test --all"`'s quoted span splits into
// separate words instead of collapsing into one opaque token under
// tokenize()), then the result is split on whitespace with no further
// normalization.
// -----------------------------------------------------------------------------
const WRAPPER_FLAT_SCAN_TRIGGERS = ["env", "command", "bash", "sh", "zsh", "eval", "npx", "bunx"];

function matchesWrapperFlatScanFallback(segment: string, entrypoints: string[], runners: string[], via: string[]): boolean {
	const words = segment
		.replace(/['"]/g, " ")
		.trim()
		.split(/\s+/)
		.filter((word) => word.length > 0);
	if (words.length === 0 || !WRAPPER_FLAT_SCAN_TRIGGERS.includes(words[0])) return false;

	if (words.some((word) => runners.includes(word))) return true;

	for (let i = 0; i < words.length; i++) {
		if (words[i] !== "pnpm" && words[i] !== "npm" && words[i] !== "yarn") continue;
		if (words.slice(i + 1).some((word) => entrypoints.includes(word))) return true;
	}

	for (const entry of via) {
		if (entry === "node_modules/.bin") continue;
		const entryWords = entry.trim().split(/\s+/);
		for (let i = 0; i + entryWords.length <= words.length; i++) {
			const isMatch = entryWords.every((word, j) => words[i + j] === word);
			if (!isMatch) continue;
			if (words.slice(i + entryWords.length).some((word) => runners.includes(word))) return true;
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
//   they all occupy the slot the entrypoint name must be in. This is also
//   what rejects `npm`/`yarn` and any transparent-wrapper/nested-shell prefix
//   (`command`/`env`/`bash -c`/`eval`/...) that step 1 unwraps to detect the
//   attempt in the first place — none of those first tokens is literally
//   `pnpm`, and this function deliberately does NOT do the same unwrapping,
//   so a wrapped attempt always fails the shape check (see the header
//   comment's step 6 note).
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

// A leading `command` or `env` word is a transparent wrapper — the shell
// still runs exactly the command that follows it (`command pnpm test --all`
// runs `pnpm test --all`, bypassing aliases/functions; `env pnpm test --all`
// does the same via the `env` utility with no assignment). Peeled off (raw
// word, quote/backslash-normalized before comparison) so step 1's
// attempt-detection sees through it. `env` may itself be followed by
// `NAME=value` assignments (`env FOO=1 pnpm test`), so
// stripLeadingEnvAssignments runs again after each strip — that's the
// "맞물려 동작" the wrapper and the assignment-stripper are required to do
// together. Looped in case wrappers stack. Deliberately NOT mirrored in
// matchesAllowedShape — see that function's comment for why a wrapped
// command must still fail the shape check even after this unwrap.
function stripLeadingTransparentWrappers(text: string): string {
	let s = text;
	while (true) {
		const match = /^\s*(\S+)(\s+|$)/.exec(s);
		if (match === null) break;
		const word = normalizeToken(match[1]);
		if (word !== "command" && word !== "env") break;
		s = stripLeadingEnvAssignments(s.slice(match[0].length));
	}
	return s;
}

// If `text` (already env/wrapper-stripped) is a nested-shell invocation —
// `bash -c "..."`, `sh -c '...'`, `zsh -c "..."`, or `eval "..."` — extracts
// the inner command string so the caller can recurse attempt-detection on
// it; returns null for anything else. Only a single outer layer of matching
// quotes is stripped off the extracted text (real shell quote-parsing is out
// of scope — this is a best-effort re-check for step 1, not a full shell
// parser); a malformed/unparseable extraction just means the inner recursive
// check finds no attempt, which is a passthrough, not a crash.
function nestedShellInnerCommand(text: string): string | null {
	const trimmed = text.replace(/^\s+/, "");
	const firstWordMatch = /^(\S+)\s+(.+)$/.exec(trimmed);
	if (firstWordMatch === null) return null;
	const first = normalizeToken(firstWordMatch[1]);
	const rest = firstWordMatch[2];

	if (first === "eval") return unwrapOuterQuotes(rest);

	if (first === "bash" || first === "sh" || first === "zsh") {
		const cMatch = /^-c\s+(.+)$/.exec(rest);
		return cMatch === null ? null : unwrapOuterQuotes(cMatch[1]);
	}

	return null;
}

function unwrapOuterQuotes(text: string): string {
	const t = text.trim();
	const isQuoted = t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"));
	return isQuoted ? t.slice(1, -1) : t;
}

// Strips `'`/`"`/`\` from a token before comparison — the obfuscation trick
// this closes is spelling `pnpm` as `p'n'pm`, `"pnpm"`, or `\pnpm`, all of
// which the shell reads as the literal word `pnpm`. Applied uniformly inside
// tokenize() so every comparison site (attempt-detection AND shape-match)
// normalizes identically — normalizing in only one of the two would create a
// NEW mismatch between them (an obfuscated-but-otherwise-valid command would
// register as an attempt without ever matching the allowed shape, a fresh
// false deny of the kind this whole file exists to avoid).
function normalizeToken(tok: string): string {
	return tok.replace(/['"\\]/g, "");
}

function tokenize(text: string): string[] {
	return text
		.trim()
		.split(/\s+/)
		.filter((tok) => tok.length > 0)
		.map(normalizeToken)
		.filter((tok) => tok.length > 0);
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

/**
 * Session runner — spawns a real `codex exec` invocation and captures raw
 * observations. Deliberately has no notion of pass/fail (see evaluate.ts):
 * its only job is turning one codex session into an Observation, or naming
 * why it couldn't.
 *
 * Split into pure parsing helpers (parseStdoutEvents, extractToolCalls,
 * extractFinalMessage, extractThreadId, parseBaseInstructions,
 * parseInjectedContext — no process or filesystem access) and impure
 * orchestration (checkCodexEnvironment, findRolloutFile, runSession). The
 * pure half is what lets tests exercise real captured fixture bytes
 * (tools/codex-probe/fixtures/) without spawning anything.
 */

import { glob } from "fs/promises";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { parseCodexVersion, assertCodexVersionAllowed } from "../lib/codex-version.ts";
import type { Observation, ObservedEvent, RunResult, SandboxMode, SessionConfig, ToolCallRecord } from "./types.ts";

/** Narrows `unknown` to a plain (non-null, non-array) object without an `as` assertion. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Pure parsing
// ---------------------------------------------------------------------------

/**
 * Parses `codex exec --json`'s stdout — one JSON object per line. Returns
 * null (not a throw) on any unparseable line: a malformed capture is a
 * measurement failure (exit 2 at the runSession/probe layer), not a crash.
 * Blank lines are skipped.
 */
export function parseStdoutEvents(rawStdout: string): ObservedEvent[] | null {
	const events: ObservedEvent[] = [];
	for (const line of rawStdout.split("\n")) {
		if (line.trim().length === 0) continue;
		try {
			const parsed: unknown = JSON.parse(line);
			if (!isRecord(parsed)) return null;
			events.push(parsed);
		} catch {
			return null;
		}
	}
	return events;
}

/** Extracts `thread_id` from the stream's `thread.started` event. */
export function extractThreadId(events: ObservedEvent[]): string | null {
	const started = events.find((e) => e.type === "thread.started");
	const threadId = started?.thread_id;
	return typeof threadId === "string" ? threadId : null;
}

/**
 * Extracts non-text items (tool/command calls) from `item.completed` events —
 * everything except the plain-text `agent_message` item type.
 */
export function extractToolCalls(events: ObservedEvent[]): ToolCallRecord[] {
	const calls: ToolCallRecord[] = [];
	for (const event of events) {
		if (event.type !== "item.completed") continue;
		const item = event.item;
		if (!isRecord(item)) continue;
		const itemType = item.type;
		if (typeof itemType !== "string" || itemType === "agent_message") continue;
		calls.push({ itemType, item });
	}
	return calls;
}

/** Returns the LAST `agent_message` item's text, or null if none was emitted. */
export function extractFinalMessage(events: ObservedEvent[]): string | null {
	let last: string | null = null;
	for (const event of events) {
		if (event.type !== "item.completed") continue;
		const item = event.item;
		if (!isRecord(item) || item.type !== "agent_message") continue;
		if (typeof item.text === "string") last = item.text;
	}
	return last;
}

/**
 * Extracts `session_meta.payload.base_instructions.text` — the actual bytes
 * injected into the model — from a rollout file's raw JSONL text. Returns
 * null if no session_meta record is found or the field is absent, so the
 * caller can treat that as a measurement failure rather than silently
 * proceeding with an empty string (which would make an "absent" judgment
 * vacuously pass).
 */
export function parseBaseInstructions(rolloutRaw: string): string | null {
	for (const line of rolloutRaw.split("\n")) {
		if (line.trim().length === 0) continue;
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(record) || record.type !== "session_meta") continue;
		if (!isRecord(record.payload)) return null;
		const baseInstructions = record.payload.base_instructions;
		if (!isRecord(baseInstructions)) return null;
		const text = baseInstructions.text;
		return typeof text === "string" ? text : null;
	}
	return null;
}

/**
 * Extracts every `response_item` message body with role `developer` or
 * `user` from a rollout file's raw JSONL text — the channel that actually
 * carries PER-SESSION injected content (project rules, AGENTS.md,
 * environment context), as distinct from `base_instructions` (the fixed
 * system prompt `parseBaseInstructions` reads). CONFIRMED defect this fixes:
 * a probe scoped to `baseInstructions` alone cannot see a literal that only
 * ever reaches the model via a developer/user response_item — see
 * types.ts's `injectedContext` field doc and evaluate.test.ts's regression
 * test for the real fixture that demonstrates it.
 *
 * Returns "" (not null, unlike parseBaseInstructions) when no session_meta/
 * response_item is found: `config.prompt` is always sent as a user-role
 * response_item, so an empty result only happens for a rollout that never
 * reached that point at all — a case parseBaseInstructions's own stricter
 * gate already turns into a measurement failure upstream in runSession,
 * before this function's result is ever consulted.
 */
export function parseInjectedContext(rolloutRaw: string): string {
	const chunks: string[] = [];
	for (const line of rolloutRaw.split("\n")) {
		if (line.trim().length === 0) continue;
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(record) || record.type !== "response_item") continue;
		const payload = record.payload;
		if (!isRecord(payload)) continue;
		const role = payload.role;
		if (role !== "developer" && role !== "user") continue;
		const content = payload.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (isRecord(part) && typeof part.text === "string") chunks.push(part.text);
		}
	}
	return chunks.join("\n");
}

// ---------------------------------------------------------------------------
// Impure orchestration
// ---------------------------------------------------------------------------

export type EnvironmentCheckResult = { ok: true } | { ok: false; reason: "codex-binary-missing" | "codex-version-not-allowlisted"; detail: string };

/**
 * Environment gate: codex must be installed and its version must be in
 * config.yaml's `codex-versions` allowlist, or the probe is unmeasurable
 * (AC: "이 머신 밖 환경" is explicitly out of scope, exit 2).
 */
export async function checkCodexEnvironment(allowedVersions: string[]): Promise<EnvironmentCheckResult> {
	let stdout: string;
	let exitCode: number;
	try {
		// env explicitly passed (not left to spawn's default): Bun's PATH
		// resolution otherwise caches PATH from process start, so a runtime PATH
		// override (a test stubbing `codex` on a temp dir PATH) would silently
		// resolve the REAL codex on the original PATH instead. See
		// tools/sync.ts's defaultFetchCodexVersion for the same gotcha.
		const proc = Bun.spawn(["codex", "--version"], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: process.env });
		// Stream reads live in the same try as the spawn itself: a read failure
		// (e.g. a broken pipe) is just as much "codex's status is unknown" as
		// the spawn call throwing outright, and both must return a RunResult
		// rather than let the exception escape this function's declared contract.
		[stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	} catch (err) {
		return { ok: false, reason: "codex-binary-missing", detail: err instanceof Error ? err.message : String(err) };
	}
	if (exitCode !== 0) {
		return { ok: false, reason: "codex-binary-missing", detail: `codex --version exited ${exitCode}` };
	}

	const version = parseCodexVersion(stdout);
	if (version === null) {
		return { ok: false, reason: "codex-version-not-allowlisted", detail: `unparseable version output: ${stdout}` };
	}
	try {
		assertCodexVersionAllowed(version, allowedVersions);
	} catch (err) {
		return { ok: false, reason: "codex-version-not-allowlisted", detail: err instanceof Error ? err.message : String(err) };
	}
	return { ok: true };
}

/** Locates the rollout file for `threadId` under `<codexHome>/sessions/**`. */
export async function findRolloutFile(threadId: string, codexHome: string): Promise<string | null> {
	const sessionsDir = path.join(codexHome, "sessions");
	try {
		for await (const match of glob(`**/*${threadId}.jsonl`, { cwd: sessionsDir })) {
			return path.join(sessionsDir, match);
		}
	} catch {
		return null;
	}
	return null;
}

export type RunnerOptions = {
	allowedVersions: string[];
	/** @default `${os.homedir()}/.codex` — override for hermetic tests. */
	codexHome?: string;
};

/**
 * Runs one codex session end-to-end: environment gate -> spawn `codex exec
 * --json` (stdin closed, so a non-tty run never hangs waiting for input) ->
 * parse stdout -> correlate + parse the rollout file for base_instructions ->
 * build an Observation. The timeout is implemented in-process (Promise.race
 * + proc.kill()) because this host has no `timeout`/`gtimeout` binary — a
 * shell `timeout` wrapper would break immediately here.
 */
export async function runSession(config: SessionConfig, opts: RunnerOptions): Promise<RunResult> {
	const envCheck = await checkCodexEnvironment(opts.allowedVersions);
	if (!envCheck.ok) {
		return { ok: false, reason: envCheck.reason, detail: envCheck.detail };
	}

	const sandbox: SandboxMode = config.sandbox ?? "read-only";
	const timeoutMs = config.timeoutMs ?? 60_000;
	const codexHome = opts.codexHome ?? path.join(os.homedir(), ".codex");

	const argv = [
		"codex",
		"exec",
		"--json",
		"--skip-git-repo-check",
		"-s",
		sandbox,
		"-C",
		config.cwd,
		...(config.extraArgs ?? []),
		config.prompt,
	];

	// config.env (see types.ts's SessionConfig.env doc): when set, built from an
	// explicit env ALLOWLIST rather than layered onto full process.env.
	// CONFIRMED defect (code-review): a probe setting config.env is asking for
	// HOME/CODEX_HOME isolation specifically (see probes/ultrawork-keyword-
	// injection, probes/rules-runtime-leak-absence) — spreading `...process.env`
	// underneath would silently reintroduce every OTHER ambient var the
	// isolation was meant to strip (CODEX_RULES_ENABLED_SOURCES,
	// CODEX_RULES_MAX_RULE_CHARS, OMT_DIR, XDG_*, CLAUDE_CONFIG_DIR, ...), each
	// capable of confounding the isolated session the exact same way this
	// developer machine's own ambient rules leaked in (see isolated-codex-
	// home.ts's header comment). Only PATH (to resolve the `codex` binary,
	// mirroring checkCodexEnvironment's own lookup) and TMPDIR are carried
	// automatically; config.env entries win on collision. When config.env is
	// absent, no isolation was requested, so process.env passes through
	// unmodified — byte-identical to this field's absence before it existed.
	const spawnEnv =
		config.env === undefined
			? process.env
			: {
					...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
					...(process.env.TMPDIR === undefined ? {} : { TMPDIR: process.env.TMPDIR }),
					...config.env,
				};

	let proc: Bun.ReadableSubprocess;
	try {
		// env explicitly passed — see the same note in checkCodexEnvironment.
		proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: spawnEnv });
	} catch (err) {
		return { ok: false, reason: "spawn-failed", detail: err instanceof Error ? err.message : String(err) };
	}

	const timedOut = { flag: false };
	const timer = setTimeout(() => {
		timedOut.flag = true;
		proc.kill();
	}, timeoutMs);

	let rawStdout: string;
	let stderr: string;
	let exitCode: number;
	try {
		[rawStdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
	} catch (err) {
		// A stream-read failure is still just "the session could not be
		// captured" — the same RunResult contract every other failure path in
		// this function returns, not an exception escaping it. If the timeout
		// timer already fired, its own proc.kill() is a plausible cause of the
		// read failure, so that's the more useful diagnosis to report.
		if (timedOut.flag) {
			return { ok: false, reason: "timeout", detail: `codex exec did not exit within ${timeoutMs}ms` };
		}
		return { ok: false, reason: "spawn-failed", detail: err instanceof Error ? err.message : String(err) };
	} finally {
		clearTimeout(timer);
	}

	if (timedOut.flag) {
		return { ok: false, reason: "timeout", detail: `codex exec did not exit within ${timeoutMs}ms` };
	}
	if (exitCode !== 0) {
		return { ok: false, reason: "spawn-failed", detail: `codex exec exited ${exitCode}` };
	}

	const events = parseStdoutEvents(rawStdout);
	if (events === null) {
		return { ok: false, reason: "output-parse-failed", detail: "stdout was not valid JSONL" };
	}

	const threadId = extractThreadId(events);
	if (threadId === null) {
		return { ok: false, reason: "output-parse-failed", detail: "no thread.started event in stdout" };
	}

	const rolloutPath = await findRolloutFile(threadId, codexHome);
	if (rolloutPath === null) {
		return { ok: false, reason: "output-parse-failed", detail: `no rollout file found for thread ${threadId}` };
	}

	let rolloutRaw: string;
	try {
		rolloutRaw = await fs.readFile(rolloutPath, "utf-8");
	} catch (err) {
		return { ok: false, reason: "output-parse-failed", detail: err instanceof Error ? err.message : String(err) };
	}

	const baseInstructions = parseBaseInstructions(rolloutRaw);
	if (baseInstructions === null) {
		return { ok: false, reason: "output-parse-failed", detail: "no base_instructions.text in rollout session_meta" };
	}

	const observation: Observation = {
		events,
		toolCalls: extractToolCalls(events),
		baseInstructions,
		injectedContext: parseInjectedContext(rolloutRaw),
		finalMessage: extractFinalMessage(events),
		rawStdout,
		stderr,
	};
	return { ok: true, observation };
}

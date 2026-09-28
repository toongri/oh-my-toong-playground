/**
 * session-ledger hook — one ledger format for Claude Code and Codex CLI.
 *
 *   PreCompact    → extract the transcript deterministically, have a headless
 *                   summarizer (gpt-6-sol) fill the ledger schema, validate,
 *                   retry with feedback, write ~/.omt/session-ledger/<sid>.md.
 *                   Runs synchronously: the user chose quality over speed.
 *   SessionStart  → after a compaction, inject the ledger's head plus an order
 *                   to read the whole file. Injection limits differ per
 *                   platform (Claude truncates ~10 KB, Codex ~10k chars).
 *
 * Usage: bun run index.ts [--platform claude|codex]   (hook payload on stdin)
 * Fail-open: any error leaves the session untouched and exits 0.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
	claudeWindowStart,
	codexWindowStart,
	extractClaude,
	extractCodex,
	findCodexRollout,
	isRecord,
	readTranscript,
	type WorkLog,
} from "./extract.ts";
import { codexRunner, type ModelRunner, WORKER_ENV, writeLedger } from "./ledger.ts";

export type Platform = "claude" | "codex";

interface HookInput {
	hook_event_name?: string;
	session_id?: string;
	transcript_path?: string | null;
	source?: string;
	agent_id?: string;
}

/** Below this size the whole session is summarized in one pass, the configuration the replays tested. */
const FULL_LOG_BYTES = 700_000;
/** The hook timeout (claude.yaml / codex.yaml) is 30 minutes; the summarizer must finish (or fall back) well before it. */
const WRITE_DEADLINE_MS = 1500_000;
/** Largest head injected at SessionStart; the rest is read from the file. */
const INJECT_BYTES: Record<Platform, number> = { claude: 7000, codex: 5000 };
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export function ledgerDir(home = homedir()): string {
	return join(home, ".omt", "session-ledger");
}

export function ledgerPath(sessionId: string, home = homedir()): string {
	return join(ledgerDir(home), `${sessionId.replace(/[^A-Za-z0-9._-]/g, "_")}.md`);
}

/** Whole session when it fits; otherwise the part after the last compaction plus the previous ledger. */
export function selectLog(
	platform: Platform,
	records: Record<string, unknown>[],
	previousLedger: string | undefined,
	sessionsRoot?: string,
): { log: WorkLog; previousLedger?: string } {
	const extract = (start: number) =>
		platform === "claude" ? extractClaude(records, start) : extractCodex(records, start, sessionsRoot);
	const full = extract(0);
	if (Buffer.byteLength(full.lines.join("\n")) <= FULL_LOG_BYTES || !previousLedger) return { log: full };
	const start = platform === "claude" ? claudeWindowStart(records) : codexWindowStart(records);
	return { log: extract(start), previousLedger };
}

function writeAtomic(path: string, text: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, text);
	renameSync(temp, path);
}

function pruneOld(dir: string, now = Date.now()): void {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		try {
			if (now - statSync(full).mtimeMs > RETENTION_MS) unlinkSync(full);
		} catch {
			// Another session may prune the same file concurrently.
		}
	}
}

function transcriptFor(platform: Platform, input: HookInput): string | null {
	if (input.transcript_path && existsSync(input.transcript_path)) return input.transcript_path;
	// Codex may send a null transcript_path; its rollout file is named after the session id.
	if (platform === "codex" && input.session_id) return findCodexRollout(input.session_id);
	return null;
}

export async function preCompact(
	platform: Platform,
	input: HookInput,
	options: { runModel?: ModelRunner; home?: string; sessionsRoot?: string; now?: number } = {},
): Promise<string | null> {
	const sessionId = input.session_id;
	const transcript = transcriptFor(platform, input);
	if (!sessionId || !transcript) return null;
	const path = ledgerPath(sessionId, options.home);
	const previous = existsSync(path) ? readFileSync(path, "utf8") : undefined;
	const { log, previousLedger } = selectLog(platform, readTranscript(transcript), previous, options.sessionsRoot);
	const result = await writeLedger({
		log,
		previousLedger,
		runModel: options.runModel ?? codexRunner(),
		deadline: (options.now ?? Date.now()) + WRITE_DEADLINE_MS,
	});
	writeAtomic(path, result.markdown);
	writeAtomic(
		path.replace(/\.md$/, ".meta.json"),
		`${JSON.stringify({ platform, status: result.status, attempts: result.attempts }, null, 1)}\n`,
	);
	pruneOld(ledgerDir(options.home));
	return path;
}

/** Cuts at a line boundary so the injected head never ends mid-sentence. */
export function headOf(text: string, maxBytes: number): { head: string; truncated: boolean } {
	if (Buffer.byteLength(text) <= maxBytes) return { head: text, truncated: false };
	const lines = text.split("\n");
	const kept: string[] = [];
	let size = 0;
	for (const line of lines) {
		const lineBytes = Buffer.byteLength(line) + 1;
		if (size + lineBytes > maxBytes) break;
		kept.push(line);
		size += lineBytes;
	}
	return { head: kept.join("\n"), truncated: true };
}

export function sessionStartContext(platform: Platform, input: HookInput, home?: string): string | null {
	// Only a compaction replaces the context; on startup/resume the history is still there.
	// Cache-safety: this output is session-varying, but after a compaction the prefix is rebuilt anyway,
	// so it evicts nothing; startup/resume (where the prefix is cached) stay static by returning null.
	if (input.source !== "compact" || !input.session_id) return null;
	const path = ledgerPath(input.session_id, home);
	if (!existsSync(path)) return null;
	const { head, truncated } = headOf(readFileSync(path, "utf8"), INJECT_BYTES[platform]);
	const order = truncated
		? `Before doing anything else, read the whole ledger file with a file-read command, to its last line: ${path}\nThe excerpt below is only its beginning; the rest holds decisions, rejected designs, gotchas, and every user message verbatim.`
		: `The complete ledger is below (also saved at ${path}).`;
	return [
		"[SESSION LEDGER]",
		"Your context was just compacted. This ledger was written from the full transcript before compaction, with every user quote and identifier checked against it. Where the compaction summary and this ledger disagree, trust the ledger.",
		order,
		"",
		head,
	].join("\n");
}

function parseHookInput(text: string): HookInput {
	const raw: unknown = JSON.parse(text);
	if (!isRecord(raw)) return {};
	const field = (key: string) => (typeof raw[key] === "string" ? raw[key] : undefined);
	return {
		hook_event_name: field("hook_event_name"),
		session_id: field("session_id"),
		transcript_path: field("transcript_path"),
		source: field("source"),
		agent_id: field("agent_id"),
	};
}

async function readStdin(): Promise<string> {
	let text = "";
	for await (const chunk of process.stdin) text += chunk;
	return text;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
	// The summarizer runs a nested Codex session that re-runs the user's hooks.
	if (process.env[WORKER_ENV]) return;
	const platform: Platform = argv[argv.indexOf("--platform") + 1] === "codex" ? "codex" : "claude";
	try {
		const input = parseHookInput((await readStdin()) || "{}");
		// Subagent threads compact on their own; their parent session keeps the ledger.
		if (input.agent_id) return;
		if (input.hook_event_name === "PreCompact") {
			// Claude appends PreCompact stdout to the summary instructions, so print nothing here.
			await preCompact(platform, input);
			return;
		}
		if (input.hook_event_name === "SessionStart") {
			const context = sessionStartContext(platform, input);
			if (context) {
				process.stdout.write(
					JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }),
				);
			}
		}
	} catch (error) {
		process.stderr.write(`session-ledger: ${error instanceof Error ? error.message : String(error)}\n`);
	}
}

if (import.meta.main) await main();

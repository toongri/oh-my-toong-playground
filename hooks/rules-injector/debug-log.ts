import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { debuglog } from "node:util";

type DebugFieldValue = boolean | number | string | null;

type DebugFields = Record<string, DebugFieldValue>;

const debug = debuglog("codex-rules");
const noopTimer = {
	lap: () => {},
	done: () => {},
} as const satisfies HookDebugTimer;

export interface HookDebugTimer {
	lap(phase: string, fields?: DebugFields): void;
	done(fields?: DebugFields): void;
}

export function createHookDebugTimer(hookName: string): HookDebugTimer {
	if (!debug.enabled) {
		return noopTimer;
	}

	const startMs = performance.now();
	let lastMs = startMs;

	return {
		lap: (phase, fields = {}) => {
			const nowMs = performance.now();
			writeDebugLine(hookName, phase, nowMs - lastMs, nowMs - startMs, fields);
			lastMs = nowMs;
		},
		done: (fields = {}) => {
			const nowMs = performance.now();
			writeDebugLine(hookName, "done", nowMs - lastMs, nowMs - startMs, fields);
			lastMs = nowMs;
		},
	};
}

function writeDebugLine(
	hookName: string,
	phase: string,
	durationMs: number,
	totalMs: number,
	fields: DebugFields,
): void {
	debug(
		"%s phase=%s ms=%s total_ms=%s%s",
		hookName,
		phase,
		durationMs.toFixed(3),
		totalMs.toFixed(3),
		formatFields(fields),
	);
}

function formatFields(fields: DebugFields): string {
	const entries = Object.entries(fields);
	if (entries.length === 0) {
		return "";
	}

	return ` ${entries.map(([key, value]) => `${key}=${String(value)}`).join(" ")}`;
}

/**
 * Resolves the error.log sink path, honoring `PLUGIN_DATA` when set so
 * `writeErrorBreadcrumb` and `rotateErrorLog` always agree on the same file.
 */
function resolveErrorLogSink(): string {
	const root = process.env["PLUGIN_DATA"] ?? join(homedir(), ".omt", "rules-injector");
	return join(root, "error.log");
}

/**
 * Always-on operator breadcrumb sink (advisory L2). Appends a timestamped line
 * to `~/.omt/rules-injector/error.log` so a swallowed hook-execution error stays
 * visible to the operator. Best-effort: never throws and never blocks the turn.
 */
export function writeErrorBreadcrumb(context: string, error: unknown): void {
	try {
		const sink = resolveErrorLogSink();
		mkdirSync(dirname(sink), { recursive: true });
		const detail =
			error instanceof Error
				? `${error.message}${error.stack ? `\n${error.stack}` : ""}`
				: String(error);
		appendFileSync(sink, `[${new Date().toISOString()}] ${context}: ${detail}\n`);
	} catch {
		// best-effort; the error sink must never throw or block the turn
	}
}

/**
 * Best-effort rotation for the error.log breadcrumb sink (D-5). If the log has
 * grown past `maxBytes`, truncate it to empty — no generation kept, no
 * rename/backup. Never throws; a missing file or stat/write fault is a silent
 * no-op, mirroring `writeErrorBreadcrumb`'s never-throw discipline.
 */
export function rotateErrorLog(maxBytes: number): void {
	try {
		const sink = resolveErrorLogSink();
		if (statSync(sink).size > maxBytes) {
			writeFileSync(sink, "");
		}
	} catch {
		// best-effort; rotation must never throw or block the turn
	}
}

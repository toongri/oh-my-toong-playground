import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as osSignals } from "node:os";
import { appendEvent, getSessionKey } from "./storage";
import { correlateCall, validateEvent, type Platform } from "./schema";

const SIGNALS: Record<string, { number: number; status: number }> = {
	SIGTERM: { number: osSignals.signals.SIGTERM ?? 15, status: 128 + (osSignals.signals.SIGTERM ?? 15) },
	SIGINT: { number: osSignals.signals.SIGINT ?? 2, status: 128 + (osSignals.signals.SIGINT ?? 2) },
};
function observedSignalNumber(signal: string | null): number {
	if (!signal) return 0;
	const value = Object.entries(osSignals.signals).find(([name]) => name === signal)?.[1];
	return typeof value === "number" ? value : 0;
}

function failBootstrap(message: string): never {
	throw new Error(`pretool-trace bootstrap: ${message}`);
}

function safeToolName(value: unknown): string {
	return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : "unknown";
}

function parsePayload(bytes: Buffer): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(bytes.toString("utf8"));
		return isRecord(value) ? value : {};
	} catch {
		return {};
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function sessionIdentity(payload: Record<string, unknown>): string | undefined {
	for (const value of [payload.session_id, process.env.OMT_SESSION_ID, process.env.CODEX_THREAD_ID]) {
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

function locator(identity: string): string {
	return createHash("sha256").update(`pretool-trace-key-locator:v1\0${identity}`).digest("hex");
}

function traceEvent(value: unknown): void {
	try { appendEvent(validateEvent(value)); } catch { /* trace is fail-open */ }
}

async function readStdin(): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

function childResult(child: ReturnType<typeof spawn>): Promise<{ code: number; signal: string | null }> {
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code, signal) => resolve({ code: typeof code === "number" ? code : 1, signal }));
	});
}

export function selectCorrelationInput(payload: Record<string, unknown>, identity: string | undefined, rawBytes: Uint8Array) {
	const toolUseId = identity && typeof payload.tool_use_id === "string" && payload.tool_use_id.length > 0 ? payload.tool_use_id : undefined;
	return { tool_use_id: toolUseId, tool_name: typeof payload.tool_name === "string" ? payload.tool_name : undefined, tool_input: payload.tool_input, raw_bytes: rawBytes };
}

async function main(): Promise<void> {
	const [platformArg, hookId, command] = process.argv.slice(2);
	if ((platformArg !== "claude" && platformArg !== "codex") || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(hookId ?? "") || command === undefined) {
		failBootstrap("expected <claude|codex> <hook_id> <original-command>");
	}
	const platform: Platform = platformArg === "claude" ? "claude" : "codex";
	const input = await readStdin();
	const payload = parsePayload(input);
	const enabled = process.env.OMT_HOOK_TRACE_ENABLED !== "0";
	const started = process.hrtime.bigint();
	const invocationId = randomUUID();
	let witnessed: keyof typeof SIGNALS | undefined;
	const childRef: { value?: ReturnType<typeof spawn> } = {};
	let correlation = "";
	let quality: "exact" | "fingerprint" = "fingerprint";

	if (enabled) {
		try {
			const identity = sessionIdentity(payload);
			if (identity) {
				const key = getSessionKey(locator(identity));
				if (key.byteLength !== 32) throw new Error("invalid session key");
				const selected = selectCorrelationInput(payload, identity, input);
				const toolUseId = selected.tool_use_id;
				quality = toolUseId && identity ? "exact" : "fingerprint";
				correlation = correlateCall(selected, key);
				const start = { schema_version: 1 as const, event: "pre_tool_use" as const, phase: "start" as const, timestamp: new Date().toISOString(), platform, hook_id: hookId, pid: process.pid, invocation_id: invocationId, call_correlation: correlation, correlation_quality: quality, tool_name: safeToolName(payload.tool_name) };
				traceEvent(start);
			}
		} catch { /* child execution is independent of tracing */ }
	}

	const forwardSignal = (name: keyof typeof SIGNALS) => {
		const child = childRef.value;
		if (!child?.pid) return;
		try { process.kill(-child.pid, name); } catch { try { process.kill(child.pid, name); } catch { /* already exited */ } }
	};
	const onSignal = (name: keyof typeof SIGNALS) => {
		if (witnessed) return;
		witnessed = name;
		forwardSignal(name);
	};
	process.on("SIGTERM", () => onSignal("SIGTERM"));
	process.on("SIGINT", () => onSignal("SIGINT"));

	const spawned = spawn("bash", ["-c", command], { detached: true, stdio: ["pipe", "inherit", "inherit"] });
	childRef.value = spawned;
	if (witnessed) forwardSignal(witnessed);
	spawned.stdin?.once("error", () => { /* child may close stdin before the payload is written */ });
	spawned.stdin?.end(input);
	let result: { code: number; signal: string | null };
	try { result = await childResult(spawned); } catch { result = { code: 1, signal: null }; }
	const observedStatus = witnessed ? SIGNALS[witnessed].status : Math.max(0, Math.min(255, result.signal ? 128 + observedSignalNumber(result.signal) : result.code));
	if (enabled && correlation) {
		const termination = witnessed ? "signal" : observedStatus <= 128 ? "exit" : "ambiguous";
		const end: Record<string, unknown> = { schema_version: 1, event: "pre_tool_use", phase: "end", timestamp: new Date().toISOString(), platform, hook_id: hookId, pid: process.pid, invocation_id: invocationId, call_correlation: correlation, correlation_quality: quality, tool_name: safeToolName(payload.tool_name), termination, process_status: observedStatus, duration_ms: Number((process.hrtime.bigint() - started) / 1_000_000n) };
		if (witnessed) { end.signal = SIGNALS[witnessed].number; end.signal_name = witnessed; }
		traceEvent(end);
	}
	process.exitCode = observedStatus;
}

if (import.meta.main) await main();

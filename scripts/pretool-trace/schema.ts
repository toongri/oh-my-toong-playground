import { createHmac } from "node:crypto";

export type Platform = "claude" | "codex";
export type CorrelationQuality = "exact" | "fingerprint";
export type StartEvent = {
	schema_version: 1; event: "pre_tool_use"; phase: "start"; timestamp: string;
	platform: Platform; hook_id: string; pid: number; invocation_id: string;
	call_correlation: string; correlation_quality: CorrelationQuality; tool_name: string;
};
export type EndEvent = Omit<StartEvent, "phase"> & {
	phase: "end"; termination: "exit" | "signal" | "ambiguous"; process_status: number;
	duration_ms: number; signal?: number; signal_name?: "SIGTERM" | "SIGINT";
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HOOK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TOOL_NAME = /^(?:[A-Za-z0-9_.:-]{1,128}|unknown)$/;
const CORRELATION = /^hmac-sha256:[0-9a-f]{64}$/;

const START_KEYS = ["schema_version", "event", "phase", "timestamp", "platform", "hook_id", "pid", "invocation_id", "call_correlation", "correlation_quality", "tool_name"];
const END_KEYS = [...START_KEYS, "termination", "process_status", "duration_ms", "signal", "signal_name"];

function keysExactly(value: Record<string, unknown>, allowed: string[], required: string[]): boolean {
	const keys = Object.keys(value).sort();
	return keys.every((key) => allowed.includes(key)) && required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validTimestamp(value: unknown): value is string {
	if (typeof value !== "string" || !RFC3339_MS.test(value)) return false;
	try {
		return new Date(value).toISOString() === value;
	} catch {
		return false;
	}
}

function validCommon(value: Record<string, unknown>, phase: "start" | "end"): boolean {
	if (!keysExactly(value, phase === "start" ? START_KEYS : END_KEYS, START_KEYS)) return false;
	if (value.schema_version !== 1 || value.event !== "pre_tool_use" || value.phase !== phase) return false;
	if (!validTimestamp(value.timestamp)) return false;
	if (value.platform !== "claude" && value.platform !== "codex") return false;
	if (typeof value.hook_id !== "string" || !HOOK_ID.test(value.hook_id)) return false;
	if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0) return false;
	if (typeof value.invocation_id !== "string" || !UUID_V4.test(value.invocation_id)) return false;
	if (typeof value.call_correlation !== "string" || !CORRELATION.test(value.call_correlation)) return false;
	if (value.correlation_quality !== "exact" && value.correlation_quality !== "fingerprint") return false;
	return typeof value.tool_name === "string" && TOOL_NAME.test(value.tool_name);
}

export function isValidStartEvent(value: unknown): value is StartEvent {
	return !!value && typeof value === "object" && validCommon(value as Record<string, unknown>, "start");
}

export function isValidEndEvent(value: unknown): value is EndEvent {
	if (!value || typeof value !== "object") return false;
	const event = value as Record<string, unknown>;
	if (!validCommon(event, "end")) return false;
	if (event.termination !== "exit" && event.termination !== "signal" && event.termination !== "ambiguous") return false;
	if (typeof event.process_status !== "number" || !Number.isInteger(event.process_status) || event.process_status < 0 || event.process_status > 255) return false;
	if (typeof event.duration_ms !== "number" || !Number.isFinite(event.duration_ms) || !Number.isInteger(event.duration_ms) || event.duration_ms < 0) return false;
	const hasSignal = Object.prototype.hasOwnProperty.call(event, "signal") || Object.prototype.hasOwnProperty.call(event, "signal_name");
	if (event.termination === "exit" && event.process_status > 128) return false;
	if (event.termination === "ambiguous" && (event.process_status < 129 || event.process_status > 255)) return false;
	if (event.termination === "signal") {
		return typeof event.signal === "number" && Number.isInteger(event.signal) && event.signal > 0 && (event.signal_name === "SIGTERM" || event.signal_name === "SIGINT");
	}
	return !hasSignal;
}

export function validateEvent(value: unknown): StartEvent | EndEvent {
	if (isValidStartEvent(value) || isValidEndEvent(value)) return value;
	throw new Error("invalid pre-tool trace event");
}

function canonical(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("unsupported canonical value");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
	}
	throw new TypeError("unsupported canonical value");
}

export type CorrelationInput = { tool_use_id?: string; tool_name?: string; tool_input?: unknown; raw_bytes?: Uint8Array };

export function correlateCall(input: CorrelationInput, sessionKey: Uint8Array): string {
	if (!(sessionKey instanceof Uint8Array) || sessionKey.byteLength !== 32) throw new Error("session key must be 32 bytes");
	let domain: string;
	let payload: Uint8Array | string;
	if (typeof input.tool_use_id === "string" && input.tool_use_id.length > 0) {
		domain = "exact\0";
		payload = input.tool_use_id;
	} else if (typeof input.tool_name === "string" && input.tool_input !== undefined) {
		domain = "fingerprint\0";
		try {
			payload = canonical({ tool_name: input.tool_name, tool_input: input.tool_input });
		} catch {
			domain = "raw\0";
			payload = input.raw_bytes instanceof Uint8Array ? input.raw_bytes : new Uint8Array(0);
		}
	} else if (input.raw_bytes instanceof Uint8Array) {
		domain = "raw\0";
		payload = input.raw_bytes;
	} else {
		domain = "raw\0";
		payload = new Uint8Array(0);
	}
	const hmac = createHmac("sha256", sessionKey).update(domain).update(payload).digest("hex");
	return `hmac-sha256:${hmac}`;
}

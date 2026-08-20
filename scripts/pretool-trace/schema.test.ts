import { describe, expect, test } from "bun:test";
import {
	correlateCall,
	isValidEndEvent,
	isValidStartEvent,
	validateEvent,
} from "./schema.ts";

const key = new Uint8Array(32).fill(7);
const common = {
	schema_version: 1,
	event: "pre_tool_use",
	phase: "start",
	timestamp: "2026-08-18T01:02:03.004Z",
	platform: "codex",
	hook_id: "pre-tool.enforcer_1",
	pid: 42,
	invocation_id: "550e8400-e29b-41d4-a716-446655440000",
	call_correlation: "hmac-sha256:" + "a".repeat(64),
	correlation_quality: "exact",
	tool_name: "Bash.exec_command",
} as const;

describe("pre-tool trace schema", () => {
	test("accepts an exact start event and rejects unknown keys", () => {
		expect(isValidStartEvent(common)).toBe(true);
		expect(isValidStartEvent({ ...common, extra: true })).toBe(false);
		for (const field of Object.keys(common)) {
			const missing = { ...common } as Record<string, unknown>;
			delete missing[field];
			expect(isValidStartEvent(missing)).toBe(false);
		}
		expect(() => validateEvent({ ...common, extra: true })).toThrow();
	});

	test("enforces end-only termination fields and signal pairing", () => {
		const end = {
			...common,
			phase: "end",
			termination: "signal",
			process_status: 143,
			duration_ms: 12,
			signal: 15,
			signal_name: "SIGTERM",
		};
		expect(isValidEndEvent(end)).toBe(true);
		expect(isValidEndEvent({ ...end, signal_name: "SIGHUP" })).toBe(false);
		expect(isValidEndEvent({ ...end, termination: "exit", signal: 15 })).toBe(false);
		expect(isValidEndEvent({ ...end, extra: true })).toBe(false);
		for (const field of ["schema_version", "event", "phase", "timestamp", "platform", "hook_id", "pid", "invocation_id", "call_correlation", "correlation_quality", "tool_name", "termination", "process_status", "duration_ms"]) {
			const missing = { ...end } as Record<string, unknown>;
			delete missing[field];
			expect(isValidEndEvent(missing)).toBe(false);
		}
		const { signal: _signal, signal_name: _signalName, ...withoutSignal } = end;
		for (const status of [0, 1, 2, 127, 128]) expect(isValidEndEvent({ ...withoutSignal, termination: "exit", process_status: status })).toBe(true);
		for (const status of [129, 255]) expect(isValidEndEvent({ ...withoutSignal, termination: "exit", process_status: status })).toBe(false);
		for (const status of [129, 255]) expect(isValidEndEvent({ ...withoutSignal, termination: "ambiguous", process_status: status })).toBe(true);
		for (const status of [0, 1, 128]) expect(isValidEndEvent({ ...withoutSignal, termination: "ambiguous", process_status: status })).toBe(false);
		expect(isValidEndEvent({ ...end, process_status: 0 })).toBe(true);
		expect(isValidEndEvent({ ...end, process_status: 255 })).toBe(true);
		expect(isValidEndEvent({ ...end, signal_name: undefined })).toBe(false);
		expect(isValidEndEvent({ ...end, signal: undefined })).toBe(false);
	});

	test("requires own exact fields and strict calendar/tool-name boundaries", () => {
		const inherited = Object.create(common) as Record<string, unknown>;
		for (const key of Object.keys(common).slice(1)) delete inherited[key];
		expect(isValidStartEvent(inherited)).toBe(false);
		expect(isValidStartEvent({ ...common, phase: "end" })).toBe(false);
		expect(isValidStartEvent({ ...common, timestamp: "2026-02-30T01:02:03.004Z" })).toBe(false);
		for (const tool_name of ["a", "a".repeat(128), "unknown"]) expect(isValidStartEvent({ ...common, tool_name })).toBe(true);
		for (const tool_name of ["", "a".repeat(129), "a b", "한글"]) expect(isValidStartEvent({ ...common, tool_name })).toBe(false);
		for (const field of ["schema_version", "event", "phase", "timestamp", "platform", "hook_id", "pid", "invocation_id", "call_correlation", "correlation_quality", "tool_name"]) {
			expect(isValidStartEvent({ ...common, [field]: null })).toBe(false);
		}
		const validEnd = { ...common, phase: "end", termination: "exit", process_status: 1, duration_ms: 0 };
		for (const field of ["termination", "process_status", "duration_ms"]) expect(isValidEndEvent({ ...validEnd, [field]: null })).toBe(false);
	});

	test("correlation is domain-separated, deterministic, and key-bound", () => {
		const exact = correlateCall({ tool_use_id: "toolu_123" }, key);
		expect(exact).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
		expect(correlateCall({ tool_use_id: "toolu_123" }, key)).toBe(exact);
		expect(correlateCall({ tool_use_id: "toolu_123" }, new Uint8Array(32).fill(8))).not.toBe(exact);
		const fp = correlateCall({ tool_name: "Bash", tool_input: { b: 2, a: 1 } }, key);
		expect(fp).toBe(correlateCall({ tool_name: "Bash", tool_input: { a: 1, b: 2 } }, key));
		expect(fp).not.toBe(exact);
		expect(correlateCall({ tool_name: "Bash", tool_input: { a: 1 } }, key)).not.toBe(correlateCall({ tool_name: "Bash", tool_input: { a: 1 } }, new Uint8Array(32).fill(8)));
		expect(correlateCall({ raw_bytes: new Uint8Array([1, 2, 3]) }, key)).toMatch(/^hmac-sha256:/);
		const nestedA = correlateCall({ tool_name: "Bash", tool_input: { z: { b: 2, a: 1 }, a: [3, { d: 4, c: 5 }] } }, key);
		const nestedB = correlateCall({ tool_name: "Bash", tool_input: { a: [3, { c: 5, d: 4 }], z: { a: 1, b: 2 } } }, key);
		expect(nestedA).toBe(nestedB);
		const raw = new Uint8Array([9, 8, 7]);
		const exactRaw = correlateCall({ tool_use_id: "sentinel", raw_bytes: raw }, key);
		const fpRaw = correlateCall({ tool_name: "Bash", tool_input: undefined, raw_bytes: raw }, key);
		const rawHash = correlateCall({ raw_bytes: raw }, key);
		expect(exactRaw).not.toBe(fpRaw);
		expect(fpRaw).toBe(rawHash);
		expect(fp).not.toBe(rawHash);
		for (const otherKey of [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)]) {
			expect(correlateCall({ tool_use_id: "sentinel" }, otherKey)).not.toBe(exact);
			expect(correlateCall({ tool_name: "Bash", tool_input: { a: 1 } }, otherKey)).not.toBe(fp);
			expect(correlateCall({ raw_bytes: raw }, otherKey)).not.toBe(rawHash);
		}
		const fallback = correlateCall({ tool_name: "Bash", tool_input: 1n, raw_bytes: new TextEncoder().encode("sentinel") }, key);
		expect(fallback).not.toContain("sentinel");
		const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
		expect(correlateCall({ tool_name: "Bash", tool_input: cyclic, raw_bytes: new Uint8Array([4]) }, key)).toBe(correlateCall({ raw_bytes: new Uint8Array([4]) }, key));
	});
});

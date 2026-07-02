import { describe, it, expect, afterEach } from "bun:test";
import { readStdin, parseInput } from "./stdin.ts";
import type { HookInput } from "./types.ts";
import { PassThrough } from "stream";

// Save original stdin
const originalStdin = process.stdin;

function mockStdin(data: string): void {
	const mockStream = new PassThrough();
	Object.defineProperty(process, "stdin", {
		value: mockStream,
		writable: true,
		configurable: true,
	});
	// Write data and end the stream
	mockStream.end(data);
}

function restoreStdin(): void {
	Object.defineProperty(process, "stdin", {
		value: originalStdin,
		writable: true,
		configurable: true,
	});
}

describe("readStdin", () => {
	afterEach(() => {
		restoreStdin();
	});

	it("should read stdin data as string", async () => {
		const input = '{"sessionId": "test-session", "cwd": "/test/dir"}';
		mockStdin(input);

		const result = await readStdin();

		expect(result).toBe(input);
	});

	it("should return empty string for empty input", async () => {
		mockStdin("");

		const result = await readStdin();

		expect(result).toBe("");
	});

	it("should handle multi-chunk input", async () => {
		const mockStream = new PassThrough();
		Object.defineProperty(process, "stdin", {
			value: mockStream,
			writable: true,
			configurable: true,
		});

		// Simulate chunked input
		mockStream.write('{"session');
		mockStream.write('Id": "chunked"}');
		mockStream.end();

		const result = await readStdin();

		expect(result).toBe('{"sessionId": "chunked"}');
	});
});

describe("parseInput", () => {
	it("should parse valid JSON with sessionId", () => {
		const input: HookInput = {
			sessionId: "session-123",
			cwd: "/test/dir",
			last_assistant_message: "some assistant message",
		};

		const result = parseInput(JSON.stringify(input));

		expect(result.sessionId).toBe("session-123");
		expect(result.directory).toBe("/test/dir");
		expect(result.lastAssistantMessage).toBe("some assistant message");
	});

	it("should support snake_case session_id", () => {
		const input: HookInput = {
			session_id: "session-456",
			cwd: "/test/dir",
		};

		const result = parseInput(JSON.stringify(input));

		expect(result.sessionId).toBe("session-456");
	});

	it("should prefer sessionId over session_id", () => {
		const input: HookInput = {
			sessionId: "preferred",
			session_id: "fallback",
			cwd: "/test/dir",
		};

		const result = parseInput(JSON.stringify(input));

		expect(result.sessionId).toBe("preferred");
	});

	it("should use default sessionId when not provided", () => {
		const input: HookInput = {
			cwd: "/test/dir",
		};

		const result = parseInput(JSON.stringify(input));

		expect(result.sessionId).toBe("default");
	});

	it("should use process.cwd() when cwd not provided", () => {
		const input: HookInput = {
			sessionId: "session-123",
		};

		const result = parseInput(JSON.stringify(input));

		expect(result.directory).toBe(process.cwd());
	});

	it("should set lastAssistantMessage to null when not provided", () => {
		const input: HookInput = {
			sessionId: "session-123",
			cwd: "/test/dir",
		};

		const result = parseInput(JSON.stringify(input));

		expect(result.lastAssistantMessage).toBeNull();
	});

	it("should handle invalid JSON gracefully with defaults", () => {
		const result = parseInput("{ invalid json }");

		expect(result.sessionId).toBe("default");
		expect(result.directory).toBe(process.cwd());
		expect(result.lastAssistantMessage).toBeNull();
	});

	it("should handle empty string with defaults", () => {
		const result = parseInput("");

		expect(result.sessionId).toBe("default");
		expect(result.directory).toBe(process.cwd());
		expect(result.lastAssistantMessage).toBeNull();
	});

	it("subagent running → activeSubagentCount 1", () => {
		const result = parseInput(
			JSON.stringify({ background_tasks: [{ id: "a", type: "subagent", status: "running" }] }),
		);
		expect(result.activeSubagentCount).toBe(1);
	});

	it("shell running → activeSubagentCount 0 (non-subagent not counted)", () => {
		const result = parseInput(
			JSON.stringify({ background_tasks: [{ id: "b", type: "shell", status: "running" }] }),
		);
		expect(result.activeSubagentCount).toBe(0);
	});

	it("subagent completed → activeSubagentCount 0 (non-active not counted)", () => {
		const result = parseInput(
			JSON.stringify({ background_tasks: [{ id: "c", type: "subagent", status: "completed" }] }),
		);
		expect(result.activeSubagentCount).toBe(0);
	});

	it("mixed: subagent running + shell running → activeSubagentCount 1", () => {
		const result = parseInput(
			JSON.stringify({
				background_tasks: [
					{ id: "d", type: "subagent", status: "running" },
					{ id: "e", type: "shell", status: "running" },
				],
			}),
		);
		expect(result.activeSubagentCount).toBe(1);
	});

	it("absent background_tasks → activeSubagentCount 0", () => {
		const result = parseInput(JSON.stringify({ sessionId: "test" }));
		expect(result.activeSubagentCount).toBe(0);
	});
});

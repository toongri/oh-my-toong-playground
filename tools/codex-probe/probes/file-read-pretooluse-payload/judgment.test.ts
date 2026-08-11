import { describe, expect, it } from "bun:test";

import { TARGET_FILE_NAME, type PreToolUsePayload } from "./fixture.ts";
import { inventoryPreToolUsePayloads, judgePreToolUsePayloads } from "./judgment.ts";

const payload = (tool_name: string, tool_input: Record<string, unknown>, extra: Record<string, unknown> = {}): PreToolUsePayload => ({
	hook_event_name: "PreToolUse",
	tool_name,
	tool_input,
	...extra,
});

describe("inventoryPreToolUsePayloads", () => {
	it("keeps every payload and raw input while sorting tool-input keys", () => {
		const first = payload("BespokeReader", { zeta: 1, alpha: { nested: true }, middle: ["x"] }, { request_id: "one" });
		const second = payload("bash", { path: TARGET_FILE_NAME });

		expect(inventoryPreToolUsePayloads([first, second])).toEqual([
		{ toolName: "BespokeReader", toolInputKeys: ["alpha", "middle", "zeta"], toolInput: first.tool_input, payload: first },
		{ toolName: "bash", toolInputKeys: ["path"], toolInput: second.tool_input, payload: second },
		]);
	});
});

describe("judgePreToolUsePayloads", () => {
	it("finds the target recursively without relying on a reader spelling or input key", () => {
		const captured = [
			payload("mystery_reader", { options: { files: [{ filename: TARGET_FILE_NAME }] } }),
			payload("exec_command", { command: "printf unrelated" }),
		];

		expect(judgePreToolUsePayloads(captured)).toMatchObject({
		kind: "pass",
		matchedPayloads: [expect.objectContaining({ toolName: "mystery_reader" })],
		hasNonShellMatchedPayload: true,
		});
		expect(judgePreToolUsePayloads(captured).inventory).toHaveLength(2);
	});

	it("recognizes the known shell family case-insensitively", () => {
		const captured = [
			payload("BASH", { command: TARGET_FILE_NAME }),
			payload("Exec_Command", { args: ["--file", TARGET_FILE_NAME] }),
			payload("shell_command", { nested: { path: TARGET_FILE_NAME } }),
		];

		const result = judgePreToolUsePayloads(captured);
		expect(result.kind).toBe("pass");
		expect(result.hasNonShellMatchedPayload).toBe(false);
	});

	it("returns a measured negative when valid payloads do not reference the target", () => {
		const result = judgePreToolUsePayloads([payload("reader", { path: "another-file.txt" })]);

		expect(result).toEqual({
		kind: "fail",
		inventory: [expect.objectContaining({ toolName: "reader" })],
		matchedPayloads: [],
		hasNonShellMatchedPayload: false,
		});
	});
});

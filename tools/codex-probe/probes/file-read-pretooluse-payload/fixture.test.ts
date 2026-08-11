import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

import {
	FILE_READ_PROMPT,
	TARGET_FILE_CONTENT,
	TARGET_FILE_NAME,
	parsePreToolUseCapture,
	writeTargetFile,
} from "./fixture.ts";

describe("writeTargetFile", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-read-pretooluse-fixture-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("writes the deterministic target content and returns its path", async () => {
		const targetPath = await writeTargetFile(tmpDir);

		expect(targetPath).toBe(path.join(tmpDir, TARGET_FILE_NAME));
		expect(await fs.readFile(targetPath, "utf8")).toBe(TARGET_FILE_CONTENT);
	});
});

describe("fixture constants", () => {
	it("asks the agent to read the target file and includes its deterministic name", () => {
		expect(FILE_READ_PROMPT).toContain(TARGET_FILE_NAME);
	});
});

describe("parsePreToolUseCapture", () => {
	it("returns any structurally valid PreToolUse payload while preserving all raw keys", () => {
		const payload = {
			hook_event_name: "PreToolUse",
			tool_name: "UnexpectedReaderName",
			tool_input: { path: TARGET_FILE_NAME },
			custom_key: { retained: true },
		};

		expect(parsePreToolUseCapture(`${JSON.stringify(payload)}\n`)).toEqual({ ok: true, payloads: [payload] });
	});

	it("distinguishes an invalid JSON line from a capture with no usable payload", () => {
		expect(parsePreToolUseCapture('{"hook_event_name":"PreToolUse"}\nnot-json')).toEqual({
			ok: false,
			reason: "invalid-json-line",
			line: 2,
		});
		expect(parsePreToolUseCapture('{"hook_event_name":"PostToolUse","tool_name":"x","tool_input":{}}')).toEqual({
			ok: false,
			reason: "no-valid-pretooluse-payload",
		});
	});
});

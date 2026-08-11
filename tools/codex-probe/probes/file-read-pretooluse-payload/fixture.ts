import fs from "fs/promises";
import path from "path";

/** Stable file name and bytes used to prove that a requested read occurred. */
export const TARGET_FILE_NAME = "codex-probe-file-read-target.txt";
export const TARGET_FILE_CONTENT = "FILE_READ_PRETOOLUSE_PAYLOAD_SENTINEL_7B3A2D\n";

/** Prompt used by the probe's entrypoint; deliberately does not name a tool. */
export const FILE_READ_PROMPT = `Read ${TARGET_FILE_NAME} and include its exact contents in your final response.`;

export type PreToolUsePayload = Record<string, unknown>;

export type CaptureParseResult =
	| { ok: true; payloads: PreToolUsePayload[] }
	| { ok: false; reason: "invalid-json-line"; line: number }
	| { ok: false; reason: "no-valid-pretooluse-payload" };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPreToolUsePayload(value: unknown): value is PreToolUsePayload {
	if (!isRecord(value)) return false;
	const eventName = value.hook_event_name ?? value.hookEventName;
	if (eventName !== "PreToolUse") return false;
	if (typeof value.tool_name !== "string" || value.tool_name.length === 0) return false;
	return isRecord(value.tool_input);
}

/** Writes the deterministic read target beneath `fixtureRoot` and returns its path. */
export async function writeTargetFile(fixtureRoot: string): Promise<string> {
	const targetPath = path.join(fixtureRoot, TARGET_FILE_NAME);
	await fs.mkdir(fixtureRoot, { recursive: true });
	await fs.writeFile(targetPath, TARGET_FILE_CONTENT, "utf8");
	return targetPath;
}

/**
 * Parses newline-delimited hook stdin captures. Every accepted object retains
 * its complete raw key set; tool_name is intentionally not constrained to a
 * particular reader implementation.
 */
export function parsePreToolUseCapture(rawCapture: string): CaptureParseResult {
	const payloads: PreToolUsePayload[] = [];
	const lines = rawCapture.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.trim().length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			return { ok: false, reason: "invalid-json-line", line: index + 1 };
		}
		if (isPreToolUsePayload(parsed)) payloads.push(parsed);
	}
	return payloads.length > 0 ? { ok: true, payloads } : { ok: false, reason: "no-valid-pretooluse-payload" };
}

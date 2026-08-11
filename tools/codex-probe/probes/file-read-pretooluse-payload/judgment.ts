import { TARGET_FILE_NAME, type PreToolUsePayload } from "./fixture.ts";

export type PayloadInventoryEntry = {
	toolName: string;
	toolInputKeys: string[];
	toolInput: Record<string, unknown>;
	payload: PreToolUsePayload;
};

export type PayloadJudgment = {
	kind: "pass" | "fail";
	inventory: PayloadInventoryEntry[];
	matchedPayloads: PayloadInventoryEntry[];
	hasNonShellMatchedPayload: boolean;
};

/** Make a stable, lossless summary of each captured payload. */
export function inventoryPreToolUsePayloads(payloads: readonly PreToolUsePayload[]): PayloadInventoryEntry[] {
	return payloads.map((payload) => {
		const toolInput = payload.tool_input as Record<string, unknown>;
		return {
			toolName: payload.tool_name as string,
			toolInputKeys: Object.keys(toolInput).sort(),
			toolInput,
			payload,
		};
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidPayload(payload: PreToolUsePayload): boolean {
	return typeof payload.tool_name === "string" && payload.tool_name.length > 0 && isRecord(payload.tool_input);
}

function containsTarget(value: unknown, targetFileName: string): boolean {
	if (typeof value === "string") return value.includes(targetFileName);
	if (Array.isArray(value)) return value.some((item) => containsTarget(item, targetFileName));
	if (isRecord(value)) return Object.values(value).some((item) => containsTarget(item, targetFileName));
	return false;
}

function isKnownShellTool(toolName: string): boolean {
	const normalized = toolName.toLowerCase();
	return normalized === "bash" || normalized === "exec_command" || normalized === "shell_command";
}

/**
 * Evaluate a structurally valid capture set. An empty or target-free set is a
 * measured negative; capture validity/absence itself is decided by fixture/index.
 */
export function judgePreToolUsePayloads(
	payloads: readonly PreToolUsePayload[],
	targetFileName = TARGET_FILE_NAME,
): PayloadJudgment {
	const inventory = inventoryPreToolUsePayloads(payloads);
	const matchedPayloads = inventory.filter(
		(entry) => isValidPayload(entry.payload) && containsTarget(entry.toolInput, targetFileName),
	);

	return {
		kind: matchedPayloads.length > 0 ? "pass" : "fail",
		inventory,
		matchedPayloads,
		hasNonShellMatchedPayload: matchedPayloads.some((entry) => !isKnownShellTool(entry.toolName)),
	};
}

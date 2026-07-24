/**
 * Shared failed-tool-response predicate for Codex PostToolUse consumers.
 *
 * Moved out of hooks/rules-injector/tool-paths.ts (its original, still-current
 * owner) so hooks/codex-persistent-mode/cli.ts can gate on the same signal
 * without re-deriving the shape from scratch — see that file's runPostToolUse
 * for the consumer that motivated the move.
 */

export function isFailedToolResponse(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (
		value["isError"] === true ||
		value["is_error"] === true ||
		value["error"] === true ||
		value["status"] === "error"
	) {
		return true;
	}
	if (typeof value["error"] === "string" && value["error"].length > 0) {
		return true;
	}
	if (typeof value["exit_code"] === "number" && value["exit_code"] !== 0) {
		return true;
	}
	return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

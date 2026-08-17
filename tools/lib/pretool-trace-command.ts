export type PreToolTracePlatform = "claude" | "codex";

export interface PreToolTraceCommandInput {
	wrapperPath: string;
	platform: PreToolTracePlatform;
	hookId: string;
	originalCommand: string;
}

export class PreToolTraceCommandError extends TypeError {
	readonly field: string;

	constructor(field: string, message: string) {
		super(`pretool-trace command: invalid ${field}: ${message}`);
		this.name = "PreToolTraceCommandError";
		this.field = field;
	}
}

function quotePosix(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function composePreToolTraceCommand(input: PreToolTraceCommandInput): string {
	if (!input || typeof input !== "object") {
		throw new PreToolTraceCommandError("input", "expected an object");
	}
	if (typeof input.wrapperPath !== "string" || input.wrapperPath.length === 0) {
		throw new PreToolTraceCommandError("wrapperPath", "expected a non-empty string");
	}
	if (input.platform !== "claude" && input.platform !== "codex") {
		throw new PreToolTraceCommandError("platform", "expected exactly claude or codex");
	}
	if (typeof input.hookId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.hookId)) {
		throw new PreToolTraceCommandError("hookId", "expected 1-128 characters matching ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$");
	}
	if (typeof input.originalCommand !== "string") {
		throw new PreToolTraceCommandError("originalCommand", "expected a string");
	}
	return ["bun", quotePosix(input.wrapperPath), quotePosix(input.platform), quotePosix(input.hookId), quotePosix(input.originalCommand)].join(" ");
}

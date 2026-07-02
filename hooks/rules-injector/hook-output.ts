export type ContextInjectionHookEventName = "SessionStart" | "UserPromptSubmit" | "PostToolUse";

const MAX_ADDITIONAL_CONTEXT_BYTES = 32_000;

export function formatAdditionalContextOutput(
	eventName: ContextInjectionHookEventName,
	additionalContext: string,
): string {
	const normalizedContext = limitAdditionalContextText(normalizeAdditionalContext(additionalContext));
	if (normalizedContext.length === 0) return "";
	return `${JSON.stringify({
		hookSpecificOutput: {
			hookEventName: eventName,
			additionalContext: normalizedContext,
		},
	})}\n`;
}

function normalizeAdditionalContext(additionalContext: string): string {
	return additionalContext.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

/**
 * Slices a string to at most `maxBytes` UTF-8 bytes without splitting a
 * multi-byte codepoint. Scans backwards from the byte limit to find the
 * nearest valid UTF-8 sequence boundary (continuation bytes are 0x80–0xBF).
 */
function sliceToUtf8Bytes(str: string, maxBytes: number): string {
	const buf = Buffer.from(str, "utf8");
	if (buf.byteLength <= maxBytes) return str;
	let end = maxBytes;
	// Walk back past any continuation bytes (10xxxxxx = 0x80–0xBF).
	while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
	return buf.subarray(0, end).toString("utf8");
}

/**
 * Returns the limited additional-context string (at most MAX_ADDITIONAL_CONTEXT_BYTES
 * UTF-8 bytes), with a truncation notice appended when clamping occurs.
 *
 * Exported so callers can inspect which content actually survives the byte clamp
 * before deciding what to mark as injected (mark-after-clamp pattern).
 */
export function limitAdditionalContextText(additionalContext: string): string {
	if (Buffer.byteLength(additionalContext, "utf8") <= MAX_ADDITIONAL_CONTEXT_BYTES) return additionalContext;
	const marker = `\n\n[Truncated hook additional context to ${MAX_ADDITIONAL_CONTEXT_BYTES} bytes to avoid Codex context overflow.]`;
	if (Buffer.byteLength(marker, "utf8") >= MAX_ADDITIONAL_CONTEXT_BYTES) {
		return sliceToUtf8Bytes(marker, MAX_ADDITIONAL_CONTEXT_BYTES);
	}
	const markerBytes = Buffer.byteLength(marker, "utf8");
	const head = sliceToUtf8Bytes(additionalContext, MAX_ADDITIONAL_CONTEXT_BYTES - markerBytes).replace(
		/[ \t\r\n]+$/,
		"",
	);
	return `${head}${marker}`;
}

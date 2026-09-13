export interface JsonlByteSplit {
	lines: Buffer[];
	pending: Buffer;
}

/** Combine a cached partial JSONL record with new bytes without decoding mid-codepoint. */
export function splitJsonlBytes(chunk: Buffer, pending: Buffer): JsonlByteSplit {
	const combined = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
	const lastNewline = combined.lastIndexOf(0x0a);
	if (lastNewline < 0) return { lines: [], pending: combined };

	const complete = combined.subarray(0, lastNewline);
	const lines: Buffer[] = [];
	let start = 0;
	for (let end = 0; end < complete.length; end += 1) {
		if (complete[end] !== 0x0a) continue;
		lines.push(complete.subarray(start, end));
		start = end + 1;
	}
	lines.push(complete.subarray(start));
	return { lines, pending: combined.subarray(lastNewline + 1) };
}

import { closeSync, fstatSync, openSync, readSync } from "node:fs";

const CONTEXT_PRESSURE_MARKERS = [
	"context compacted",
	"context_length_exceeded",
	"skill descriptions were shortened",
	"context_too_large",
	"codex ran out of room in the model's context window",
	"your input exceeds the context window",
	"long threads and multiple compactions",
] as const;

export function hasContextPressureMarker(text: string): boolean {
	const normalizedText = text.toLowerCase();
	return CONTEXT_PRESSURE_MARKERS.some((marker) => normalizedText.includes(marker));
}

/**
 * Returns true only when the *latest* compaction marker in the transcript
 * represents current context pressure — i.e., no meaningful new activity
 * (non-empty lines) follows it. A historical marker that precedes subsequent
 * conversation turns is stale and must not suppress injection.
 *
 * That is the same as "the last non-empty line carries a marker", so only the
 * end of the file is read: a transcript of several hundred MB costs one or two
 * chunks instead of a full read plus a lowercased copy on every hook call.
 */
export function transcriptHasContextPressureMarker(
	transcriptPath: string | null | undefined,
): boolean {
	if (transcriptPath === undefined || transcriptPath === null) return false;
	try {
		return hasContextPressureMarker(readLastNonEmptyLine(transcriptPath));
	} catch {
		// Never-throw contract (advisory): a missing or unreadable transcript must
		// not propagate — treat it as "no pressure marker" and let injection proceed.
		return false;
	}
}

const TAIL_CHUNK_BYTES = 64 * 1024;

/** Reads backward from EOF until one whole non-empty line is in hand. */
function readLastNonEmptyLine(path: string): string {
	const fd = openSync(path, "r");
	try {
		let position = fstatSync(fd).size;
		const chunks: Buffer[] = [];
		while (position > 0) {
			const length = Math.min(TAIL_CHUNK_BYTES, position);
			position -= length;
			const chunk = Buffer.alloc(length);
			readSync(fd, chunk, 0, length, position);
			chunks.unshift(chunk);
			// Decode only once a line boundary arrived (0x0a never occurs inside a
			// multi-byte UTF-8 sequence), so a line spanning many chunks is joined once.
			if (position > 0 && !chunk.includes(0x0a)) continue;
			const lines = Buffer.concat(chunks).toString("utf8").split("\n");
			// While bytes remain before the joined chunks, its first line may be cut mid-line
			// (or mid-character), so it is not trusted until the next chunk.
			for (let i = lines.length - 1; i >= (position > 0 ? 1 : 0); i--) {
				const line = lines[i] ?? "";
				if (line.trim().length > 0) return line;
			}
		}
		return "";
	} finally {
		closeSync(fd);
	}
}

import { readFileSync } from "node:fs";

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
 */
export function transcriptHasContextPressureMarker(
	transcriptPath: string | null | undefined,
): boolean {
	if (transcriptPath === undefined || transcriptPath === null) return false;
	try {
		const text = readFileSync(transcriptPath, "utf8");
		const normalizedText = text.toLowerCase();

		// Find the last position at which any pressure marker appears.
		let lastMarkerEnd = -1;
		for (const marker of CONTEXT_PRESSURE_MARKERS) {
			const idx = normalizedText.lastIndexOf(marker);
			if (idx !== -1) {
				const end = idx + marker.length;
				if (end > lastMarkerEnd) lastMarkerEnd = end;
			}
		}

		if (lastMarkerEnd === -1) return false;

		// Check whether new activity follows the latest marker's line.
		// Skip to the end of the line containing the marker, then check for any
		// non-empty line after it. Content on the same line as the marker is not
		// counted as new activity (markers appear mid-line in bracket notation).
		const afterMarkerChar = text.slice(lastMarkerEnd);
		const newlineIdx = afterMarkerChar.indexOf("\n");
		const afterMarkerLine = newlineIdx === -1 ? "" : afterMarkerChar.slice(newlineIdx + 1);
		const hasNewActivity = afterMarkerLine.split("\n").some((line) => line.trim().length > 0);
		return !hasNewActivity;
	} catch {
		// Never-throw contract (advisory L2): a missing or unreadable transcript must
		// not propagate — treat it as "no pressure marker" and let injection proceed.
		return false;
	}
}

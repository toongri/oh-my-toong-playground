import { logDebug } from "@lib/logging";

// Pattern matchers
const DEEP_INTERVIEW_DONE_PATTERN = /<deep-interview-done\s*\/>/i;
// The prometheus token tears the session down, so it must stand alone on its own line
// (whitespace only around it) outside fenced code. A message that merely mentions it
// mid-sentence, in inline code, or in a code example is not a completion signal.
const PROMETHEUS_DONE_LINE_PATTERN = /^\s*<prometheus-done\s*\/>\s*$/i;
const MARKDOWN_FENCE_PATTERN = /^\s{0,3}(```|~~~)/;

function hasPrometheusDoneLineOutsideFence(message: string): boolean {
	let inFence = false;
	for (const line of message.split(/\r?\n/)) {
		if (MARKDOWN_FENCE_PATTERN.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (!inFence && PROMETHEUS_DONE_LINE_PATTERN.test(line)) return true;
	}
	return false;
}

export function detectDeepInterviewDone(lastAssistantMessage: string | null): boolean {
	if (!lastAssistantMessage) return false;

	const detected = DEEP_INTERVIEW_DONE_PATTERN.test(lastAssistantMessage);
	if (detected) {
		logDebug("detected deep-interview done <deep-interview-done/>");
	}
	return detected;
}

export function detectPrometheusDone(lastAssistantMessage: string | null): boolean {
	if (!lastAssistantMessage) return false;

	const detected = hasPrometheusDoneLineOutsideFence(lastAssistantMessage);
	if (detected) {
		logDebug("detected prometheus done <prometheus-done/>");
	}
	return detected;
}

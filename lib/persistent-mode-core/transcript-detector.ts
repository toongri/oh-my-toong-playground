import { logDebug } from "@lib/logging";

// Pattern matchers
const DEEP_INTERVIEW_DONE_PATTERN = /<deep-interview-done\s*\/>/i;
const PROMETHEUS_DONE_PATTERN = /<prometheus-done\s*\/>/i;

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

	const detected = PROMETHEUS_DONE_PATTERN.test(lastAssistantMessage);
	if (detected) {
		logDebug("detected prometheus done <prometheus-done/>");
	}
	return detected;
}

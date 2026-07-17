import { logDebug } from "@lib/logging";

// Pattern matchers
const DEEP_INTERVIEW_DONE_PATTERN = /<deep-interview-done\s*\/>/i;
const PROMETHEUS_DONE_PATTERN = /<prometheus-done\s*\/>/i;
const AWAITING_USER_PATTERN = /<\s*awaiting-user\s*\/>/i;

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

export function detectAwaitingUser(lastAssistantMessage: string | null): boolean {
	if (!lastAssistantMessage) return false;

	const detected = AWAITING_USER_PATTERN.test(lastAssistantMessage);
	if (detected) {
		logDebug("detected awaiting-user <awaiting-user/>");
	}
	return detected;
}

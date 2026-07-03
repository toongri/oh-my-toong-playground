import { readStdin } from "./stdin.ts";
import {
	readBackgroundTasks,
	calculateSessionDuration,
	isThinkingEnabled,
	readTasks,
	getActiveTaskForm,
} from "./state.ts";
import { parseTranscript } from "./transcript.ts";
import { fetchRateLimits } from "./usage-api.ts";
import { formatStatusLineV2, formatMinimalStatus } from "./formatter.ts";
import { initLogger, logInfo, logError, logStart, logEnd } from "@lib/logging";
import { getOmtDir } from "@lib/omt-dir";
import type { HudDataV2 } from "./types.ts";

/**
 * Convert regular spaces to non-breaking spaces for terminal alignment.
 * Terminal emulators may collapse or trim regular spaces, but non-breaking
 * spaces (U+00A0) preserve alignment in status lines.
 */
function toNonBreakingSpaces(text: string): string {
	return text.replace(/ /g, "\u00A0");
}

function isFulfilled<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
	return result.status === "fulfilled";
}

export async function main(): Promise<void> {
	try {
		// Read stdin JSON from Claude Code
		const input = await readStdin();

		if (!input) {
			// Minimal fallback when no input
			// eslint-disable-next-line no-console -- HUD stdout 렌더링
			console.log(toNonBreakingSpaces(formatMinimalStatus(null)));
			return;
		}

		const cwd = input.cwd || process.cwd();
		const sessionId = input.session_id || "default";

		// Initialize logging
		initLogger("hud", getOmtDir(), sessionId);
		logStart();
		logInfo(`Input: transcript_path=${input.transcript_path}, cwd=${cwd}`);

		// Gather data from all sources in parallel (individual failures don't block others)
		const functionNames = [
			"readBackgroundTasks",
			"parseTranscript",
			"fetchRateLimits",
			"isThinkingEnabled",
			"readTasks",
			"getActiveTaskForm",
		];
		const results = await Promise.allSettled([
			readBackgroundTasks(),
			input.transcript_path
				? parseTranscript(input.transcript_path)
				: Promise.resolve({
						runningAgents: 0,
						activeSkill: null,
						agents: [],
						sessionStartedAt: null,
					}),
			fetchRateLimits(),
			isThinkingEnabled(),
			readTasks(sessionId),
			getActiveTaskForm(sessionId),
		]);

		// Log rejected results with function names
		results.forEach((result, index) => {
			// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- heterogeneous allSettled tuple; forEach widens each element to a union that isFulfilled's generic T can't unify against, so a boundary cast to a shared shape is required
			const settled = result as PromiseSettledResult<unknown>;
			if (!isFulfilled(settled)) {
				// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- same heterogeneous-tuple boundary; result is a rejected settlement here, but its static type still spans all Promise.allSettled element types
				const rejected = result as PromiseRejectedResult;
				logError(`HUD data source failed: ${functionNames[index]} - ${rejected.reason}`);
			}
		});

		// Extract values with type-safe fallbacks for rejected promises
		const backgroundTasks = isFulfilled(results[0]) ? results[0].value : 0;
		const transcriptData = isFulfilled(results[1])
			? results[1].value
			: { runningAgents: 0, activeSkill: null, agents: [], sessionStartedAt: null };
		const rateLimits = isFulfilled(results[2]) ? results[2].value : null;
		const thinkingActive = isFulfilled(results[3]) ? results[3].value : false;
		const todos = isFulfilled(results[4]) ? results[4].value : null;
		const inProgressTodo = isFulfilled(results[5]) ? results[5].value : null;

		// Log transcript parsing results
		logInfo(`Transcript parsed: runningAgents=${transcriptData.runningAgents}`);

		const hudData: HudDataV2 = {
			contextPercent: input.context_window?.used_percentage ?? null,
			runningAgents: transcriptData.runningAgents,
			backgroundTasks,
			activeSkill: transcriptData.activeSkill,
			rateLimits,
			agents: transcriptData.agents,
			sessionDuration: calculateSessionDuration(transcriptData.sessionStartedAt),
			thinkingActive,
			todos,
			inProgressTodo,
		};

		// Format and output with non-breaking spaces for terminal alignment
		// eslint-disable-next-line no-console -- HUD stdout 렌더링
		console.log(toNonBreakingSpaces(formatStatusLineV2(hudData)));
		logEnd();
	} catch (error) {
		// Log error and graceful fallback
		const errorMessage = error instanceof Error ? error.message : String(error);
		logError(`HUD error: ${errorMessage}`);
		// eslint-disable-next-line no-console -- HUD stdout 렌더링
		console.log(toNonBreakingSpaces(formatMinimalStatus(null)));
	}
}

// Run main only when executed directly (not when imported for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}

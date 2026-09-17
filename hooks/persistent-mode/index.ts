import { readStdin, parseInput } from "./stdin.ts";
import { getProjectRoot } from "@lib/persistent-mode-core/utils";
import { makeDecision, DecisionContext } from "@lib/persistent-mode-core/decision";
import { initLogger, logStart, logEnd, logInfo, logError } from "@lib/logging";
import { getOmtDir } from "@lib/omt-dir";

export async function main(): Promise<void> {
	try {
		// Read and parse stdin
		const rawInput = await readStdin();
		const input = parseInput(rawInput);

		// Get project root
		const projectRoot = getProjectRoot(input.directory);

		// Initialize logging
		initLogger("persistent-mode", getOmtDir(), input.sessionId);
		logStart();
		logInfo(`stop hook invoked, sessionId=${input.sessionId}`);

		// Build decision context
		const context: DecisionContext = {
			projectRoot,
			sessionId: input.sessionId,
			lastAssistantMessage: input.lastAssistantMessage,
			activeBackgroundTaskCount: input.activeBackgroundTaskCount,
			deferredStopWakeGuaranteed: true,
		};

		// Make decision
		const output = makeDecision(context);

		// Log decision result
		if (output.decision) {
			logInfo(`decision=${output.decision}`);
		} else if (output.continue !== undefined) {
			logInfo(`decision=continue`);
		}

		// Output JSON result
		// eslint-disable-next-line no-console -- Stop 훅 stdout 프로토콜
		console.log(JSON.stringify(output));
		logEnd();
	} catch (error) {
		// On any error, allow stop (fail open)
		const errorMessage = error instanceof Error ? error.message : String(error);
		try {
			logError(`error: ${errorMessage}`);
		} catch {
			/* logger not initialized */
		}
		console.error("persistent-mode error:", error);
		// eslint-disable-next-line no-console -- Stop 훅 stdout 프로토콜(fail-open)
		console.log('{"continue": true}');
		try {
			logEnd();
		} catch {
			/* logger not initialized */
		}
	}
}

// Run main when executed directly
if (import.meta.main) {
	main();
}

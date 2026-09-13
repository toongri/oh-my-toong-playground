import { randomBytes } from "crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

/** Durable, one-way cancellation marker shared by producers and workers. */
export const CANCELLATION_MARKER = "cancel.json";

const OBSERVATION_INTERVAL_MS = 150;

function markerPath(memberDir: string): string {
	return join(memberDir, CANCELLATION_MARKER);
}

/**
 * Request cancellation without removing or resetting a prior request.
 * The temporary file and rename make readers see either the old marker or the
 * complete new marker, never a partially written JSON document.
 */
export function requestWorkerCancellation(memberDir: string, reason?: string): void {
	const target = markerPath(memberDir);
	const temporary = `${target}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
	const payload = {
		requestedAt: new Date().toISOString(),
		...(reason === undefined ? {} : { reason }),
	};

	try {
		writeFileSync(temporary, JSON.stringify(payload), "utf8");
		renameSync(temporary, target);
	} catch (error) {
		try {
			unlinkSync(temporary);
		} catch {
			// Preserve the original write/rename error for the caller.
		}
		throw error;
	}
}

/**
 * Missing markers mean not canceled. Any existing marker that cannot be read
 * or parsed is treated as canceled so workers fail safe across processes.
 */
export function isWorkerCancellationRequested(memberDir: string): boolean {
	const target = markerPath(memberDir);
	try {
		JSON.parse(readFileSync(target, "utf8"));
		return true;
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return false;
		}
		return true;
	}
}

export interface WorkerCancellationObservation {
	signal: AbortSignal;
	dispose: () => void;
}

/**
 * Observe durable cancellation and optionally relay an upstream abort signal.
 * Polling is intentionally referenced (not unref'd), keeping queued workers
 * alive while they wait for cancellation or a slot. Call dispose when the
 * worker's whole lifecycle ends.
 */
export function observeWorkerCancellation(
	memberDir: string,
	externalSignal?: AbortSignal,
): WorkerCancellationObservation {
	const controller = new AbortController();
	let timer: ReturnType<typeof setInterval> | undefined;
	let disposed = false;

	const stopTimer = (): void => {
		if (timer !== undefined) {
			clearInterval(timer);
			timer = undefined;
		}
	};

	const relayExternalAbort = (): void => {
		if (controller.signal.aborted) return;
		stopTimer();
		disposeExternalListener();
		controller.abort(externalSignal?.reason);
	};

	const disposeExternalListener = (): void => {
		externalSignal?.removeEventListener("abort", relayExternalAbort);
	};

	const observe = (): void => {
		if (disposed || controller.signal.aborted) return;
		if (isWorkerCancellationRequested(memberDir)) {
			stopTimer();
			disposeExternalListener();
			controller.abort("worker cancellation requested");
		}
	};

	if (externalSignal?.aborted) {
		relayExternalAbort();
	} else {
		observe();
		if (!controller.signal.aborted) {
			externalSignal?.addEventListener("abort", relayExternalAbort);
			timer = setInterval(observe, OBSERVATION_INTERVAL_MS);
		}
	}

	return {
		signal: controller.signal,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			stopTimer();
			disposeExternalListener();
		},
	};
}

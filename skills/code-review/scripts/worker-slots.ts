/**
 * Backwards-compatible code-review import path for the machine-wide worker pool.
 * The implementation lives in lib so every worker family can share one pool.
 */
export {
	resolveSlotCount,
	slotsDir,
	acquireWorkerSlot,
	releaseWorkerSlot,
} from "@lib/worker-slots";
export type { WorkerSlot, AcquireWorkerSlotOptions } from "@lib/worker-slots";

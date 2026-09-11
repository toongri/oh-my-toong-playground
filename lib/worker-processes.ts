import { execFileSync } from "child_process";

export type ProcessRecord = {
	pid: number;
	ppid: number;
	pgid: number;
	startedAt: string;
};

export type ProcessSnapshot = { processes: ProcessRecord[] };

export type ProcessReceipt = Pick<ProcessRecord, "pid" | "pgid" | "startedAt">;

export function snapshotProcesses(): ProcessSnapshot {
	const output = execFileSync("ps", ["-o", "pgid=,pid=,ppid=,lstart=", "-A"], {
		encoding: "utf8",
		env: { ...process.env, LC_ALL: "C" },
	});
	const processes: ProcessRecord[] = [];
	for (const line of output.split("\n")) {
		const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
		if (!match) continue;
		processes.push({
			pgid: Number(match[1]),
			pid: Number(match[2]),
			ppid: Number(match[3]),
			startedAt: match[4].trim(),
		});
	}
	return { processes };
}

export function readProcessReceipt(pid: number, snapshot = snapshotProcesses): ProcessReceipt | null {
	try {
		const record = snapshot().processes.find((candidate) => candidate.pid === pid);
		return record ? { pid: record.pid, pgid: record.pgid, startedAt: record.startedAt } : null;
	} catch {
		return null;
	}
}

export type CleanupOwnedDescendantsDeps = {
	currentPid?: number;
	childPid: number | undefined;
	childReceipt?: ProcessReceipt | null;
	leaderReceipt?: ProcessReceipt | null;
	graceMs?: number;
	snapshot?: () => ProcessSnapshot;
	kill?: (pid: number, signal: NodeJS.Signals) => void;
};

function signalBestEffort(
	kill: (pid: number, signal: NodeJS.Signals) => void,
	pid: number,
	signal: NodeJS.Signals,
): void {
	try {
		kill(pid, signal);
	} catch {
		// The process may have exited between the snapshot and the signal.
	}
}

function waitMs(ms: number): Promise<void> {
	return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function receiptMatches(record: ProcessRecord, receipt: ProcessReceipt): boolean {
	return record.pid === receipt.pid && record.pgid === receipt.pgid && record.startedAt === receipt.startedAt;
}

/**
 * Reap CLI descendants without ever signaling the worker itself or an
 * unrelated process group. Production workers are detached group leaders;
 * direct-library callers are not, so those callers are restricted to the
 * explicitly owned child PID and its still-attached tree.
 */
export async function cleanupOwnedDescendants({
	currentPid = process.pid,
	childPid,
	childReceipt,
	leaderReceipt,
	graceMs = 5000,
	snapshot = snapshotProcesses,
	kill = (pid, signal) => process.kill(pid, signal),
}: CleanupOwnedDescendantsDeps): Promise<void> {
	if (childPid === undefined || childPid <= 0) return;
	let first: ProcessSnapshot;
	try {
		first = snapshot();
	} catch {
		return;
	}
	const current = first.processes.find((record) => record.pid === currentPid);
	const child = first.processes.find((record) => record.pid === childPid);
	const leaderGroup =
		current?.pgid === currentPid &&
		(leaderReceipt === undefined || (leaderReceipt !== null && receiptMatches(current, leaderReceipt)));

	if (!leaderGroup) {
		// Never infer ownership from a shared PGID. A child that has already
		// disappeared cannot safely be rediscovered by PID alone.
		if (!childReceipt || !child || !receiptMatches(child, childReceipt)) return;
		signalBestEffort(kill, childPid, "SIGTERM");
		await waitMs(graceMs);
		let latest: ProcessSnapshot;
		try {
			latest = snapshot();
		} catch {
			return;
		}
		const stillChild = latest.processes.find(
			(record) => record.pid === childPid && record.startedAt === child.startedAt && record.pgid === child.pgid,
		);
		if (stillChild) signalBestEffort(kill, childPid, "SIGKILL");
		return;
	}

	const leaderStartedAt = current.startedAt;
	let beforeTerm: ProcessSnapshot;
	try {
		beforeTerm = snapshot();
	} catch {
		return;
	}
	const verifiedLeader = beforeTerm.processes.find(
		(record) => record.pid === currentPid && record.pgid === currentPid && record.startedAt === leaderStartedAt,
	);
	if (!verifiedLeader) return;
	const initialMembers = new Map(
		first.processes
			.filter((record) => record.pgid === currentPid && record.pid !== currentPid)
			.map((record) => [record.pid, record.startedAt]),
	);
	const termMembers = beforeTerm.processes.filter(
		(record) =>
			record.pgid === currentPid &&
			record.pid !== currentPid &&
			initialMembers.get(record.pid) === record.startedAt &&
			(record.pid !== childPid || !childReceipt || record.startedAt === childReceipt.startedAt),
	);
	for (const record of termMembers) signalBestEffort(kill, record.pid, "SIGTERM");
	if (termMembers.length === 0) return;
	await waitMs(graceMs);

	let afterGrace: ProcessSnapshot;
	try {
		afterGrace = snapshot();
	} catch {
		return;
	}
	const liveLeader = afterGrace.processes.find(
		(record) => record.pid === currentPid && record.pgid === currentPid && record.startedAt === leaderStartedAt,
	);
	if (!liveLeader) return;
	const afterByPid = new Map(afterGrace.processes.map((record) => [record.pid, record]));
	const belongsToLeader = (record: ProcessRecord): boolean => {
		let cursor: ProcessRecord | undefined = record;
		const seen = new Set<number>();
		while (cursor && !seen.has(cursor.pid)) {
			if (cursor.pid === currentPid) return true;
			seen.add(cursor.pid);
			cursor = afterByPid.get(cursor.ppid);
		}
		return false;
	};
	for (const record of afterGrace.processes) {
		if (record.pid === currentPid || record.pgid !== currentPid) continue;
		// A member appearing during the grace period is safe while the original
		// leader identity still matches. Existing members were separately
		// witnessed before TERM, and new members are contained by that leader.
		const witnessedStart = initialMembers.get(record.pid);
		if (witnessedStart !== undefined && witnessedStart !== record.startedAt) continue;
		if (record.pid === childPid && childReceipt && !receiptMatches(record, childReceipt)) continue;
		if (witnessedStart === undefined && !belongsToLeader(record)) continue;
		signalBestEffort(kill, record.pid, "SIGKILL");
	}
}

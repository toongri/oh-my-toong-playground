#!/usr/bin/env bun
/** Session-scoped, crash-atomic journal for craft-tasks PM writes. */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { isDeepStrictEqual } from "util";
import { getOmtDir } from "@lib/omt-dir";
import { resolveSessionIdOrThrow, isSafeSessionId } from "@lib/state-core";

export type JournalState = "prepared" | "child-created" | "mutation-written" | "complete" | "manual-reconciliation-required";

export interface Association {
	childId: string;
	parentId: string;
	designAnchor: string;
}

export interface CreatePrepareInput {
	parentId: string;
	designAnchor: string;
	creationPayload: unknown;
}

export interface CreateIntent {
	kind: "create";
	createIntentId: string;
	taskKey: string;
	parentId: string;
	designAnchor: string;
	creationPayload: unknown;
	identityComment: string;
	state: JournalState;
	childId?: string;
	reason?: string;
}

export interface UpdatePrepareInput {
	childId: string;
	parentId: string;
	designAnchor: string;
	before: unknown;
	after: unknown;
	changeComment: string;
}

export interface UpdateIntent {
	kind: "update";
	updateIntentId: string;
	childId: string;
	parentId: string;
	designAnchor: string;
	before: unknown;
	after: unknown;
	changeComment: string;
	state: JournalState;
	reason?: string;
}

export type Intent = CreateIntent | UpdateIntent;

interface Journal {
	version: 1;
	intents: Intent[];
}

const JOURNAL_PREFIX = "task-write-journal-";
const TERMINAL_STATES = new Set<JournalState>(["complete", "manual-reconciliation-required"]);
const LOCK_TIMEOUT_MS = 500;
const LOCK_RETRY_MS = 5;
const LOCK_INITIALIZATION_GRACE_MS = 1000;
const RECEIPT_PREFIX = "task-write-reconciliation-";
const QUARANTINE_MARKER = ".quarantine.";

export type PendingEntry = {
	sourceSessionId: string;
	intentId: string;
	kind: Intent["kind"];
	state: JournalState;
	parentId: string;
	designAnchor: string;
	childId?: string;
	taskKey?: string;
} | {
	sourceSessionId: string;
	error: string;
};

export type MissingReconciliationReceipt = { type: "missing-intent"; receiptId: string; status: "manual-reconciliation-required"; sourceSessionId: string; intentId: string; reason: string };
export type QuarantineReconciliationReceipt = { type: "quarantine"; receiptId: string; status: "manual-reconciliation-required"; sourceSessionId: string; reason: string; artifactId: string };
export type QuarantineArtifact = { type: "quarantine-artifact"; sourceSessionId: string; artifactId: string };
export type ReconciliationError = { type: "reconciliation-error"; sourceSessionId: string; receiptId?: string; error: string };
export type ReconciliationEntry = MissingReconciliationReceipt | QuarantineReconciliationReceipt | QuarantineArtifact | ReconciliationError;

function record(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected a JSON object");
	return true;
}

function nonblank(value: unknown, name: string): string {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a nonblank string`);
	return value;
}

function exact(value: unknown, name: string): unknown {
	if (value === undefined) throw new Error(`${name} is required`);
	return value;
}

function hasErrorCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function validateAnchor(parentId: unknown, designAnchor: unknown): { parentId: string; designAnchor: string } {
	return { parentId: nonblank(parentId, "parentId"), designAnchor: nonblank(designAnchor, "designAnchor") };
}

function newOpaquePair(): { createIntentId: string; taskKey: string } {
	const createIntentId = randomUUID();
	let taskKey = randomUUID();
	while (taskKey === createIntentId) taskKey = randomUUID();
	return { createIntentId, taskKey };
}

export function canonicalIdentityComment(taskKey: string): string {
	return `<!-- Task identity\ntaskKey: ${taskKey}\n-->`;
}

export function journalPath(sessionId = resolveSessionIdOrThrow()): string {
	if (!isSafeSessionId(sessionId)) throw new Error("Unsafe session id");
	return `${getOmtDir()}/${JOURNAL_PREFIX}${sessionId}.json`;
}

function emptyJournal(): Journal {
	return { version: 1, intents: [] };
}

class JournalValidationError extends Error {}

function readJournal(sessionId = resolveSessionIdOrThrow()): Journal {
	const path = journalPath(sessionId);
	if (!existsSync(path)) return emptyJournal();
	let parsed: unknown;
	const raw = readFileSync(path, "utf8");
	try { parsed = JSON.parse(raw); }
	catch { throw new JournalValidationError("Malformed task-write journal JSON"); }
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new JournalValidationError("Expected a JSON object");
	if (!record(parsed)) throw new JournalValidationError("Expected a JSON object");
	if (parsed.version !== 1 || !Array.isArray(parsed.intents)) throw new JournalValidationError("Malformed task-write journal shape");
	for (const intent of parsed.intents) {
		if (typeof intent !== "object" || intent === null || Array.isArray(intent) || !record(intent) || (intent.kind !== "create" && intent.kind !== "update") || typeof intent.state !== "string") throw new JournalValidationError("Malformed task-write journal shape");
		const id = intent.kind === "create" ? intent.createIntentId : intent.updateIntentId;
		if (typeof id !== "string" || id.trim() === "") throw new JournalValidationError("Malformed task-write journal shape");
		const required = intent.kind === "create"
			? [intent.taskKey, intent.parentId, intent.designAnchor, intent.creationPayload, intent.identityComment]
			: [intent.childId, intent.parentId, intent.designAnchor, intent.before, intent.after, intent.changeComment];
		if (required.some((value) => value === undefined) || !["prepared", "child-created", "mutation-written", "complete", "manual-reconciliation-required"].includes(intent.state)) throw new JournalValidationError("Malformed task-write journal shape");
	}
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- shallow validation intentionally preserves opaque intent payloads.
	return parsed as unknown as Journal;
}

function atomicWrite(path: string, value: string): void {
	mkdirSync(getOmtDir(), { recursive: true });
	const tmp = `${path}.tmp.${process.pid}.${randomUUID()}`;
	try { writeFileSync(tmp, value, "utf8"); renameSync(tmp, path); }
	catch (error) { try { unlinkSync(tmp); } catch { /* best effort */ } throw error; }
}

function writeJournal(journal: Journal, sessionId = resolveSessionIdOrThrow()): void {
	const path = journalPath(sessionId);
	mkdirSync(getOmtDir(), { recursive: true });
	const tmp = `${path}.tmp.${process.pid}.${randomUUID()}`;
	try {
		writeFileSync(tmp, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
		renameSync(tmp, path);
	} catch (error) {
		try { unlinkSync(tmp); } catch { /* best effort */ }
		throw error;
	}
}

function parseOwnerPid(raw: string): number | undefined {
	const value = raw.trim();
	if (!/^[1-9][0-9]*$/.test(value)) return undefined;
	const pid = Number(value);
	return Number.isSafeInteger(pid) ? pid : undefined;
}

function removeEmptyLegacyLock(lockPath: string): boolean {
	try {
		if (Date.now() - statSync(lockPath).mtimeMs <= LOCK_INITIALIZATION_GRACE_MS) return false;
		const entries = readdirSync(lockPath);
		if (entries.length === 1 && entries[0] === "owner" && readFileSync(`${lockPath}/owner`, "utf8").trim() === "") {
			unlinkSync(`${lockPath}/owner`);
		} else if (entries.length !== 0) return false;
		rmdirSync(lockPath);
		return true;
	} catch {
		return false;
	}
}

function isFreshEmptyLegacyLock(lockPath: string): boolean {
	try {
		if (Date.now() - statSync(lockPath).mtimeMs > LOCK_INITIALIZATION_GRACE_MS) return false;
		const entries = readdirSync(lockPath);
		return entries.length === 0 || (entries.length === 1 && entries[0] === "owner" && readFileSync(`${lockPath}/owner`, "utf8").trim() === "");
	} catch {
		return false;
	}
}

function cleanAbandonedClaims(lockPath: string): void {
	const prefix = `${lockPath}.claim.`;
	let names: string[];
	try { names = readdirSync(getOmtDir()); } catch { return; }
	for (const name of names) {
		const claimPath = `${getOmtDir()}/${name}`;
		if (!claimPath.startsWith(prefix)) continue;
		let ownerPid: number | undefined;
		try { ownerPid = parseOwnerPid(readFileSync(`${claimPath}/owner`, "utf8")); } catch { continue; }
		if (ownerPid === undefined) continue;
		try { process.kill(ownerPid, 0); } catch (error) {
			if (hasErrorCode(error, "ESRCH")) {
				try { unlinkSync(`${claimPath}/owner`); } catch { /* best effort */ }
				try { rmdirSync(claimPath); } catch { /* best effort */ }
			}
		}
	}
}

function withJournalLock<T>(sessionId: string | undefined, operation: () => T): T {
	const lockPath = `${journalPath(sessionId)}.lock`;
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	mkdirSync(getOmtDir(), { recursive: true });
	cleanAbandonedClaims(lockPath);
	while (Date.now() < deadline) {
		const claimPath = `${lockPath}.claim.${process.pid}.${randomUUID()}`;
		let published = false;
		try {
			mkdirSync(claimPath);
			writeFileSync(`${claimPath}/owner`, `${process.pid}\n`, "utf8");
			try {
				if (!isFreshEmptyLegacyLock(lockPath)) {
					renameSync(claimPath, lockPath);
					published = true;
				}
			} catch (error) {
				if (!hasErrorCode(error, "EEXIST") && !hasErrorCode(error, "ENOTEMPTY")) throw error;
			}
			if (published) {
				try { return operation(); }
				finally {
					try { unlinkSync(`${lockPath}/owner`); } catch { /* best effort */ }
					try { rmdirSync(lockPath); } catch { /* best effort */ }
				}
			}
		} finally {
			if (!published) {
				try { unlinkSync(`${claimPath}/owner`); } catch { /* best effort */ }
				try { rmdirSync(claimPath); } catch { /* best effort */ }
			}
		}

		if (!existsSync(lockPath)) continue;
		if (removeEmptyLegacyLock(lockPath)) continue;
		if (!existsSync(lockPath)) continue;
		let ownerContents: string;
		try { ownerContents = readFileSync(`${lockPath}/owner`, "utf8"); } catch {
			continue;
		}
		if (ownerContents.trim() === "") {
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
			continue;
		}
		const ownerPid = parseOwnerPid(ownerContents);
		if (ownerPid === undefined) throw new Error("Journal lock has a malformed or missing owner");
		try { process.kill(ownerPid, 0); } catch (error) {
			if (hasErrorCode(error, "ESRCH")) {
				try { unlinkSync(`${lockPath}/owner`); } catch { /* best effort */ }
				try { rmdirSync(lockPath); } catch { /* another waiter may have reclaimed it */ }
				continue;
			}
		}
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
	}
	throw new Error("Timed out waiting for task-write journal lock");
}

function append<T extends Intent>(intent: T, sessionId?: string): T {
	return withJournalLock(sessionId, () => {
		if (isSessionSealed(sessionId ?? resolveSessionIdOrThrow())) throw new Error("Source session is quarantined; use a new session");
		const journal = readJournal(sessionId);
		const intentId = intent.kind === "create" ? intent.createIntentId : intent.updateIntentId;
		if (journal.intents.some((entry) => (entry.kind === "create" ? entry.createIntentId : entry.updateIntentId) === intentId)) {
			throw new Error("Intent ID collision");
		}
		journal.intents.push(intent);
		writeJournal(journal, sessionId);
		return intent;
	});
}

function receiptPath(sessionId: string, receiptId: string): string { return `${getOmtDir()}/${RECEIPT_PREFIX}${sessionId}-${receiptId}.json`; }
function artifactPath(sessionId: string, artifactId: string): string { return `${getOmtDir()}/${JOURNAL_PREFIX}${sessionId}${QUARANTINE_MARKER}${artifactId}.json`; }

function readReceipts(): Array<MissingReconciliationReceipt | QuarantineReconciliationReceipt> {
	if (!existsSync(getOmtDir())) return [];
	const result: Array<MissingReconciliationReceipt | QuarantineReconciliationReceipt> = [];
	const filenamePattern = new RegExp(`^${RECEIPT_PREFIX}([A-Za-z0-9_-]+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.json$`);
	for (const name of readdirSync(getOmtDir()).sort()) {
		if (!name.startsWith(RECEIPT_PREFIX) || !name.endsWith(".json")) continue;
		try {
			const value: unknown = JSON.parse(readFileSync(`${getOmtDir()}/${name}`, "utf8"));
			if (!record(value) || value.status !== "manual-reconciliation-required" || typeof value.receiptId !== "string" || typeof value.sourceSessionId !== "string" || typeof value.reason !== "string" || value.reason.trim() === "") continue;
			const filename = filenamePattern.exec(name);
			if (!filename || value.sourceSessionId !== filename[1] || value.receiptId !== filename[2]) continue;
			if (value.type === "missing-intent" && typeof value.intentId === "string") result.push({ type: "missing-intent", receiptId: value.receiptId, status: "manual-reconciliation-required", sourceSessionId: value.sourceSessionId, intentId: value.intentId, reason: value.reason });
			if (value.type === "quarantine" && typeof value.artifactId === "string") result.push({ type: "quarantine", receiptId: value.receiptId, status: "manual-reconciliation-required", sourceSessionId: value.sourceSessionId, artifactId: value.artifactId, reason: value.reason });
		} catch { /* ignore malformed receipt files */ }
	}
	return result;
}

function malformedReceiptEntries(): ReconciliationError[] {
	if (!existsSync(getOmtDir())) return [];
	const result: ReconciliationError[] = [];
	const names = readdirSync(getOmtDir()).filter((name) => name.startsWith(RECEIPT_PREFIX) && name.endsWith(".json")).sort();
	const filenamePattern = new RegExp(`^${RECEIPT_PREFIX}([A-Za-z0-9_-]+)-([A-Za-z0-9-]+)\\.json$`);
	for (const name of names) {
		const match = filenamePattern.exec(name);
		try {
			const value: unknown = JSON.parse(readFileSync(`${getOmtDir()}/${name}`, "utf8"));
			const validPayload = record(value) && value.status === "manual-reconciliation-required" && typeof value.receiptId === "string" && typeof value.sourceSessionId === "string" && typeof value.reason === "string" && value.reason.trim() !== "" && ((value.type === "missing-intent" && typeof value.intentId === "string") || (value.type === "quarantine" && typeof value.artifactId === "string"));
			if (!match || !validPayload || value.sourceSessionId !== match[1] || value.receiptId !== match[2]) result.push({ type: "reconciliation-error", sourceSessionId: match?.[1] ?? (record(value) && typeof value.sourceSessionId === "string" ? value.sourceSessionId : ""), receiptId: match?.[2], error: !match || (record(value) && (value.sourceSessionId !== match[1] || value.receiptId !== match[2])) ? "Malformed reconciliation receipt identity" : "Malformed reconciliation receipt shape" });
		} catch { result.push({ type: "reconciliation-error", sourceSessionId: match?.[1] ?? "", receiptId: match?.[2], error: "Malformed reconciliation receipt JSON" }); }
	}
	return result;
}

function quarantineArtifacts(): QuarantineArtifact[] {
	if (!existsSync(getOmtDir())) return [];
	const result: QuarantineArtifact[] = [];
	const pattern = new RegExp(`^${JOURNAL_PREFIX}([A-Za-z0-9_-]+)\\.quarantine\\.([A-Za-z0-9-]+)\\.json$`);
	for (const name of readdirSync(getOmtDir()).sort()) {
		const match = pattern.exec(name);
		if (match) result.push({ type: "quarantine-artifact", sourceSessionId: match[1], artifactId: match[2] });
	}
	return result;
}

function isSessionSealed(sessionId: string): boolean {
	return readReceipts().some((receipt) => receipt.type === "quarantine" && receipt.sourceSessionId === sessionId) || quarantineArtifacts().some((artifact) => artifact.sourceSessionId === sessionId);
}

export function manualReconciliationMissing(intentId: string, reason: unknown, sourceSessionId = resolveSessionIdOrThrow()): MissingReconciliationReceipt {
	nonblank(intentId, "intent ID");
	const cleanReason = nonblank(reason, "reason");
	if (!isSafeSessionId(sourceSessionId)) throw new Error("Unsafe session id");
	return withJournalLock(sourceSessionId, () => {
		const existing = readReceipts().find((receipt): receipt is MissingReconciliationReceipt => receipt.type === "missing-intent" && receipt.sourceSessionId === sourceSessionId && receipt.intentId === intentId);
		if (existing) return existing;
		if (!existsSync(journalPath(sourceSessionId))) throw new Error(`Missing task-write journal: ${sourceSessionId}`);
		const journal = readJournal(sourceSessionId);
		if (journal.intents.some((intent) => (intent.kind === "create" ? intent.createIntentId : intent.updateIntentId) === intentId)) throw new Error("Intent exists; use ordinary manual-reconciliation");
		const receipt: MissingReconciliationReceipt = { type: "missing-intent", receiptId: randomUUID(), status: "manual-reconciliation-required", sourceSessionId, intentId, reason: cleanReason };
		atomicWrite(receiptPath(sourceSessionId, receipt.receiptId), `${JSON.stringify(receipt, null, 2)}\n`);
		return receipt;
	});
}

export function quarantineJournal(reason: unknown, sourceSessionId = resolveSessionIdOrThrow()): QuarantineReconciliationReceipt {
	const cleanReason = nonblank(reason, "reason");
	if (!isSafeSessionId(sourceSessionId)) throw new Error("Unsafe session id");
	return withJournalLock(sourceSessionId, () => {
		const existing = readReceipts().find((receipt): receipt is QuarantineReconciliationReceipt => receipt.type === "quarantine" && receipt.sourceSessionId === sourceSessionId);
		if (existing) return existing;
		const orphans = quarantineArtifacts().filter((artifact) => artifact.sourceSessionId === sourceSessionId);
		if (orphans.length > 1) throw new Error("Ambiguous quarantine artifacts");
		if (orphans.length === 1) {
			const receipt: QuarantineReconciliationReceipt = { type: "quarantine", receiptId: randomUUID(), status: "manual-reconciliation-required", sourceSessionId, reason: cleanReason, artifactId: orphans[0].artifactId };
			atomicWrite(receiptPath(sourceSessionId, receipt.receiptId), `${JSON.stringify(receipt, null, 2)}\n`);
			return receipt;
		}
		const path = journalPath(sourceSessionId);
		if (!existsSync(path)) throw new Error(`Missing task-write journal: ${sourceSessionId}`);
		try { readJournal(sourceSessionId); } catch (error) {
			if (!(error instanceof JournalValidationError)) throw error;
			let artifactId = randomUUID();
			while (existsSync(artifactPath(sourceSessionId, artifactId))) artifactId = randomUUID();
			renameSync(path, artifactPath(sourceSessionId, artifactId));
			const receipt: QuarantineReconciliationReceipt = { type: "quarantine", receiptId: randomUUID(), status: "manual-reconciliation-required", sourceSessionId, reason: cleanReason, artifactId };
			atomicWrite(receiptPath(sourceSessionId, receipt.receiptId), `${JSON.stringify(receipt, null, 2)}\n`);
			return receipt;
		}
		throw new Error("Task-write journal is valid; quarantine is not allowed");
	});
}

export function listReconciliation(): ReconciliationEntry[] {
	const receipts = readReceipts();
	const covered = new Set(receipts.filter((receipt): receipt is QuarantineReconciliationReceipt => receipt.type === "quarantine").map((receipt) => `${receipt.sourceSessionId}\0${receipt.artifactId}`));
	const orphanArtifacts = quarantineArtifacts().filter((artifact) => !covered.has(`${artifact.sourceSessionId}\0${artifact.artifactId}`));
	const entries: ReconciliationEntry[] = [...receipts, ...orphanArtifacts, ...malformedReceiptEntries()];
	const entryId = (entry: ReconciliationEntry): string => "receiptId" in entry ? entry.receiptId ?? "" : "artifactId" in entry ? entry.artifactId : "";
	return entries.sort((a, b) => a.sourceSessionId.localeCompare(b.sourceSessionId) || entryId(a).localeCompare(entryId(b)));
}

function findIntent(id: string, sessionId?: string): { journal: Journal; index: number; intent: Intent } {
	nonblank(id, "intent ID");
	const journal = readJournal(sessionId);
	const index = journal.intents.findIndex((entry) => (entry.kind === "create" ? entry.createIntentId : entry.updateIntentId) === id);
	if (index < 0) throw new Error(`Unknown intent: ${id}`);
	return { journal, index, intent: journal.intents[index] };
}

function replace<T extends Intent>(id: string, next: T, sessionId?: string): T {
	return withJournalLock(sessionId, () => {
		const found = findIntent(id, sessionId);
		if (TERMINAL_STATES.has(found.intent.state)) throw new Error("Cannot mutate a terminal intent");
		const expectedState = next.state === "child-created" ? "prepared"
			: next.state === "mutation-written" ? "prepared"
			: next.state === "complete" ? (next.kind === "create" ? "child-created" : "mutation-written")
			: undefined;
		if (expectedState !== undefined && found.intent.state !== expectedState) throw new Error("Invalid concurrent journal transition");
		found.journal.intents[found.index] = next.state === "manual-reconciliation-required"
			? { ...found.intent, state: next.state, reason: next.reason }
			: next;
		writeJournal(found.journal, sessionId);
		return next;
	});
}


function verifyAssociation(intent: Intent, association: unknown): void {
	if (!record(association)) throw new Error("Expected a JSON object");
	const childId = nonblank(association.childId, "childId");
	const { parentId, designAnchor } = validateAnchor(association.parentId, association.designAnchor);
	if (intent.parentId !== parentId || intent.designAnchor !== designAnchor) throw new Error("Parent or designAnchor mismatch");
	if ("childId" in intent && intent.childId !== undefined && intent.childId !== childId) throw new Error("childId mismatch");
}

export function createPrepare(input: unknown, sessionId?: string): CreateIntent {
	if (!record(input)) throw new Error("Expected a JSON object");
	const { parentId, designAnchor } = validateAnchor(input.parentId, input.designAnchor);
	const { createIntentId, taskKey } = newOpaquePair();
	const exactPayload = exact(input.creationPayload, "creationPayload");
	if (!record(exactPayload)) throw new Error("Expected a JSON object");
	if (Object.prototype.hasOwnProperty.call(exactPayload, "parentId") && exactPayload.parentId !== parentId) {
		throw new Error("parentId mismatch");
	}
	const { identityComment: _callerIdentityComment, designAnchor: _designAnchor, ...issueFields } = exactPayload;
	const creationPayload = { ...issueFields, parentId };
	const identityComment = canonicalIdentityComment(taskKey);
	return append({ kind: "create", createIntentId, taskKey, parentId, designAnchor, creationPayload, identityComment, state: "prepared" }, sessionId);
}

export function createChild(intentId: string, association: unknown, sessionId?: string): CreateIntent {
	const found = findIntent(intentId, sessionId);
	if (found.intent.kind !== "create" || found.intent.state !== "prepared") throw new Error("Invalid create-child transition");
	verifyAssociation(found.intent, association);
	if (!record(association)) throw new Error("Expected a JSON object");
	return replace(intentId, { ...found.intent, childId: nonblank(association.childId, "childId"), state: "child-created" }, sessionId);
}

export interface CreateCompleteVerification extends Association {
	creationPayload: unknown;
	identityComment: unknown;
}

export function createComplete(intentId: string, verification: unknown, sessionId?: string): CreateIntent {
	const found = findIntent(intentId, sessionId);
	if (found.intent.kind !== "create" || (found.intent.state !== "child-created" && found.intent.state !== "complete")) throw new Error("Invalid create-complete transition");
	if (!record(verification)) throw new Error("Expected a JSON object");
	verifyAssociation(found.intent, verification);
	const payload = found.intent.creationPayload;
	if (!record(payload)) throw new Error("Expected a JSON object");
	if (!isDeepStrictEqual(found.intent.identityComment, canonicalIdentityComment(found.intent.taskKey))) {
		throw new Error("stored identityComment mismatch");
	}
	if (!isDeepStrictEqual(exact(verification.creationPayload, "creationPayload"), payload)) throw new Error("creationPayload verification mismatch");
	if (!isDeepStrictEqual(exact(verification.identityComment, "identityComment"), found.intent.identityComment)) throw new Error("identityComment verification mismatch");
	if (found.intent.state === "complete") return found.intent;
	return replace(intentId, { ...found.intent, state: "complete" }, sessionId);
}

export function updatePrepare(input: unknown, sessionId?: string): UpdateIntent {
	if (!record(input)) throw new Error("Expected a JSON object");
	const childId = nonblank(input.childId, "childId");
	const { parentId, designAnchor } = validateAnchor(input.parentId, input.designAnchor);
	const changeComment = nonblank(input.changeComment, "changeComment");
	return append({ kind: "update", updateIntentId: randomUUID(), childId, parentId, designAnchor, before: exact(input.before, "before"), after: exact(input.after, "after"), changeComment, state: "prepared" }, sessionId);
}

export function updateMutationWritten(intentId: string, association: unknown, sessionId?: string): UpdateIntent {
	const found = findIntent(intentId, sessionId);
	if (found.intent.kind !== "update" || found.intent.state !== "prepared") throw new Error("Invalid update-mutation-written transition");
	verifyAssociation(found.intent, association);
	return replace(intentId, { ...found.intent, state: "mutation-written" }, sessionId);
}

export interface UpdateCompleteVerification extends Association {
	body: unknown;
	relations: unknown;
	changeComment: unknown;
}

export function updateComplete(intentId: string, verification: unknown, sessionId?: string): UpdateIntent {
	const found = findIntent(intentId, sessionId);
	if (found.intent.kind !== "update" || found.intent.state !== "mutation-written") throw new Error("Invalid update-complete transition");
	if (!record(verification)) throw new Error("Expected a JSON object");
	verifyAssociation(found.intent, verification);
	const after = found.intent.after;
	if (!record(after)) throw new Error("Expected a JSON object");
	if (!isDeepStrictEqual(exact(verification.body, "body"), after.body)) throw new Error("body verification mismatch");
	if (!isDeepStrictEqual(exact(verification.relations, "relations"), after.relations)) throw new Error("relations verification mismatch");
	if (!isDeepStrictEqual(exact(verification.changeComment, "changeComment"), found.intent.changeComment)) throw new Error("changeComment verification mismatch");
	return replace(intentId, { ...found.intent, state: "complete" }, sessionId);
}

export function manualReconciliation(intentId: string, reason: unknown, sessionId?: string): Intent {
	const found = findIntent(intentId, sessionId);
	const cleanReason = nonblank(reason, "reason");
	return replace(intentId, { ...found.intent, state: "manual-reconciliation-required", reason: cleanReason }, sessionId);
}

export function getIntent(intentId: string, sessionId?: string): Intent {
	return findIntent(intentId, sessionId).intent;
}

type PendingIntentEntry = Extract<PendingEntry, { intentId: string }>;

function pendingEntry(sourceSessionId: string, intent: Intent): PendingIntentEntry | undefined {
	if (intent.kind === "create") {
		const intentId = nonblank(intent.createIntentId, "createIntentId");
		const parentId = nonblank(intent.parentId, "parentId");
		const designAnchor = nonblank(intent.designAnchor, "designAnchor");
		if (!TERMINAL_STATES.has(intent.state) && !new Set<JournalState>(["prepared", "child-created"]).has(intent.state)) throw new Error("Malformed task-write journal state");
		const entry: PendingIntentEntry = { sourceSessionId, intentId, kind: intent.kind, state: intent.state, parentId, designAnchor };
		if (intent.childId !== undefined) entry.childId = nonblank(intent.childId, "childId");
		if (TERMINAL_STATES.has(intent.state)) {
			entry.taskKey = nonblank(intent.taskKey, "taskKey");
		}
		return entry;
	}
	if (intent.kind !== "update") throw new Error("Malformed task-write journal kind");
	const intentId = nonblank(intent.updateIntentId, "updateIntentId");
	if (!TERMINAL_STATES.has(intent.state) && !new Set<JournalState>(["prepared", "mutation-written"]).has(intent.state)) throw new Error("Malformed task-write journal state");
	if (TERMINAL_STATES.has(intent.state)) {
		return {
			sourceSessionId,
			intentId,
			kind: intent.kind,
			state: intent.state,
			parentId: nonblank(intent.parentId, "parentId"),
			designAnchor: nonblank(intent.designAnchor, "designAnchor"),
			childId: nonblank(intent.childId, "childId"),
		};
	}
	return {
		sourceSessionId,
		intentId,
		kind: intent.kind,
		state: intent.state,
		parentId: nonblank(intent.parentId, "parentId"),
		designAnchor: nonblank(intent.designAnchor, "designAnchor"),
		childId: nonblank(intent.childId, "childId"),
	};
}

export function receiptAck(intentId: string, verification: unknown, sessionId?: string): Intent {
	return withJournalLock(sessionId, () => {
		const found = findIntent(intentId, sessionId);
		if (!TERMINAL_STATES.has(found.intent.state)) throw new Error("Cannot acknowledge a nonterminal intent");
		if (!record(verification)) throw new Error("Expected a JSON object");
		const { parentId, designAnchor } = validateAnchor(verification.parentId, verification.designAnchor);
		if (found.intent.parentId !== parentId || found.intent.designAnchor !== designAnchor) throw new Error("Parent or designAnchor mismatch");
		if (found.intent.kind === "create") {
			if (verification.taskKey !== found.intent.taskKey) throw new Error("taskKey verification mismatch");
			const storedHasChild = found.intent.childId !== undefined;
			const verifiedHasChild = Object.prototype.hasOwnProperty.call(verification, "childId");
			if (storedHasChild !== verifiedHasChild || (storedHasChild && verification.childId !== found.intent.childId)) throw new Error("childId verification mismatch");
		} else if (verification.childId !== found.intent.childId) {
			throw new Error("childId verification mismatch");
		}
		const remaining = found.journal.intents.filter((_intent, index) => index !== found.index);
		if (remaining.length === 0) unlinkSync(journalPath(sessionId));
		else writeJournal({ version: found.journal.version, intents: remaining }, sessionId);
		return found.intent;
	});
}

export function listPending(): PendingEntry[] {
	const omtDir = getOmtDir();
	if (!existsSync(omtDir)) return [];
	const files = readdirSync(omtDir)
		.map((name) => ({ name, match: /^task-write-journal-([A-Za-z0-9_-]+)\.json$/.exec(name) }))
		.filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
		.sort((a, b) => a.match[1].localeCompare(b.match[1]));
	const entries: PendingEntry[] = [];
	for (const file of files) {
		const sourceSessionId = file.match[1];
		try {
			const journal = readJournal(sourceSessionId);
			const pending = journal.intents
				.map((intent) => pendingEntry(sourceSessionId, intent))
				.filter((entry): entry is PendingIntentEntry => entry !== undefined)
				.sort((a, b) => a.intentId.localeCompare(b.intentId));
			entries.push(...pending);
		} catch (error) {
			entries.push({ sourceSessionId, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return entries;
}

async function readStdin(): Promise<unknown> {
	let text = "";
	for await (const chunk of process.stdin) text += chunk;
	try { return JSON.parse(text); } catch { throw new Error("Malformed JSON stdin"); }
}

function jsonOutput(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
	const command = process.argv[2];
	if (!command) throw new Error("Missing command");
	const args = process.argv.slice(3);
	let sourceSessionId: string | undefined;
	const positional: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--source-session") {
			if (sourceSessionId !== undefined || args[index + 1] === undefined) throw new Error("--source-session requires a session id");
			sourceSessionId = args[index + 1];
			index += 1;
		} else {
			positional.push(args[index]);
		}
	}
	if (sourceSessionId !== undefined && !isSafeSessionId(sourceSessionId)) throw new Error("Unsafe session id");
	if (sourceSessionId !== undefined && (command === "create-prepare" || command === "update-prepare" || command === "list")) throw new Error("--source-session is not supported for this command");
	const id = positional[0];
	let result: unknown;
	if (command === "list") {
		if (positional.length !== 1 || (positional[0] !== "--pending" && positional[0] !== "--reconciliation")) throw new Error("Usage: list --pending|--reconciliation");
		result = positional[0] === "--pending" ? listPending() : listReconciliation();
	} else if (command === "create-prepare") {
		result = createPrepare(await readStdin(), sourceSessionId);
	} else if (command === "create-child") {
		result = createChild(id ?? "", await readStdin(), sourceSessionId);
	} else if (command === "create-complete") {
		result = createComplete(id ?? "", await readStdin(), sourceSessionId);
	} else if (command === "update-prepare") {
		result = updatePrepare(await readStdin(), sourceSessionId);
	} else if (command === "update-mutation-written") {
		result = updateMutationWritten(id ?? "", await readStdin(), sourceSessionId);
	} else if (command === "update-complete") {
		result = updateComplete(id ?? "", await readStdin(), sourceSessionId);
	} else if (command === "manual-reconciliation") {
		const input = await readStdin();
		if (!record(input)) throw new Error("Expected a JSON object");
		result = manualReconciliation(id ?? "", input.reason, sourceSessionId);
	} else if (command === "manual-reconciliation-missing") {
		const input = await readStdin();
		if (!record(input)) throw new Error("Expected a JSON object");
		result = manualReconciliationMissing(id ?? "", input.reason, sourceSessionId);
	} else if (command === "quarantine-journal") {
		const input = await readStdin();
		if (!record(input)) throw new Error("Expected a JSON object");
		result = quarantineJournal(input.reason, sourceSessionId);
	} else if (command === "receipt-ack") {
		result = receiptAck(id ?? "", await readStdin(), sourceSessionId);
	} else if (command === "get") {
		result = getIntent(id ?? "", sourceSessionId);
	} else {
		throw new Error(`Unknown command: ${command}`);
	}
	jsonOutput(result);
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}

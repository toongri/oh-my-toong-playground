#!/usr/bin/env bun
/** Session-scoped, crash-atomic journal for craft-tasks PM writes. */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
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

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected a JSON object");
	return value as Record<string, unknown>;
}

function nonblank(value: unknown, name: string): string {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a nonblank string`);
	return value;
}

function exact(value: unknown, name: string): unknown {
	if (value === undefined) throw new Error(`${name} is required`);
	return value;
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

export function journalPath(sessionId = resolveSessionIdOrThrow()): string {
	if (!isSafeSessionId(sessionId)) throw new Error("Unsafe session id");
	return `${getOmtDir()}/${JOURNAL_PREFIX}${sessionId}.json`;
}

function emptyJournal(): Journal {
	return { version: 1, intents: [] };
}

function readJournal(sessionId = resolveSessionIdOrThrow()): Journal {
	const path = journalPath(sessionId);
	if (!existsSync(path)) return emptyJournal();
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new Error("Malformed task-write journal JSON");
	}
	const data = record(parsed);
	if (data.version !== 1 || !Array.isArray(data.intents)) throw new Error("Malformed task-write journal shape");
	return data as unknown as Journal;
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

function append(intent: Intent, sessionId?: string): Intent {
	const journal = readJournal(sessionId);
	const intentId = intent.kind === "create" ? intent.createIntentId : intent.updateIntentId;
	if (journal.intents.some((entry) => (entry.kind === "create" ? entry.createIntentId : entry.updateIntentId) === intentId)) {
		throw new Error("Intent ID collision");
	}
	journal.intents.push(intent);
	writeJournal(journal, sessionId);
	return intent;
}

function findIntent(id: string, sessionId?: string): { journal: Journal; index: number; intent: Intent } {
	nonblank(id, "intent ID");
	const journal = readJournal(sessionId);
	const index = journal.intents.findIndex((entry) => (entry.kind === "create" ? entry.createIntentId : entry.updateIntentId) === id);
	if (index < 0) throw new Error(`Unknown intent: ${id}`);
	return { journal, index, intent: journal.intents[index] };
}

function replace(id: string, next: Intent, sessionId?: string): Intent {
	const found = findIntent(id, sessionId);
	if (TERMINAL_STATES.has(found.intent.state)) throw new Error("Cannot mutate a terminal intent");
	found.journal.intents[found.index] = next;
	writeJournal(found.journal, sessionId);
	return next;
}

function verifyAssociation(intent: Intent, association: Association): void {
	const childId = nonblank(association.childId, "childId");
	const { parentId, designAnchor } = validateAnchor(association.parentId, association.designAnchor);
	if (intent.parentId !== parentId || intent.designAnchor !== designAnchor) throw new Error("Parent or designAnchor mismatch");
	if ("childId" in intent && intent.childId !== undefined && intent.childId !== childId) throw new Error("childId mismatch");
}

export function createPrepare(input: CreatePrepareInput, sessionId?: string): CreateIntent {
	const data = record(input);
	const { parentId, designAnchor } = validateAnchor(data.parentId, data.designAnchor);
	const { createIntentId, taskKey } = newOpaquePair();
	return append({ kind: "create", createIntentId, taskKey, parentId, designAnchor, creationPayload: exact(data.creationPayload, "creationPayload"), state: "prepared" }, sessionId) as CreateIntent;
}

export function createChild(intentId: string, association: Association, sessionId?: string): CreateIntent {
	const found = findIntent(intentId, sessionId);
	if (found.intent.kind !== "create" || found.intent.state !== "prepared") throw new Error("Invalid create-child transition");
	verifyAssociation(found.intent, association);
	return replace(intentId, { ...found.intent, childId: nonblank(association.childId, "childId"), state: "child-created" }, sessionId) as CreateIntent;
}

export interface CreateCompleteVerification extends Association {
	body: unknown;
	relations: unknown;
	identityComment: unknown;
}

export function createComplete(intentId: string, verification: CreateCompleteVerification, sessionId?: string): CreateIntent {
	const found = findIntent(intentId, sessionId);
	if (found.intent.kind !== "create" || found.intent.state !== "child-created") throw new Error("Invalid create-complete transition");
	verifyAssociation(found.intent, verification);
	const payload = record(found.intent.creationPayload);
	if (!isDeepStrictEqual(exact(verification.body, "body"), payload.body)) throw new Error("body verification mismatch");
	if (!isDeepStrictEqual(exact(verification.relations, "relations"), payload.relations)) throw new Error("relations verification mismatch");
	if (!isDeepStrictEqual(exact(verification.identityComment, "identityComment"), payload.identityComment)) throw new Error("identityComment verification mismatch");
	return replace(intentId, { ...found.intent, state: "complete" }, sessionId) as CreateIntent;
}

export function updatePrepare(input: UpdatePrepareInput, sessionId?: string): UpdateIntent {
	const data = record(input);
	const childId = nonblank(data.childId, "childId");
	const { parentId, designAnchor } = validateAnchor(data.parentId, data.designAnchor);
	const changeComment = nonblank(data.changeComment, "changeComment");
	return append({ kind: "update", updateIntentId: randomUUID(), childId, parentId, designAnchor, before: exact(data.before, "before"), after: exact(data.after, "after"), changeComment, state: "prepared" }, sessionId) as UpdateIntent;
}

export function updateMutationWritten(intentId: string, association: Association, sessionId?: string): UpdateIntent {
	const found = findIntent(intentId, sessionId);
	if (found.intent.kind !== "update" || found.intent.state !== "prepared") throw new Error("Invalid update-mutation-written transition");
	verifyAssociation(found.intent, association);
	return replace(intentId, { ...found.intent, state: "mutation-written" }, sessionId) as UpdateIntent;
}

export interface UpdateCompleteVerification extends Association {
	body: unknown;
	relations: unknown;
	changeComment: unknown;
}

export function updateComplete(intentId: string, verification: UpdateCompleteVerification, sessionId?: string): UpdateIntent {
	const found = findIntent(intentId, sessionId);
	if (found.intent.kind !== "update" || found.intent.state !== "mutation-written") throw new Error("Invalid update-complete transition");
	verifyAssociation(found.intent, verification);
	const after = record(found.intent.after);
	if (!isDeepStrictEqual(exact(verification.body, "body"), after.body)) throw new Error("body verification mismatch");
	if (!isDeepStrictEqual(exact(verification.relations, "relations"), after.relations)) throw new Error("relations verification mismatch");
	if (!isDeepStrictEqual(exact(verification.changeComment, "changeComment"), found.intent.changeComment)) throw new Error("changeComment verification mismatch");
	return replace(intentId, { ...found.intent, state: "complete" }, sessionId) as UpdateIntent;
}

export function manualReconciliation(intentId: string, reason: string, sessionId?: string): Intent {
	const found = findIntent(intentId, sessionId);
	const cleanReason = nonblank(reason, "reason");
	return replace(intentId, { ...found.intent, state: "manual-reconciliation-required", reason: cleanReason }, sessionId);
}

export function getIntent(intentId: string, sessionId?: string): Intent {
	return findIntent(intentId, sessionId).intent;
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
	const id = process.argv[3];
	if (!command) throw new Error("Missing command");
	let result: unknown;
	if (command === "create-prepare") {
		const input = record(await readStdin());
		result = createPrepare({
			parentId: input.parentId as string,
			designAnchor: input.designAnchor as string,
			creationPayload: Object.prototype.hasOwnProperty.call(input, "creationPayload") ? input.creationPayload : input,
		});
	} else if (command === "create-child") {
		result = createChild(id ?? "", record(await readStdin()) as unknown as Association);
	} else if (command === "create-complete") {
		result = createComplete(id ?? "", record(await readStdin()) as unknown as CreateCompleteVerification);
	} else if (command === "update-prepare") {
		result = updatePrepare(record(await readStdin()) as unknown as UpdatePrepareInput);
	} else if (command === "update-mutation-written") {
		result = updateMutationWritten(id ?? "", record(await readStdin()) as unknown as Association);
	} else if (command === "update-complete") {
		result = updateComplete(id ?? "", record(await readStdin()) as unknown as UpdateCompleteVerification);
	} else if (command === "manual-reconciliation") {
		const input = record(await readStdin());
		result = manualReconciliation(id ?? "", input.reason as string);
	} else if (command === "get") {
		result = getIntent(id ?? "");
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

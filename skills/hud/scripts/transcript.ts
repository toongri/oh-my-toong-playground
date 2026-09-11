import { stat } from "fs/promises";
import {
	closeSync,
	createReadStream,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	renameSync,
	writeFileSync,
} from "fs";
import { join } from "path";
import { createHash, randomUUID } from "crypto";
import { logError } from "@lib/logging";
import { getCacheDir } from "./cache.ts";
import { splitJsonlBytes } from "./transcript-cache.ts";
import type { AgentInfo } from "./types.ts";

interface ContentItem {
	type?: string;
	id?: string;
	name?: string;
	input?: { skill?: string; prompt?: string; subagent_type?: string };
	tool_use_id?: string;
	content?: string;
}
interface TranscriptEntry {
	tool?: string;
	toolName?: string;
	name?: string;
	status?: string;
	state?: string;
	timestamp?: string;
	toolUseId?: string;
	model?: string;
	message?: { model?: string; content?: ContentItem[] };
}
export interface TranscriptResult {
	runningAgents: number;
	activeSkill: string | null;
	agents: AgentInfo[];
	sessionStartedAt: Date | null;
}
interface TranscriptIdentity {
	dev: number;
	ino: number;
	size: number;
	mtimeMs: number;
	ctimeMs: number;
}
interface TranscriptCache {
	version: 1;
	generation: number;
	identity: TranscriptIdentity;
	offset: number;
	pending: string;
	headHash: string;
	cursorStart: number;
	cursorHash: string;
	agents: AgentInfo[];
	activeSkill: string | null;
	sessionStartedAt: string | null;
}
interface State {
	agents: Map<string, AgentInfo>;
	activeSkill: string | null;
	earliest: Date | null;
}

let transcriptBytesRead = 0;
const FINGERPRINT_BYTES = 128;
export function resetTranscriptReadStats(): void {
	transcriptBytesRead = 0;
}
export function getTranscriptReadStats(): number {
	return transcriptBytesRead;
}
export function modelToTier(modelId: string): "o" | "s" | "h" {
	if (modelId.includes("opus")) return "o";
	if (modelId.includes("haiku")) return "h";
	return "s";
}

function cachePath(transcriptPath: string): string {
	const key = createHash("sha256").update(transcriptPath).digest("hex").slice(0, 24);
	return join(getCacheDir(), `hud-transcript-${key}.json`);
}
function emptyState(): State {
	return { agents: new Map(), activeSkill: null, earliest: null };
}
function resultFrom(state: State): TranscriptResult {
	return {
		runningAgents: state.agents.size,
		activeSkill: state.activeSkill,
		agents: Array.from(state.agents.values()),
		sessionStartedAt: state.earliest,
	};
}

function applyEntry(entry: TranscriptEntry, state: State): void {
	if (entry.timestamp) {
		const date = new Date(entry.timestamp);
		if (!Number.isNaN(date.getTime()) && (!state.earliest || date < state.earliest))
			state.earliest = date;
	}
	if (entry.tool === "Agent" || entry.toolName === "Agent") {
		const id = entry.toolUseId;
		if (id && (entry.status === "started" || entry.state === "running"))
			state.agents.set(id, { type: "S", model: modelToTier(entry.model || ""), id });
		else if (id && (entry.status === "completed" || entry.state === "done"))
			state.agents.delete(id);
	}
	if ((entry.tool === "Skill" || entry.toolName === "Skill") && entry.name)
		state.activeSkill = entry.name;
	const content = entry.message?.content;
	if (!Array.isArray(content)) return;
	for (const item of content) {
		if (item.type === "tool_use" && item.id) {
			if (item.name === "Agent")
				state.agents.set(item.id, {
					type: "S",
					model: modelToTier(entry.message?.model || ""),
					id: item.id,
					name: item.input?.subagent_type,
				});
			else if (item.name === "Skill" && item.input?.skill) state.activeSkill = item.input.skill;
		} else if (item.type === "tool_result" && item.tool_use_id)
			state.agents.delete(item.tool_use_id);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isTranscriptEntry(value: unknown): value is TranscriptEntry {
	return isRecord(value);
}
function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}
function isAgent(value: unknown): value is AgentInfo {
	return (
		isRecord(value) &&
		value.type === "S" &&
		typeof value.model === "string" &&
		typeof value.id === "string" &&
		(value.name === undefined || typeof value.name === "string")
	);
}
function isIdentity(value: unknown): value is TranscriptIdentity {
	return (
		isRecord(value) &&
		isFiniteNumber(value.dev) &&
		isFiniteNumber(value.ino) &&
		isFiniteNumber(value.size) &&
		isFiniteNumber(value.mtimeMs) &&
		isFiniteNumber(value.ctimeMs)
	);
}
function isCache(value: unknown): value is TranscriptCache {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		!isFiniteNumber(value.generation) ||
		!isIdentity(value.identity) ||
		!isFiniteNumber(value.offset) ||
		value.offset < 0 ||
		value.offset > value.identity.size ||
		typeof value.pending !== "string" ||
		typeof value.headHash !== "string" ||
		!isFiniteNumber(value.cursorStart) ||
		value.cursorStart < 0 ||
		value.cursorStart > value.offset ||
		typeof value.cursorHash !== "string" ||
		!Array.isArray(value.agents) ||
		!value.agents.every(isAgent) ||
		(value.activeSkill !== null && typeof value.activeSkill !== "string") ||
		(value.sessionStartedAt !== null && typeof value.sessionStartedAt !== "string")
	)
		return false;
	try {
		const pending = Buffer.from(value.pending, "base64");
		if (pending.toString("base64") !== value.pending) return false;
	} catch {
		return false;
	}
	return true;
}
function readCache(path: string): TranscriptCache | null {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isCache(value) ? value : null;
	} catch {
		return null;
	}
}
function restore(cache: TranscriptCache): State {
	const state = emptyState();
	for (const agent of cache.agents) state.agents.set(agent.id, agent);
	state.activeSkill = cache.activeSkill;
	state.earliest = cache.sessionStartedAt ? new Date(cache.sessionStartedAt) : null;
	return state;
}

function readBytes(path: string, start: number, length: number): Buffer {
	if (length <= 0) return Buffer.alloc(0);
	const fd = openSync(path, "r");
	const buffer = Buffer.alloc(length);
	try {
		const count = readSync(fd, buffer, 0, length, start);
		transcriptBytesRead += count;
		return buffer.subarray(0, count);
	} finally {
		closeSync(fd);
	}
}
function fingerprint(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}
function headHash(path: string, size: number): string | null {
	try {
		return fingerprint(readBytes(path, 0, Math.min(FINGERPRINT_BYTES, size)));
	} catch {
		return null;
	}
}
function cursorInfo(path: string, offset: number): { start: number; hash: string } | null {
	try {
		const start = Math.max(0, offset - FINGERPRINT_BYTES);
		return { start, hash: fingerprint(readBytes(path, start, offset - start)) };
	} catch {
		return null;
	}
}
function identityFrom(file: {
	dev: bigint | number;
	ino: bigint | number;
	size: number;
	mtimeMs: number;
	ctimeMs: number;
}): TranscriptIdentity {
	return {
		dev: Number(file.dev),
		ino: Number(file.ino),
		size: file.size,
		mtimeMs: file.mtimeMs,
		ctimeMs: file.ctimeMs,
	};
}
function sameIdentity(a: TranscriptIdentity, b: TranscriptIdentity): boolean {
	return (
		a.dev === b.dev &&
		a.ino === b.ino &&
		a.size === b.size &&
		a.mtimeMs === b.mtimeMs &&
		a.ctimeMs === b.ctimeMs
	);
}
function sameFile(a: TranscriptIdentity, b: TranscriptIdentity): boolean {
	return a.dev === b.dev && a.ino === b.ino;
}

function writeCache(path: string, value: TranscriptCache): void {
	try {
		const dir = getCacheDir();
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const current = readCache(path);
		if (
			current &&
			(current.generation > value.generation ||
				(current.generation === value.generation && current.offset >= value.offset))
		)
			return;
		const temporary = `${path}.${randomUUID()}.tmp`;
		writeFileSync(temporary, JSON.stringify(value), "utf8");
		renameSync(temporary, path);
	} catch (error) {
		logError(
			`Failed to write transcript cache: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function readSnapshot(
	path: string,
	start: number,
	end: number,
	expected: TranscriptIdentity,
	onChunk: (chunk: Buffer) => void,
): Promise<boolean> {
	return await new Promise((resolve, reject) => {
		const stream = createReadStream(path, { start, end: Math.max(start, end - 1) });
		stream.on("data", (chunk: Buffer) => {
			transcriptBytesRead += chunk.length;
			onChunk(chunk);
		});
		stream.on("end", async () => {
			try {
				const current = await stat(path);
				resolve(sameIdentity(identityFrom(current), expected));
			} catch {
				resolve(false);
			}
		});
		stream.on("error", reject);
	});
}

export async function parseTranscript(transcriptPath: string): Promise<TranscriptResult> {
	let file;
	try {
		file = await stat(transcriptPath);
	} catch (error) {
		logError(
			`Failed to read transcript file: ${error instanceof Error ? error.message : String(error)}`,
		);
		return resultFrom(emptyState());
	}
	const identity = identityFrom(file);
	const path = cachePath(transcriptPath);
	const cached = readCache(path);
	let state = emptyState();
	let offset = 0;
	let pending = Buffer.alloc(0);
	let generation = cached?.generation || 0;
	try {
		const currentHead = headHash(transcriptPath, identity.size);
		const currentCursor = cached ? cursorInfo(transcriptPath, cached.offset) : null;
		if (
			cached &&
			sameIdentity(cached.identity, identity) &&
			cached.offset === identity.size &&
			currentHead === cached.headHash &&
			currentCursor?.hash === cached.cursorHash
		)
			return resultFrom(restore(cached));
		if (
			cached &&
			sameFile(cached.identity, identity) &&
			identity.size > cached.identity.size &&
			cached.offset === cached.identity.size &&
			currentHead === cached.headHash &&
			currentCursor?.hash === cached.cursorHash
		) {
			state = restore(cached);
			offset = cached.offset;
			pending = Buffer.from(cached.pending, "base64");
		} else if (cached) generation += 1;
		let remaining: Buffer<ArrayBufferLike> = pending;
		const processChunk = (chunk: Buffer): void => {
			const split = splitJsonlBytes(chunk, remaining);
			remaining = split.pending;
			for (const lineBytes of split.lines) {
				const raw = new TextDecoder().decode(lineBytes);
				const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
				if (!line) continue;
				try {
					const parsed: unknown = JSON.parse(line);
					if (isTranscriptEntry(parsed)) applyEntry(parsed, state);
				} catch (error) {
					logError(
						`Failed to parse transcript line: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		};
		const stable = await readSnapshot(
			transcriptPath,
			offset,
			identity.size,
			identity,
			processChunk,
		);
		if (remaining.length > 0) {
			try {
				const parsed: unknown = JSON.parse(new TextDecoder().decode(remaining));
				if (isTranscriptEntry(parsed)) {
					applyEntry(parsed, state);
					remaining = Buffer.alloc(0);
				}
			} catch {
				/* retain partial final JSONL */
			}
		}
		const finalCursor = cursorInfo(transcriptPath, identity.size);
		if (stable && currentHead && finalCursor)
			writeCache(path, {
				version: 1,
				generation,
				identity,
				offset: identity.size,
				pending: remaining.toString("base64"),
				headHash: currentHead,
				cursorStart: finalCursor.start,
				cursorHash: finalCursor.hash,
				agents: Array.from(state.agents.values()),
				activeSkill: state.activeSkill,
				sessionStartedAt: state.earliest?.toISOString() || null,
			});
	} catch (error) {
		logError(
			`Failed to read transcript file: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return resultFrom(state);
}

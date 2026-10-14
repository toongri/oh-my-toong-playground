import {
	closeSync,
	openSync,
	readFileSync,
	readSync,
	statSync,
	writeFileSync,
	renameSync,
	unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { RULE_MARKER_PATTERN } from "./rules/index.js";

export interface TranscriptRuleQuery {
	readonly body: string;
	readonly marker: string | ReadonlyArray<string>;
}

export interface TranscriptRuleCacheOptions {
	readonly latestCompactedReplacementOnly?: boolean;
}

/**
 * Rule blocks seen in one scope of the transcript. `blocks` maps an open tag to
 * the normalized starts of the bodies that followed it. In the raw stream a
 * block whose body has not reached BODY_PREFIX_CHARS yet stays in `rawOpen`
 * until more lines arrive, and queries read it from there. A decoded block
 * never outlives its record, so the decoded stream keeps no open state.
 */
interface Evidence {
	blocks: Record<string, string[]>;
	rawOpen: string;
}

interface CacheState {
	version: 4;
	identity: { dev: number; ino: number; size: number; mtimeMs: number };
	cursor: number;
	pending: string;
	head: string;
	compactSeen: boolean;
	/** Every block in the transcript (default mode). */
	all: Evidence;
	/** Blocks in the latest compaction's replacement history and after it. */
	latest: Evidence;
}

// Same length the query body is cut to; a stored block start this long can
// decide any query.
const BODY_PREFIX_CHARS = 2_000;
// An open block is closed after this much raw text even if leading whitespace
// kept its normalized start short, so `open` stays bounded.
const MAX_OPEN_CHARS = 4 * BODY_PREFIX_CHARS;
const MARKER_PREFIX = "<rules name=";
const ESCAPED_MARKER_PREFIX = "\\u003crules name=";
const MAX_HEAD_BYTES = 1_024;
const READ_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Answers, per query, whether the transcript carries a hook-emitted rule block:
 * one of the query's open tags followed by a body that starts with the query's
 * body. Blocks are indexed while new bytes are read, so a query never seen
 * before is answered from the index instead of a rescan from offset 0.
 */
export function queryTranscriptRuleCache(
	path: string,
	input: ReadonlyArray<TranscriptRuleQuery>,
	options: TranscriptRuleCacheOptions = {},
): boolean[] {
	if (input.length === 0) return [];
	let stat;
	try {
		stat = statSync(path);
		if (!stat.isFile()) return input.map(() => false);
	} catch {
		return input.map(() => false);
	}
	const identity = { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
	const head = readHead(path, identity.size);
	let state = readCache(`${path}.rule-cache.json`);
	const rebuild =
		state === null ||
		state.identity.dev !== identity.dev ||
		state.identity.ino !== identity.ino ||
		(state.identity.size === identity.size && state.identity.mtimeMs !== identity.mtimeMs) ||
		identity.size < state.cursor ||
		state.head !== head;
	if (state === null || rebuild) state = emptyState(identity, head);
	if (state.cursor < identity.size) readAndApply(state, path, identity.size);
	state.identity = identity;
	state.head = head;
	writeCache(`${path}.rule-cache.json`, state);

	const latest = options.latestCompactedReplacementOnly === true;
	const view = withPending(state);
	const evidence = latest ? (view.compactSeen ? view.latest : null) : view.all;
	return input.map((query) => evidence !== null && hasBlock(evidence, query));
}

function hasBlock(evidence: Evidence, query: TranscriptRuleQuery): boolean {
	const body = normalizeBody(query.body).trim().slice(0, BODY_PREFIX_CHARS);
	if (body.length === 0) return false;
	const markers = typeof query.marker === "string" ? [query.marker] : query.marker;
	for (const marker of markers) {
		if (evidence.blocks[marker]?.some((start) => start.startsWith(body)) === true) return true;
	}
	for (const match of evidence.rawOpen.matchAll(RULE_MARKER_PATTERN)) {
		if (!markers.includes(match[0])) continue;
		if (blockStart(evidence.rawOpen.slice(match.index + match[0].length)).startsWith(body))
			return true;
	}
	return false;
}

/** Reads [cursor, end) in chunks, keeping an unfinished last line as `pending`. */
function readAndApply(state: CacheState, path: string, end: number): void {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return;
	}
	try {
		let pending = Buffer.from(state.pending, "base64");
		let position = state.cursor;
		while (position < end) {
			const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, end - position));
			const read = readSync(fd, chunk, 0, chunk.length, position);
			if (read <= 0) break;
			position += read;
			const combined = Buffer.concat([pending, chunk.subarray(0, read)]);
			const newline = combined.lastIndexOf(0x0a);
			if (newline >= 0) {
				for (const line of combined.subarray(0, newline).toString("utf8").split("\n"))
					applyLine(state, line);
			}
			pending = Buffer.from(combined.subarray(newline + 1));
			state.pending = pending.toString("base64");
			state.cursor = position;
		}
	} catch {
		/* keep what was applied; the cursor marks the last applied chunk */
	} finally {
		closeSync(fd);
	}
}

/** The state as if the unfinished last line were complete, without storing it. */
function withPending(state: CacheState): CacheState {
	if (state.pending.length === 0) return state;
	const view: CacheState = {
		...state,
		all: { ...state.all },
		latest: { ...state.latest },
	};
	applyLine(view, Buffer.from(state.pending, "base64").toString("utf8"));
	return view;
}

function applyLine(state: CacheState, rawLine: string): void {
	const line = rawLine.replace(/\r$/, "");
	// Lines are parsed only when they can matter: they name a rule tag (plain or
	// with "<" JSON-escaped), continue an open block, or may be a compaction record.
	const relevant =
		line.includes(MARKER_PREFIX) ||
		line.includes(ESCAPED_MARKER_PREFIX) ||
		line.includes("compacted") ||
		isOpen(state.all) ||
		(state.compactSeen && isOpen(state.latest));
	if (!relevant) return;
	const parsed = parseJsonLine(line);
	const replacement = compactedReplacement(parsed);
	const decoded = parsed === null ? null : collectStringsToString(parsed);
	feedLine(state.all, line, decoded);
	if (replacement !== null) {
		state.compactSeen = true;
		state.latest = emptyEvidence();
		feedDecoded(state.latest, replacement.join("\n"));
	} else if (state.compactSeen) {
		feedLine(state.latest, line, decoded);
	}
}

function feedLine(evidence: Evidence, line: string, decoded: string | null): void {
	feedRaw(evidence, `${line}\n`);
	if (decoded !== null) feedDecoded(evidence, decoded);
}

/**
 * Appends a raw line to the raw stream and records every block whose body
 * start is complete. A block still short stays open, so a tag line and its
 * body on separate lines are joined.
 */
function feedRaw(evidence: Evidence, text: string): void {
	const open = evidence.rawOpen;
	if (open.length === 0 && !text.includes(MARKER_PREFIX)) return;
	const combined = open + text;
	let nextOpen = "";
	for (const match of combined.matchAll(RULE_MARKER_PATTERN)) {
		const after = combined.slice(match.index + match[0].length);
		const start = blockStart(after);
		if (start.length < BODY_PREFIX_CHARS && after.length < MAX_OPEN_CHARS) {
			if (nextOpen.length === 0) nextOpen = combined.slice(match.index);
			continue;
		}
		addBlock(evidence, match[0], start);
	}
	evidence.rawOpen = nextOpen;
}

/**
 * Records every block in one record's decoded text (its strings joined with
 * "\n"). The record delimits the block: a block that ends with the record keeps
 * the short body start it has, and nothing carries into the next record.
 */
function feedDecoded(evidence: Evidence, text: string): void {
	if (!text.includes(MARKER_PREFIX)) return;
	for (const match of text.matchAll(RULE_MARKER_PATTERN))
		addBlock(evidence, match[0], blockStart(text.slice(match.index + match[0].length)));
}

/** Copy-on-write, so a pending-line view never writes into the stored index. */
function addBlock(evidence: Evidence, marker: string, start: string): void {
	const starts = evidence.blocks[marker] ?? [];
	if (starts.includes(start)) return;
	evidence.blocks = { ...evidence.blocks, [marker]: [...starts, start] };
}

function blockStart(afterMarker: string): string {
	return normalizeBody(afterMarker).trimStart().slice(0, BODY_PREFIX_CHARS);
}

function normalizeBody(text: string): string {
	return text.slice(0, MAX_OPEN_CHARS).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isOpen(evidence: Evidence): boolean {
	return evidence.rawOpen.length > 0;
}

function emptyEvidence(): Evidence {
	return { blocks: {}, rawOpen: "" };
}

function emptyState(identity: CacheState["identity"], head: string): CacheState {
	return {
		version: 4,
		identity: { ...identity, size: 0 },
		cursor: 0,
		pending: "",
		head,
		compactSeen: false,
		all: emptyEvidence(),
		latest: emptyEvidence(),
	};
}

function compactedReplacement(value: unknown): string[] | null {
	if (
		!isRecord(value) ||
		value.type !== "compacted" ||
		!isRecord(value.payload) ||
		!Array.isArray(value.payload.replacement_history)
	)
		return null;
	const values: string[] = [];
	collectStrings(value.payload.replacement_history, values);
	return values;
}
function collectStringsToString(value: unknown): string {
	const values: string[] = [];
	collectStrings(value, values);
	return values.join("\n");
}
function collectStrings(value: unknown, output: string[]): void {
	if (typeof value === "string") {
		output.push(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectStrings(item, output);
		return;
	}
	if (isRecord(value)) for (const item of Object.values(value)) collectStrings(item, output);
}

function readHead(path: string, size: number): string {
	try {
		const fd = openSync(path, "r");
		try {
			const buffer = Buffer.alloc(Math.min(MAX_HEAD_BYTES, size));
			readSync(fd, buffer, 0, buffer.length, 0);
			return buffer.toString("base64");
		} finally {
			closeSync(fd);
		}
	} catch {
		return "";
	}
}
function readCache(path: string): CacheState | null {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(value) || value.version !== 4 || !isRecord(value.identity)) return null;
		const identity = value.identity;
		const all = readEvidence(value.all);
		const latest = readEvidence(value.latest);
		if (
			!isNumber(identity.dev) ||
			!isNumber(identity.ino) ||
			!isNumber(identity.size) ||
			!isNumber(identity.mtimeMs) ||
			!isNumber(value.cursor) ||
			typeof value.pending !== "string" ||
			typeof value.head !== "string" ||
			typeof value.compactSeen !== "boolean" ||
			all === null ||
			latest === null
		)
			return null;
		return {
			version: 4,
			identity: {
				dev: identity.dev,
				ino: identity.ino,
				size: identity.size,
				mtimeMs: identity.mtimeMs,
			},
			cursor: value.cursor,
			pending: value.pending,
			head: value.head,
			compactSeen: value.compactSeen,
			all,
			latest,
		};
	} catch {
		return null;
	}
}
function readEvidence(value: unknown): Evidence | null {
	if (
		!isRecord(value) ||
		!isRecord(value.blocks) ||
		typeof value.rawOpen !== "string"
	)
		return null;
	const blocks: Record<string, string[]> = {};
	for (const [marker, starts] of Object.entries(value.blocks)) {
		if (!Array.isArray(starts) || !starts.every((start) => typeof start === "string"))
			return null;
		blocks[marker] = starts;
	}
	return { blocks, rawOpen: value.rawOpen };
}
function writeCache(path: string, state: CacheState): void {
	const temp = join(dirname(path), `.${path.split("/").at(-1)}.${process.pid}.tmp`);
	try {
		writeFileSync(temp, JSON.stringify(state), "utf8");
		renameSync(temp, path);
	} catch {
		try {
			unlinkSync(temp);
		} catch {
			/* best effort */
		}
	}
}
function parseJsonLine(line: string): unknown | null {
	if (line.trim() === "") return null;
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

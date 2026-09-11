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

export interface TranscriptRuleQuery {
	readonly body: string;
	readonly marker: string | ReadonlyArray<string>;
}

export interface TranscriptRuleCacheOptions {
	readonly latestCompactedReplacementOnly?: boolean;
}

interface CacheQuery {
	body: string;
	marker: string[];
	bodySeen: boolean;
	markerSeen: boolean;
	bodyPending: boolean;
	markerPending: boolean;
}

interface CacheState {
	version: 2;
	identity: { dev: number; ino: number; size: number; mtimeMs: number };
	cursor: number;
	pending: string;
	rawTail: string;
	decodedTail: string;
	requestedLatest: boolean;
	compactSeen: boolean;
	head: string;
	queries: Record<string, CacheQuery>;
	preview?: Record<string, CacheQuery>;
	previewReset?: boolean;
}
interface PreviewResult {
	queries: Record<string, CacheQuery>;
	reset: boolean;
}

const MAX_TAIL_CHARS = 4_096;
const MAX_QUERIES = 256;
const MAX_HEAD_BYTES = 1_024;

export function queryTranscriptRuleCache(
	path: string,
	input: ReadonlyArray<TranscriptRuleQuery>,
	options: TranscriptRuleCacheOptions = {},
): boolean[] {
	if (input.length === 0) return [];
	const queries = input.map(normalizeQuery);
	let stat;
	try {
		stat = statSync(path);
		if (!stat.isFile()) return queries.map(() => false);
	} catch {
		return queries.map(() => false);
	}
	const latest = options.latestCompactedReplacementOnly === true;
	const identity = { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
	let state = readCache(`${path}.rule-cache.json`);
	const keys = queries.map(queryKey);
	const modeChanged = state !== null && state.requestedLatest !== latest;
	const fileChanged =
		state === null || state.identity.dev !== identity.dev || state.identity.ino !== identity.ino;
	const sameSizeRewrite =
		state !== null &&
		state.identity.size === identity.size &&
		state.identity.mtimeMs !== identity.mtimeMs;
	const truncated = state !== null && identity.size < state.cursor;
	const headChanged =
		state !== null && identity.size >= state.cursor && state.head !== readHead(path, identity.size);
	if (fileChanged || modeChanged || sameSizeRewrite || truncated || headChanged)
		state = emptyState(identity, latest, readHead(path, identity.size));
	if (state === null) return queries.map(() => false);
	const activeState = state;
	const missing = keys.some((key) => activeState.queries[key] === undefined);
	const needsAppend = activeState.cursor < identity.size;
	const retainedQueries = Object.values(activeState.queries).map((query) => ({
		body: query.body,
		marker: query.marker,
	}));
	const retainedKeys = Object.keys(activeState.queries);
	const allQueries = missing ? [...retainedQueries, ...queries] : retainedQueries;
	const allKeys = missing ? [...retainedKeys, ...keys] : retainedKeys;
	const deduped = dedupeQueries(allQueries, allKeys);
	if (missing) {
		state = emptyState(identity, latest, readHead(path, identity.size));
		readAndApply(state, path, 0, identity.size, deduped.queries, deduped.keys, latest);
	} else if (needsAppend) {
		readAndApply(
			activeState,
			path,
			activeState.cursor,
			identity.size,
			deduped.queries,
			deduped.keys,
			latest,
		);
	}
	state.identity = identity;
	state.head = readHead(path, identity.size);
	for (const [index, query] of queries.entries()) {
		const key = keys[index];
		if (key !== undefined && state.queries[key] === undefined)
			state.queries[key] = blankQuery(query);
	}
	if (state.preview === undefined && state.pending.length > 0) {
		const result = previewPending(
			state,
			Buffer.from(state.pending, "base64").toString("utf8"),
			latest,
			queries,
			keys,
		);
		state.preview = result.queries;
		state.previewReset = result.reset;
	}
	trimQueries(state, keys);
	const preview = state.preview;
	const previewReset = state.previewReset === true;
	delete state.preview;
	delete state.previewReset;
	writeCache(`${path}.rule-cache.json`, state);
	return keys.map((key) => {
		const query = state.queries[key];
		const pending = preview?.[key];
		return (
			query !== undefined &&
			(previewReset ? pending?.bodySeen === true : query.bodySeen || pending?.bodySeen === true) &&
			(previewReset
				? pending?.markerSeen === true
				: query.markerSeen || pending?.markerSeen === true)
		);
	});
}

function normalizeQuery(query: TranscriptRuleQuery): TranscriptRuleQuery {
	return {
		body: query.body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().slice(0, 2_000),
		marker: typeof query.marker === "string" ? query.marker : [...query.marker],
	};
}
function dedupeQueries(
	queries: ReadonlyArray<TranscriptRuleQuery>,
	keys: ReadonlyArray<string>,
): { queries: TranscriptRuleQuery[]; keys: string[] } {
	const seen = new Set<string>();
	const resultQueries: TranscriptRuleQuery[] = [];
	const resultKeys: string[] = [];
	for (const [index, query] of queries.entries()) {
		const key = keys[index];
		if (key === undefined || seen.has(key)) continue;
		seen.add(key);
		resultQueries.push(query);
		resultKeys.push(key);
	}
	return { queries: resultQueries, keys: resultKeys };
}
function queryKey(query: TranscriptRuleQuery): string {
	return JSON.stringify([query.body, query.marker]);
}
function blankQuery(query: TranscriptRuleQuery): CacheQuery {
	return {
		body: query.body,
		marker: typeof query.marker === "string" ? [query.marker] : [...query.marker],
		bodySeen: false,
		markerSeen: false,
		bodyPending: false,
		markerPending: false,
	};
}
function emptyState(identity: CacheState["identity"], latest: boolean, head: string): CacheState {
	return {
		version: 2,
		identity: { ...identity, size: 0 },
		cursor: 0,
		pending: "",
		rawTail: "",
		decodedTail: "",
		requestedLatest: latest,
		compactSeen: false,
		head,
		queries: {},
	};
}

function readAndApply(
	state: CacheState,
	path: string,
	start: number,
	end: number,
	queries: ReadonlyArray<TranscriptRuleQuery>,
	keys: ReadonlyArray<string>,
	latest: boolean,
): void {
	if (end < start) return;
	let bytes: Buffer;
	try {
		const fd = openSync(path, "r");
		try {
			bytes = Buffer.alloc(end - start);
			readSync(fd, bytes, 0, bytes.length, start);
		} finally {
			closeSync(fd);
		}
	} catch {
		return;
	}
	const combined = Buffer.concat([Buffer.from(state.pending, "base64"), bytes]);
	const newline = combined.lastIndexOf(0x0a);
	const completeBytes = newline < 0 ? Buffer.alloc(0) : combined.subarray(0, newline + 1);
	const pendingBytes = newline < 0 ? combined : combined.subarray(newline + 1);
	const completeText = completeBytes.toString("utf8");
	const pendingText = pendingBytes.toString("utf8");
	const lines = completeText.length === 0 ? [] : completeText.split("\n").slice(0, -1);
	const decoded: string[] = [];
	for (const line of lines) {
		const parsed = parseJsonLine(line.replace(/\r$/, ""));
		if (parsed !== null) collectStrings(parsed, decoded);
	}
	if (latest) {
		let latestIndex = -1;
		let replacement: string[] | null = null;
		for (const [index, line] of lines.entries()) {
			const value = compactedReplacement(parseJsonLine(line.replace(/\r$/, "")));
			if (value !== null) {
				latestIndex = index;
				replacement = value;
			}
		}
		if (replacement !== null) {
			state.compactSeen = true;
			resetQueries(state);
			state.rawTail = "";
			state.decodedTail = "";
			applyText(state, "", replacement.join("\n"), queries, keys, false);
			const later = lines.slice(latestIndex + 1);
			const laterDecoded: string[] = [];
			for (const line of later) {
				const parsed = parseJsonLine(line.replace(/\r$/, ""));
				if (parsed !== null) collectStrings(parsed, laterDecoded);
			}
			applyText(
				state,
				later.join("\n") + (later.length ? "\n" : ""),
				laterDecoded.join("\n"),
				queries,
				keys,
				false,
			);
		} else if (state.compactSeen)
			applyText(state, completeText, decoded.join("\n"), queries, keys, false);
	} else {
		// Default mode intentionally retains all pre-compaction evidence.
		applyText(state, completeText, decoded.join("\n"), queries, keys, false);
	}
	const previewResult = previewPending(state, pendingText, latest, queries, keys);
	state.preview = previewResult.queries;
	state.previewReset = previewResult.reset;
	state.pending = pendingBytes.toString("base64");
	state.cursor = end;
}

function applyText(
	state: CacheState,
	raw: string,
	decoded: string,
	queries: ReadonlyArray<TranscriptRuleQuery>,
	keys: ReadonlyArray<string>,
	pending: boolean,
): void {
	const rawSearch = state.rawTail + raw;
	const decodedSearch =
		state.decodedTail.length > 0 && decoded.length > 0
			? `${state.decodedTail}\n${decoded}`
			: state.decodedTail + decoded;
	for (const [index, query] of queries.entries()) {
		const key = keys[index];
		if (key === undefined) continue;
		const entry = state.queries[key] ?? blankQuery(query);
		const body = query.body;
		const markers = typeof query.marker === "string" ? [query.marker] : query.marker;
		if (body.length > 0 && (rawSearch.includes(body) || decodedSearch.includes(body))) {
			if (pending) entry.bodyPending = true;
			else entry.bodySeen = true;
		}
		if (markers.some((marker) => rawSearch.includes(marker) || decodedSearch.includes(marker))) {
			if (pending) entry.markerPending = true;
			else entry.markerSeen = true;
		}
		state.queries[key] = entry;
	}
	state.rawTail = rawSearch.slice(-MAX_TAIL_CHARS);
	state.decodedTail = decodedSearch.slice(-MAX_TAIL_CHARS);
}
function previewPending(
	state: CacheState,
	pendingText: string,
	latest: boolean,
	queries: ReadonlyArray<TranscriptRuleQuery>,
	keys: ReadonlyArray<string>,
): PreviewResult {
	const preview: CacheState = {
		...state,
		queries: Object.fromEntries(
			Object.entries(state.queries).map(([key, query]) => [key, { ...query }]),
		),
	};
	const parsed = parseJsonLine(pendingText);
	const replacement = compactedReplacement(parsed);
	if (latest && replacement !== null) {
		preview.previewReset = true;
		preview.compactSeen = true;
		resetQueries(preview);
		preview.rawTail = "";
		preview.decodedTail = "";
		applyText(preview, "", replacement.join("\n"), queries, keys, false);
		return { queries: preview.queries, reset: true };
	}
	if (!latest || preview.compactSeen)
		applyText(
			preview,
			pendingText,
			parsed === null ? "" : collectStringsToString(parsed),
			queries,
			keys,
			false,
		);
	return { queries: preview.queries, reset: false };
}
function resetQueries(state: CacheState): void {
	for (const query of Object.values(state.queries)) {
		query.bodySeen = false;
		query.markerSeen = false;
		query.bodyPending = false;
		query.markerPending = false;
	}
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

function trimQueries(state: CacheState, wanted: ReadonlyArray<string>): void {
	const keys = Object.keys(state.queries);
	if (keys.length <= MAX_QUERIES) return;
	const keep = new Set(wanted);
	for (const key of keys) {
		if (Object.keys(state.queries).length <= MAX_QUERIES) break;
		if (!keep.has(key)) delete state.queries[key];
	}
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
		if (
			!isRecord(value) ||
			value.version !== 2 ||
			!isRecord(value.identity) ||
			!isRecord(value.queries)
		)
			return null;
		const identity = value.identity;
		if (
			!isNumber(identity.dev) ||
			!isNumber(identity.ino) ||
			!isNumber(identity.size) ||
			!isNumber(identity.mtimeMs) ||
			!isNumber(value.cursor) ||
			typeof value.pending !== "string" ||
			typeof value.rawTail !== "string" ||
			typeof value.decodedTail !== "string" ||
			typeof value.requestedLatest !== "boolean" ||
			typeof value.compactSeen !== "boolean" ||
			typeof value.head !== "string"
		)
			return null;
		const queries: Record<string, CacheQuery> = {};
		for (const [key, item] of Object.entries(value.queries)) {
			if (
				!isRecord(item) ||
				typeof item.body !== "string" ||
				!Array.isArray(item.marker) ||
				!item.marker.every((marker) => typeof marker === "string") ||
				typeof item.bodySeen !== "boolean" ||
				typeof item.markerSeen !== "boolean" ||
				typeof item.bodyPending !== "boolean" ||
				typeof item.markerPending !== "boolean"
			)
				return null;
			queries[key] = {
				body: item.body,
				marker: item.marker,
				bodySeen: item.bodySeen,
				markerSeen: item.markerSeen,
				bodyPending: item.bodyPending,
				markerPending: item.markerPending,
			};
		}
		return {
			version: 2,
			identity: {
				dev: identity.dev,
				ino: identity.ino,
				size: identity.size,
				mtimeMs: identity.mtimeMs,
			},
			cursor: value.cursor,
			pending: value.pending,
			rawTail: value.rawTail,
			decodedTail: value.decodedTail,
			requestedLatest: value.requestedLatest,
			compactSeen: value.compactSeen,
			head: value.head,
			queries,
		};
	} catch {
		return null;
	}
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

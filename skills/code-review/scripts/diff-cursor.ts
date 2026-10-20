#!/usr/bin/env bun
/**
 * diff-cursor.ts — frozen diff pages + per-finder coverage ledger for code-review finders.
 *
 * The conductor freezes the reviewable diff once (`plan`) into pages that each fit one
 * tool call: the budget is UTF-8 bytes (Buffer.byteLength) and includes every header,
 * footer and progress line the CLI prints with the page. Every finder walks all pages in
 * order through its own ledger (`init` → `next` → `done … --next` → … → `finish`).
 *
 * Truncation proof: a page carries an ack code on one line at its byte midpoint. A tool
 * output that is cut keeps head and tail and elides the middle, so a finder that did not
 * see the page whole cannot pass `done --ack`.
 *
 * Node builtins only (no Bun.*, no @lib/ alias) so the script runs under bun and node.
 * Exit codes: 0 success, 1 refused (gate, validation or state), 2 usage error.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_BYTES = 24_000;
export const MAX_PAGE_BYTES = 32_000;
export const MIN_PAGE_BYTES = 2_048;
/** Verified Codex tool-output ceiling: 40,000 bytes arrive intact, 40,004 are cut. */
export const TOOL_OUTPUT_CEILING = 40_000;
/** Bytes kept free in every page for the progress line, `done` confirmation and footer. */
export const DYNAMIC_RESERVE = 600;
export const LEDGER_ENV = "OMT_DIFF_CURSOR_LEDGER";
export const VERDICTS = ["준수", "위반", "해당 없음"] as const;
export const CLEANUP_ANGLE = "cleanup";

export type PageKind = "production" | "schema" | "migration" | "config" | "test" | "doc";
/** Most demanding first: a page takes the kind of its most demanding file. */
const KIND_ORDER: readonly PageKind[] = [
	"production",
	"schema",
	"migration",
	"config",
	"test",
	"doc",
];
type Verdict = (typeof VERDICTS)[number];

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const CONT_COL = "  cont |";
/** Lines longer than this are printed as `cont` chunks of at most this many bytes. */
const SLICE_BYTES = 512;

class CursorError extends Error {
	readonly exitCode: 1 | 2;
	constructor(message: string, exitCode: 1 | 2) {
		super(message);
		this.exitCode = exitCode;
	}
}
const refuse = (message: string) => new CursorError(message, 1);
const usage = (message: string) => new CursorError(`${message}\nRun with --help for usage.`, 2);

// ---------------------------------------------------------------------------
// Path classification
// ---------------------------------------------------------------------------

const DOC_EXT = new Set([
	"md",
	"mdx",
	"markdown",
	"rst",
	"adoc",
	"txt",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"svg",
	"webp",
	"ico",
	"pdf",
]);
const SCHEMA_EXT = new Set(["sql", "graphql", "gql", "proto", "prisma", "avsc", "xsd"]);
const CONFIG_EXT = new Set([
	"yml",
	"yaml",
	"json",
	"jsonc",
	"json5",
	"toml",
	"ini",
	"properties",
	"conf",
	"cfg",
	"env",
	"xml",
	"gradle",
	"lock",
]);
const CONFIG_BASE = new Set([
	"dockerfile",
	"makefile",
	"procfile",
	".gitignore",
	".gitattributes",
	".editorconfig",
	".npmrc",
	".nvmrc",
	".dockerignore",
	"gradlew",
	"mise.toml",
]);

/** Classifies a repo-relative path into the page kind that decides the note tier. */
export function classifyPath(filePath: string): PageKind {
	const lower = filePath.toLowerCase();
	const segs = lower.split("/");
	const dirs = segs.slice(0, -1);
	const base = segs[segs.length - 1] ?? lower;
	const origBase = filePath.split("/").pop() ?? filePath;
	const ext = base.includes(".") ? (base.split(".").pop() ?? "") : "";

	if (
		dirs.some((s) =>
			["migration", "migrations", "migrate", "flyway", "liquibase", "alembic"].includes(s),
		) ||
		/^v\d+[._\d]*__.+\.sql$/.test(base)
	)
		return "migration";
	if (
		dirs.some((s) =>
			[
				"test",
				"tests",
				"__tests__",
				"spec",
				"specs",
				"testfixtures",
				"fixtures",
				"__snapshots__",
				"e2e",
				"testdata",
			].includes(s),
		) ||
		/\.(test|spec)\.[^.]+$/.test(base) ||
		/_test\.[^.]+$/.test(base) ||
		/^test_.+\.py$/.test(base) ||
		/(Test|Tests|Spec|IT)\.(kt|kts|java|scala|swift|cs|groovy)$/.test(origBase)
	)
		return "test";
	if (
		DOC_EXT.has(ext) ||
		dirs.some((s) => ["docs", "doc", "wiki"].includes(s)) ||
		/^(license|changelog|readme)(\..*)?$/.test(base)
	)
		return "doc";
	if (
		SCHEMA_EXT.has(ext) ||
		dirs.includes("schema") ||
		/(^|[._-])(schema|openapi|swagger)([._-]|$)/.test(base)
	)
		return "schema";
	if (
		CONFIG_EXT.has(ext) ||
		CONFIG_BASE.has(base) ||
		base.startsWith(".env") ||
		base.endsWith(".gradle.kts") ||
		/\.config\.(js|cjs|mjs|ts)$/.test(base) ||
		dirs.some((s) => s === ".github" || s === ".circleci")
	)
		return "config";
	return "production";
}

const kindRank = (k: PageKind) => KIND_ORDER.indexOf(k);

// ---------------------------------------------------------------------------
// Unified diff parsing
// ---------------------------------------------------------------------------

interface Atom {
	file: number;
	/** -1 for git file-header lines. */
	hunk: number;
	type: "file" | "hunk" | "body";
	text: string;
	/** New-file line number for context and added lines; null otherwise. */
	newNo: number | null;
}

interface DiffFile {
	path: string;
	kind: PageKind;
	hunkHeaders: string[];
	hunkMaxNew: number[];
	hunkFirstAtom: number[];
	hunkLastAtom: number[];
	firstAtom: number;
}

export interface ParsedDiff {
	files: DiffFile[];
	atoms: Atom[];
	lens: number[];
}

function resolveDiffPath(header: readonly string[], known: readonly string[]): string {
	const first = header[0] ?? "";
	const exact = known.find((f) => first === `diff --git a/${f} b/${f}`);
	if (exact !== undefined) return exact;
	const plus = header.find((l) => l.startsWith("+++ b/"));
	if (plus) return plus.slice(6).replace(/\t$/, "");
	const minus = header.find((l) => l.startsWith("--- a/"));
	if (minus) return minus.slice(6).replace(/\t$/, "");
	const idx = first.lastIndexOf(" b/");
	return idx >= 0 ? first.slice(idx + 3) : first.slice("diff --git ".length);
}

/** Parses `git diff` output into files, hunks and one atom per diff line. */
export function parseDiff(patch: string, knownFiles: readonly string[]): ParsedDiff {
	const lines = patch.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	const files: DiffFile[] = [];
	const atoms: Atom[] = [];
	let file: DiffFile | null = null;
	let hunk = -1;
	let newNo = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.startsWith("diff --git ")) {
			const header: string[] = [line];
			while (
				i + 1 < lines.length &&
				!(lines[i + 1] ?? "").startsWith("diff --git ") &&
				!(lines[i + 1] ?? "").startsWith("@@ ")
			)
				header.push(lines[++i] ?? "");
			const p = resolveDiffPath(header, knownFiles);
			file = {
				path: p,
				kind: classifyPath(p),
				hunkHeaders: [],
				hunkMaxNew: [],
				hunkFirstAtom: [],
				hunkLastAtom: [],
				firstAtom: atoms.length,
			};
			files.push(file);
			hunk = -1;
			for (const h of header)
				atoms.push({ file: files.length - 1, hunk: -1, type: "file", text: h, newNo: null });
			continue;
		}
		if (file === null)
			throw refuse("unparseable diff: content before the first `diff --git` header");
		const fileIdx = files.length - 1;
		const m = HUNK_RE.exec(line);
		if (m) {
			const newStart = Number(m[3]);
			const newLen = m[4] === undefined ? 1 : Number(m[4]);
			file.hunkHeaders.push(line);
			file.hunkMaxNew.push(Math.max(newStart + newLen - 1, newStart));
			file.hunkFirstAtom.push(atoms.length);
			file.hunkLastAtom.push(atoms.length);
			hunk = file.hunkHeaders.length - 1;
			newNo = newStart;
			atoms.push({ file: fileIdx, hunk, type: "hunk", text: line, newNo: null });
			continue;
		}
		const c = line[0];
		// An empty line inside a hunk is a context line whose single space was dropped (`diff.suppressBlankEmpty`).
		const n = hunk >= 0 && (c === "+" || c === " " || line === "") ? newNo++ : null;
		atoms.push({ file: fileIdx, hunk, type: hunk >= 0 ? "body" : "file", text: line, newNo: n });
		if (hunk >= 0) file.hunkLastAtom[hunk] = atoms.length - 1;
	}
	return { files, atoms, lens: atoms.map((a) => Buffer.byteLength(a.text)) };
}

// ---------------------------------------------------------------------------
// Page building
// ---------------------------------------------------------------------------

export interface Pos {
	atom: number;
	byte: number;
}
interface Piece {
	atom: number;
	from: number;
	to: number;
}
interface Group {
	file: number;
	hunk: number;
	min: number | null;
	max: number | null;
	firstPiece: Piece;
	lastPiece: Piece;
}

const numCol = (n: number | null) => `${n === null ? "" : String(n)}`.padStart(6) + " |";
const hunkAt = (header: string) => /^@@ [^@]* @@/.exec(header)?.[0] ?? header;
const ackLine = (id: string, code: string) => `### ACK ${id}: ${code} ###`;
const bytes = (s: string) => Buffer.byteLength(s);

/**
 * One page under construction. `costOf` and `render` share the same transition rules
 * (file banner, hunk continuation header, summary group), so the size the packer
 * accounts for is an upper bound of the rendered page.
 */
class PageBuilder {
	pieces: Piece[] = [];
	private groups = new Map<string, Group>();
	private lastFile = -1;
	private lastHunk = -2;
	private used: number;
	private readonly d: ParsedDiff;
	readonly id: string;

	constructor(d: ParsedDiff, id: string) {
		this.d = d;
		this.id = id;
		this.used =
			bytes(`PAGE ${id}  kind=production\n`) +
			bytes("FILES ON THIS PAGE:\n") +
			bytes(`--- BEGIN ${id} ---\n`) +
			bytes(`${ackLine(id, "00000000")}\n`) +
			bytes(`--- END ${id} ---\n`);
	}

	get empty(): boolean {
		return this.pieces.length === 0;
	}
	get size(): number {
		return this.used;
	}

	fork(): PageBuilder {
		const b = new PageBuilder(this.d, this.id);
		b.pieces = [...this.pieces];
		b.groups = new Map(this.groups);
		b.lastFile = this.lastFile;
		b.lastHunk = this.lastHunk;
		b.used = this.used;
		return b;
	}

	private prefixLines(p: Piece, lastFile: number, lastHunk: number): string[] {
		const a = this.d.atoms[p.atom];
		const f = this.d.files[a.file];
		const out: string[] = [];
		if (a.file !== lastFile) {
			const cont = !(p.atom === f.firstAtom && p.from === 0);
			out.push(`=== FILE ${f.path} [${f.kind}]${cont ? " (continued)" : ""} ===`);
		}
		const ctxHunk = a.file !== lastFile ? -2 : lastHunk;
		if (a.type === "body" && a.hunk !== ctxHunk) out.push(`${f.hunkHeaders[a.hunk]} (continued)`);
		return out;
	}

	private pieceLine(p: Piece): string {
		const a = this.d.atoms[p.atom];
		const whole = p.from === 0 && p.to === this.d.lens[p.atom];
		const text = whole ? a.text : Buffer.from(a.text).subarray(p.from, p.to).toString("utf8");
		if (a.type === "body") return (p.from === 0 ? numCol(a.newNo) : CONT_COL) + text;
		return (p.from === 0 ? "" : CONT_COL) + text;
	}

	private groupKey(p: Piece): string {
		const a = this.d.atoms[p.atom];
		return `${a.file}:${a.type === "file" ? -1 : a.hunk}`;
	}

	private summaryUpper(p: Piece): number {
		const a = this.d.atoms[p.atom];
		const f = this.d.files[a.file];
		if (a.type === "file") return bytes(`  ${f.path}  (file header)\n`);
		const dg = "9".repeat(String(f.hunkMaxNew[a.hunk]).length);
		return bytes(`  ${f.path}  ${hunkAt(f.hunkHeaders[a.hunk] ?? "")} new ${dg}-${dg} (partial)\n`);
	}

	costOf(p: Piece): number {
		let cost = 0;
		for (const l of this.prefixLines(p, this.lastFile, this.lastHunk)) cost += bytes(l) + 1;
		cost += bytes(this.pieceLine(p)) + 1;
		if (!this.groups.has(this.groupKey(p))) cost += this.summaryUpper(p);
		return cost;
	}

	add(p: Piece): void {
		this.used += this.costOf(p);
		const a = this.d.atoms[p.atom];
		const key = this.groupKey(p);
		const g = this.groups.get(key) ?? {
			file: a.file,
			hunk: a.type === "file" ? -1 : a.hunk,
			min: null,
			max: null,
			firstPiece: p,
			lastPiece: p,
		};
		g.lastPiece = p;
		if (a.newNo !== null && p.from === 0) {
			g.min = g.min === null ? a.newNo : Math.min(g.min, a.newNo);
			g.max = g.max === null ? a.newNo : Math.max(g.max, a.newNo);
		}
		this.groups.set(key, g);
		this.pieces.push(p);
		this.lastFile = a.file;
		this.lastHunk = a.type === "file" ? -1 : a.hunk;
	}

	kind(): PageKind {
		let best: PageKind = "doc";
		for (const g of this.groups.values()) {
			const k = this.d.files[g.file].kind;
			if (kindRank(k) < kindRank(best)) best = k;
		}
		return best;
	}

	/** Renders the page; the ack line goes at the body line boundary nearest the byte midpoint. */
	render(planSha: string): { text: string; ack: string; kind: PageKind } {
		const kind = this.kind();
		const summary: string[] = [];
		for (const g of this.groups.values()) {
			const f = this.d.files[g.file];
			if (g.hunk < 0) {
				summary.push(`  ${f.path}  (file header)`);
				continue;
			}
			const first = f.hunkFirstAtom[g.hunk];
			const last = f.hunkLastAtom[g.hunk];
			const whole =
				g.firstPiece.atom === first &&
				g.firstPiece.from === 0 &&
				g.lastPiece.atom === last &&
				g.lastPiece.to === this.d.lens[last];
			const range = g.min === null ? " new -" : ` new ${g.min}-${g.max}`;
			summary.push(
				`  ${f.path}  ${hunkAt(f.hunkHeaders[g.hunk] ?? "")}${range}${whole ? "" : " (partial)"}`,
			);
		}
		const body: string[] = [];
		let lastFile = -1;
		let lastHunk = -2;
		for (const p of this.pieces) {
			body.push(...this.prefixLines(p, lastFile, lastHunk), this.pieceLine(p));
			const a = this.d.atoms[p.atom];
			lastFile = a.file;
			lastHunk = a.type === "file" ? -1 : a.hunk;
		}
		const head = [
			`PAGE ${this.id}  kind=${kind}`,
			"FILES ON THIS PAGE:",
			...summary,
			`--- BEGIN ${this.id} ---`,
		];
		const withoutAck = [...head, ...body, `--- END ${this.id} ---`].join("\n") + "\n";
		const ack = crypto
			.createHash("sha256")
			.update(`${planSha}\n${this.id}\n${withoutAck}`)
			.digest("hex")
			.slice(0, 8);
		const half = bytes(withoutAck) / 2;
		const all = [...head, ...body];
		let acc = 0;
		let at = head.length;
		let best = Infinity;
		for (let k = 0; k <= all.length; k++) {
			if (k >= head.length && Math.abs(acc - half) < best) {
				best = Math.abs(acc - half);
				at = k;
			}
			if (k < all.length) acc += bytes(all[k]) + 1;
		}
		all.splice(at, 0, ackLine(this.id, ack));
		all.push(`--- END ${this.id} ---`);
		return { text: all.join("\n") + "\n", ack, kind };
	}
}

export interface PageRecord {
	id: string;
	kind: PageKind;
	start: Pos;
	end: Pos;
	bytes: number;
	sha256: string;
	ack: string;
	files: string[];
}

function utf8Cut(buf: Buffer, from: number, maxTo: number): number {
	let t = Math.min(maxTo, buf.length);
	while (t > from && ((buf[t] ?? 0) & 0xc0) === 0x80) t--;
	return t;
}

/**
 * Packs the atoms in [start, end) into pages of at most `cap` bytes each. A hunk that fits
 * on an empty page is never split across pages; a larger one is cut at line boundaries,
 * and a single line larger than a page is sliced at UTF-8 boundaries.
 */
export function packPages(
	d: ParsedDiff,
	start: Pos,
	end: Pos,
	cap: number,
	planSha: string,
	idAt: (n: number) => string,
): { record: PageRecord; text: string }[] {
	const out: { record: PageRecord; text: string }[] = [];
	const isEnd = (p: Pos) => p.atom > end.atom || (p.atom === end.atom && p.byte >= end.byte);
	let pos: Pos = { ...start };
	let pageStart: Pos = { ...start };
	let b = new PageBuilder(d, idAt(0));
	const close = () => {
		const { text, ack, kind } = b.render(planSha);
		const size = bytes(text);
		if (size > cap)
			throw new Error(`internal: page ${b.id} rendered ${size} bytes over cap ${cap}`);
		const files = [...new Set(b.pieces.map((p) => d.files[d.atoms[p.atom].file].path))];
		out.push({
			record: {
				id: b.id,
				kind,
				start: pageStart,
				end: { ...pos },
				bytes: size,
				sha256: crypto.createHash("sha256").update(text).digest("hex"),
				ack,
				files,
			},
			text,
		});
		pageStart = { ...pos };
		b = new PageBuilder(d, idAt(out.length));
	};
	const limitOf = (i: number) => (i === end.atom ? end.byte : d.lens[i]);
	// Long lines go out in chunks so the midpoint ack line lands near the byte middle.
	const chunkEnd = (i: number, from: number) => {
		const limit = limitOf(i);
		return limit - from <= SLICE_BYTES
			? limit
			: utf8Cut(Buffer.from(d.atoms[i].text), from, from + SLICE_BYTES);
	};
	const fits = (builder: PageBuilder, from: Pos, lastAtom: number) => {
		const t = builder.fork();
		for (let i = from.atom; i <= lastAtom; i++) {
			for (let byte = i === from.atom ? from.byte : 0; byte < limitOf(i);) {
				const to = chunkEnd(i, byte);
				t.add({ atom: i, from: byte, to });
				if (t.size > cap) return false;
				byte = to;
			}
		}
		return true;
	};
	while (!isEnd(pos)) {
		const i = pos.atom;
		const a = d.atoms[i];
		const f = d.files[a.file];
		// Keep a hunk (or a file header plus its first hunk) together when it fits a fresh page.
		if (!b.empty && pos.byte === 0 && (a.type === "hunk" || i === f.firstAtom)) {
			const unitLast = Math.min(
				a.type === "hunk" ? f.hunkLastAtom[a.hunk] : (f.hunkLastAtom[0] ?? i),
				end.byte > 0 ? end.atom : end.atom - 1,
			);
			if (!fits(b, pos, unitLast) && fits(new PageBuilder(d, b.id), pos, unitLast)) {
				close();
				continue;
			}
		}
		const to = chunkEnd(i, pos.byte);
		const piece: Piece = { atom: i, from: pos.byte, to };
		if (b.size + b.costOf(piece) <= cap) {
			b.add(piece);
			pos = to === d.lens[i] ? { atom: i + 1, byte: 0 } : { atom: i, byte: to };
			continue;
		}
		if (!b.empty) {
			close();
			continue;
		}
		const overhead = b.costOf({ atom: i, from: pos.byte, to: pos.byte });
		const room = cap - b.size - overhead;
		const cut = utf8Cut(Buffer.from(a.text), pos.byte, pos.byte + room);
		if (room < 32 || cut <= pos.byte)
			throw refuse(`page budget ${cap} bytes is too small to hold a slice of a line in ${f.path}`);
		b.add({ atom: i, from: pos.byte, to: cut });
		pos = { atom: i, byte: cut };
	}
	if (!b.empty) close();
	return out;
}

// ---------------------------------------------------------------------------
// Applicable guidelines and rules
// ---------------------------------------------------------------------------

export interface ApplicableFile {
	path: string;
	type: "guideline" | "rule";
	reason: string;
	lines: number;
	aliases: string[];
}

const globCache = new Map<string, RegExp | null>();

function globSource(g: string): string {
	let re = "";
	for (let i = 0; i < g.length; i++) {
		const c = g[i];
		if (c === "*") {
			if (g[i + 1] === "*") {
				const slash = g[i + 2] === "/";
				re += slash ? "(?:.*/)?" : ".*";
				i += slash ? 2 : 1;
			} else re += "[^/]*";
		} else if (c === "?") re += "[^/]";
		else if (c === "{") {
			let depth = 0;
			let j = i;
			for (; j < g.length; j++) {
				if (g[j] === "{") depth++;
				else if (g[j] === "}" && --depth === 0) break;
			}
			if (j >= g.length) {
				re += "\\{";
				continue;
			}
			const inner = g.slice(i + 1, j);
			const parts: string[] = [];
			let d = 0;
			let s = 0;
			for (let k = 0; k < inner.length; k++) {
				if (inner[k] === "{") d++;
				else if (inner[k] === "}") d--;
				else if (inner[k] === "," && d === 0) {
					parts.push(inner.slice(s, k));
					s = k + 1;
				}
			}
			parts.push(inner.slice(s));
			re += `(?:${parts.map(globSource).join("|")})`;
			i = j;
		} else if (c === "[") {
			const j = g.indexOf("]", i + 1);
			if (j < 0) {
				re += "\\[";
				continue;
			}
			re += `[${g
				.slice(i + 1, j)
				.replace(/^!/, "^")
				.replace(/\\/g, "\\\\")}]`;
			i = j;
		} else re += /[.+^$()|\\/]/.test(c) ? `\\${c}` : c;
	}
	return re;
}

/**
 * Minimal glob matcher (`**`, `*`, `?`, `{a,b}`, `[…]`; dot files match). Used instead of
 * node:path matchesGlob because bun and node disagree on `**` over dot segments.
 * lazy: no extglob or escapes; add when a rule uses them.
 */
export function globMatch(pattern: string, filePath: string): boolean {
	return compileGlob(pattern)?.test(filePath) ?? false;
}

/** The anchored regex of a glob, or null when the glob is invalid (e.g. the class `[z-a]`). */
function compileGlob(pattern: string): RegExp | null {
	let g = pattern.trim().replace(/^\.\//, "").replace(/^\//, "");
	if (g.endsWith("/")) g += "**";
	let re = globCache.get(g);
	if (re === undefined) {
		try {
			re = new RegExp(`^${globSource(g)}$`);
		} catch {
			re = null;
		}
		globCache.set(g, re);
	}
	return re;
}

function splitTopLevel(value: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < value.length; i++) {
		const c = value[i];
		if (c === "{" || c === "[") depth++;
		else if (c === "}" || c === "]") depth--;
		else if (c === "," && depth === 0) {
			out.push(value.slice(start, i));
			start = i + 1;
		}
	}
	out.push(value.slice(start));
	return out;
}

/** Cuts an unquoted ` # comment`; a `#` inside quotes stays. */
function stripYamlComment(s: string): string {
	let quote = "";
	for (let i = 0; i < s.length; i++) {
		const c = s[i] ?? "";
		if (quote !== "") {
			if (c === quote) quote = "";
		} else if (c === '"' || c === "'") quote = c;
		else if (c === "#" && (i === 0 || /\s/.test(s[i - 1] ?? ""))) return s.slice(0, i).trimEnd();
	}
	return s;
}

const unquote = (s: string) =>
	s
		.trim()
		.replace(/^(["'])(.*)\1$/, "$2")
		.trim();

/** Reads `paths`/`globs`/`applyTo` (inline array, block list or scalar) and `alwaysApply`. */
export function parseRuleFrontmatter(content: string): {
	patterns: string[];
	alwaysApply: boolean;
} {
	const norm = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
	const result: { patterns: string[]; alwaysApply: boolean } = { patterns: [], alwaysApply: false };
	if (!norm.startsWith("---\n")) return result;
	const close = norm.indexOf("\n---", 3);
	if (close < 0) return result;
	const lines = norm.slice(4, close).split("\n");
	for (let i = 0; i < lines.length; i++) {
		const m = /^(paths|globs|applyTo|alwaysApply)\s*:\s*(.*)$/.exec(lines[i] ?? "");
		if (!m) continue;
		const value = stripYamlComment(m[2] ?? "").trim();
		if (m[1] === "alwaysApply") {
			result.alwaysApply = value === "true";
			continue;
		}
		if (value.startsWith("["))
			result.patterns.push(
				...splitTopLevel(value.replace(/^\[/, "").replace(/\]$/, "")).map(unquote),
			);
		else if (value === "") {
			while (i + 1 < lines.length) {
				const next = lines[i + 1] ?? "";
				if (/^\s*#/.test(next)) i++;
				else if (/^\s*-\s+/.test(next))
					result.patterns.push(unquote(stripYamlComment(lines[++i]?.replace(/^\s*-\s+/, "") ?? "")));
				else break;
			}
		} else
			result.patterns.push(
				...(/^["']/.test(value) ? [unquote(value)] : splitTopLevel(value).map(unquote)),
			);
	}
	result.patterns = result.patterns.filter((p) => p !== "");
	return result;
}

function ruleMatches(patterns: readonly string[], file: string): boolean {
	const candidates = [file, file.split("/").pop() ?? file];
	const hit = (g: string) => candidates.some((c) => globMatch(g, c));
	const positives = patterns.filter((p) => !p.startsWith("!"));
	const negatives = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
	return positives.some(hit) && !negatives.some(hit);
}

/** Read-only view of the files that guidelines and rules are read from; paths are repo-relative. */
interface TreeSource {
	kind(rel: string): "file" | "dir" | null;
	/** Identity that is equal for two names of one file or directory (symlinks). */
	canon(rel: string): string;
	/** Sorted entry names of a directory. */
	children(rel: string): string[];
	read(rel: string): string;
}

function fsSource(top: string): TreeSource {
	const abs = (rel: string) => path.join(top, rel);
	return {
		kind(rel) {
			try {
				const st = fs.statSync(abs(rel));
				return st.isDirectory() ? "dir" : st.isFile() ? "file" : null;
			} catch {
				return null;
			}
		},
		canon: (rel) => fs.realpathSync(abs(rel)),
		children: (rel) => fs.readdirSync(abs(rel)).sort(),
		read: (rel) => fs.readFileSync(abs(rel), "utf8"),
	};
}

/**
 * The tree of one commit, read through git so the working tree cannot change what is reviewed.
 * Symlinks are followed when the last path component is one; a symlinked parent directory is
 * not (lazy: resolve each component if a repo links a whole parent of a rules directory).
 */
function gitSource(top: string, head: string): TreeSource {
	const git = (args: string[], encoding: "utf8" | "buffer" = "utf8") => {
		const r = spawnSync("git", ["-C", top, ...args], { encoding, maxBuffer: 1 << 28 });
		if (r.status !== 0)
			throw refuse(`git ${args[0]} failed while reading ${head}: ${String(r.stderr ?? "").trim()}`);
		return String(r.stdout);
	};
	interface Entry {
		type: "blob" | "tree";
		path: string;
		sha: string;
	}
	const entryAt = (rel: string): { mode: string; entry: Entry } | null => {
		if (rel === "") return { mode: "040000", entry: { type: "tree", path: "", sha: head } };
		const line = git(["ls-tree", "-z", head, "--", rel]).split("\0").find((l) => l.endsWith(`\t${rel}`));
		const m = line && /^(\d+) (blob|tree) ([0-9a-f]+)\t/.exec(line);
		if (!m) return null;
		const type = m[2] === "tree" ? "tree" : "blob";
		return { mode: m[1] ?? "", entry: { type, path: rel, sha: m[3] ?? "" } };
	};
	const memo = new Map<string, Entry | null>();
	const resolve = (rel: string, depth = 0): Entry | null => {
		if (memo.has(rel)) return memo.get(rel) ?? null;
		let out: Entry | null = null;
		const hit = entryAt(rel);
		if (hit && hit.mode === "120000" && depth < 8) {
			const target = path.posix.normalize(
				path.posix.join(path.posix.dirname(rel), git(["cat-file", "blob", hit.entry.sha])),
			);
			out = target === ".." || target.startsWith("../") || target.startsWith("/") ? null : resolve(target === "." ? "" : target, depth + 1);
		} else if (hit && hit.mode !== "120000") out = hit.entry;
		memo.set(rel, out);
		return out;
	};
	return {
		kind(rel) {
			const e = resolve(rel);
			return e === null ? null : e.type === "tree" ? "dir" : "file";
		},
		canon: (rel) => resolve(rel)?.path ?? rel,
		children(rel) {
			const e = resolve(rel);
			if (e === null || e.type !== "tree") return [];
			const args = e.path === "" ? ["ls-tree", "--name-only", "-z", head] : ["ls-tree", "--name-only", "-z", head, "--", `${e.path}/`];
			return git(args)
				.split("\0")
				.filter((n) => n !== "")
				.map((n) => path.posix.basename(n))
				.sort();
		},
		read(rel) {
			const e = resolve(rel);
			if (e === null || e.type !== "blob") throw refuse(`${rel} is not a file in ${head}`);
			return git(["cat-file", "blob", e.sha]);
		},
	};
}

function listMarkdown(src: TreeSource, dir: string, seen: Set<string>): string[] {
	if (src.kind(dir) !== "dir") return [];
	const canon = src.canon(dir);
	if (seen.has(canon)) return [];
	seen.add(canon);
	const out: string[] = [];
	for (const name of src.children(dir)) {
		const rel = path.posix.join(dir, name);
		const kind = src.kind(rel);
		if (kind === "dir") out.push(...listMarkdown(src, rel, seen));
		else if (kind === "file" && name.endsWith(".md")) out.push(rel);
	}
	return out;
}

const lineCount = (content: string) =>
	content.split("\n").length - (content.endsWith("\n") ? 1 : 0);

/**
 * Guideline files (CLAUDE.md / AGENTS.md at the repo root and in every directory on the path
 * of a changed file) plus `.claude/rules` and `.codex/rules` markdown files of the root and of
 * every such directory, whose `paths` match a changed file under the directory that owns the
 * rules (globs are relative to that directory) or that declare no `paths`. Everything is read
 * from the `head` commit, or from the working tree when `head` is null. Files reached twice
 * (symlinks) are listed once, with the other names as aliases.
 */
export function computeApplicable(
	top: string,
	changed: readonly string[],
	head: string | null,
	warnings: string[] = [],
): ApplicableFile[] {
	const src = head === null ? fsSource(top) : gitSource(top, head);
	const out: ApplicableFile[] = [];
	const byCanon = new Map<string, ApplicableFile>();
	const add = (rel: string, entry: Omit<ApplicableFile, "lines" | "aliases">) => {
		const canon = src.canon(rel);
		const existing = byCanon.get(canon);
		if (existing) {
			if (existing.path !== entry.path && !existing.aliases.includes(entry.path))
				existing.aliases.push(entry.path);
			return;
		}
		const item: ApplicableFile = { ...entry, lines: lineCount(src.read(rel)), aliases: [] };
		byCanon.set(canon, item);
		out.push(item);
	};

	const dirFiles = new Map<string, string[]>();
	for (const f of changed) {
		const parts = f.split("/");
		for (let k = parts.length - 1; k >= 0; k--) {
			const dir = parts.slice(0, k).join("/");
			dirFiles.set(dir, [...(dirFiles.get(dir) ?? []), f]);
		}
	}
	const dirs = [...dirFiles.keys()].sort();
	for (const dir of dirs) {
		const under = dirFiles.get(dir) ?? [];
		for (const name of ["CLAUDE.md", "AGENTS.md"]) {
			const rel = dir === "" ? name : `${dir}/${name}`;
			if (src.kind(rel) !== "file") continue;
			const reason =
				dir === ""
					? `repo-root guideline (applies to all ${under.length} changed files)`
					: `guideline for ${dir}/ (on the path of ${under.length} changed file(s), e.g. ${under[0]})`;
			add(rel, { path: rel, type: "guideline", reason });
		}
	}

	const seenDirs = new Set<string>();
	for (const dir of dirs) {
		const under = dirFiles.get(dir) ?? [];
		const scope = dir === "" ? "" : ` under ${dir}/`;
		for (const rulesDir of [".claude/rules", ".codex/rules"]) {
			for (const rel of listMarkdown(src, dir === "" ? rulesDir : `${dir}/${rulesDir}`, seenDirs)) {
				const fm = parseRuleFrontmatter(src.read(rel));
				for (const pat of fm.patterns)
					if (compileGlob(pat.replace(/^!/, "")) === null)
						warnings.push(`rule ${rel}: invalid glob pattern "${pat}" (treated as non-matching)`);
				let reason: string | null = null;
				if (fm.alwaysApply) reason = `rule: alwaysApply: true${scope}`;
				else if (fm.patterns.length === 0)
					reason = `rule: no paths frontmatter (applies to every file${scope})`;
				else {
					const hits = under.filter((f) =>
						ruleMatches(fm.patterns, dir === "" ? f : f.slice(dir.length + 1)),
					);
					if (hits.length > 0)
						reason = `rule: paths [${fm.patterns.join(", ")}] match ${hits.length} changed file(s)${scope}, e.g. ${hits[0]}`;
				}
				if (reason !== null) add(rel, { path: rel, type: "rule", reason });
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface Plan {
	version: 1;
	createdAt: string;
	repo: string;
	range: string;
	files: string[];
	pageBytes: number;
	diffSha256: string;
	diffBytes: number;
	planSha: string;
	gitArgv: string[];
	fileKinds: { path: string; kind: PageKind }[];
	filesWithoutDiff: string[];
	pages: PageRecord[];
	applicable: ApplicableFile[];
	/** Problems found while computing the plan that did not stop it (absent in older plans). */
	warnings?: string[];
	stats: { pages: number; maxPageBytes: number; kinds: Record<string, number> };
}

const sha256 = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");
const now = () => new Date().toISOString();

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function atomicWrite(filePath: string, data: string): void {
	const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
	fs.writeFileSync(tmp, data, { encoding: "utf8", mode: FILE_MODE });
	fs.renameSync(tmp, filePath);
}
const atomicWriteJson = (filePath: string, payload: unknown) =>
	atomicWrite(filePath, JSON.stringify(payload, null, 2));

const isPathList = (x: unknown): x is string[] =>
	Array.isArray(x) && x.length > 0 && x.every((f) => typeof f === "string" && f.trim() !== "");

function readFileList(value: string): string[] {
	let raw = value.trim();
	if (!raw.startsWith("[")) {
		if (!fs.existsSync(value)) throw usage(`--files: not a JSON array and no such file: ${value}`);
		raw = fs.readFileSync(value, "utf8").trim();
	}
	let list: unknown;
	if (raw.startsWith("[")) {
		try {
			list = JSON.parse(raw);
		} catch (e) {
			throw usage(`--files: invalid JSON array (${e instanceof Error ? e.message : String(e)})`);
		}
	} else
		list = raw
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l !== "");
	if (!isPathList(list)) throw usage("--files: expected a non-empty array of repo-relative paths");
	for (const f of list)
		if (f.startsWith("/") || f.split("/").includes(".."))
			throw usage(`--files: path must be repo-relative: ${f}`);
	return [...new Set(list)].sort();
}

function parsePageBytes(value: string | undefined, fallback: number | null): number {
	if (value === undefined) {
		if (fallback === null) throw usage("--page-bytes is required");
		return fallback;
	}
	const n = Number(value);
	if (!Number.isInteger(n) || n < MIN_PAGE_BYTES || n > MAX_PAGE_BYTES)
		throw usage(`--page-bytes must be an integer between ${MIN_PAGE_BYTES} and ${MAX_PAGE_BYTES}`);
	return n;
}

const planIdAt = (n: number) => `p${String(n + 1).padStart(4, "0")}`;

export function loadPlan(planDir: string): Plan {
	const file = path.join(planDir, "plan.json");
	if (!fs.existsSync(file)) throw refuse(`no plan at ${planDir}; run plan first`);
	const plan: Plan = JSON.parse(fs.readFileSync(file, "utf8"));
	return plan;
}

function planSummary(planDir: string, plan: Plan, created: boolean) {
	return {
		planDir,
		planSha: plan.planSha,
		created,
		range: plan.range,
		files: plan.files.length,
		filesWithoutDiff: plan.filesWithoutDiff,
		diffBytes: plan.diffBytes,
		pageBytes: plan.pageBytes,
		pages: plan.stats.pages,
		maxPageBytes: plan.stats.maxPageBytes,
		kinds: plan.stats.kinds,
		applicable: plan.applicable.map((a) => ({
			path: a.path,
			type: a.type,
			reason: a.reason,
			aliases: a.aliases,
		})),
		warnings: plan.warnings ?? [],
	};
}

/** The commit a revision range ends at; null for a single revision, which diffs the working tree. */
function reviewedHead(range: string): string | null {
	const i = range.lastIndexOf("..");
	if (i < 0) return null;
	return range.slice(i + 2).replace(/^\./, "") || "HEAD";
}

function cmdPlan(v: Values): Output {
	const repo = required(v.repo, "--repo");
	const range = required(v.range, "--range");
	const planDir = path.resolve(required(v.out, "--out"));
	const files = readFileList(required(v.files, "--files"));
	const pageBytes = parsePageBytes(v["page-bytes"], DEFAULT_PAGE_BYTES);
	if (range.startsWith("-") || /\s/.test(range))
		throw usage(`--range must be a revision range, got: ${range}`);
	const top = spawnSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
	if (top.status !== 0)
		throw refuse(`not a git repository: ${repo} (${(top.stderr ?? "").trim()})`);
	const repoTop = top.stdout.trim();
	const gitArgv = [
		"-c",
		"core.quotePath=false",
		"-c",
		"diff.noprefix=false",
		"-c",
		"diff.mnemonicPrefix=false",
		"-c",
		"diff.suppressBlankEmpty=false",
		"--literal-pathspecs",
		"diff",
		"--no-ext-diff",
		"--no-textconv",
		"--no-color",
		"--src-prefix=a/",
		"--dst-prefix=b/",
		range,
		"--",
		...files,
	];
	const res = spawnSync("git", gitArgv, { cwd: repoTop, maxBuffer: 1 << 30 });
	if (res.status !== 0)
		throw refuse(`git diff failed (exit ${res.status}): ${res.stderr?.toString().trim()}`);
	const patchBuf = res.stdout;
	if (patchBuf.length === 0)
		throw refuse(`git diff produced no output for ${range} and ${files.length} file(s)`);
	const diffSha256 = sha256(patchBuf);
	const planSha = sha256(
		JSON.stringify({ version: 1, repo: repoTop, range, files, pageBytes, diffSha256 }),
	);

	const existing = fs.existsSync(path.join(planDir, "plan.json")) ? loadPlan(planDir) : null;
	if (existing) {
		if (existing.planSha === planSha)
			return { text: JSON.stringify(planSummary(planDir, existing, false), null, 2) + "\n" };
		const sameInputs =
			existing.repo === repoTop &&
			existing.range === range &&
			existing.pageBytes === pageBytes &&
			JSON.stringify(existing.files) === JSON.stringify(files);
		throw refuse(
			sameInputs
				? `plan conflict: the diff for ${range} changed since ${planDir} was frozen; start a new plan directory`
				: `plan conflict: ${planDir} holds a plan for range ${existing.range}, ${existing.files.length} file(s), page budget ${existing.pageBytes}; got range ${range}, ${files.length} file(s), page budget ${pageBytes}. Use a new --out directory.`,
		);
	}

	const parsed = parseDiff(patchBuf.toString("utf8"), files);
	const pages = packPages(
		parsed,
		{ atom: 0, byte: 0 },
		{ atom: parsed.atoms.length, byte: 0 },
		pageBytes - DYNAMIC_RESERVE,
		planSha,
		planIdAt,
	);
	fs.mkdirSync(path.join(planDir, "pages"), { recursive: true, mode: DIR_MODE });
	fs.writeFileSync(path.join(planDir, "diff.patch"), patchBuf, { mode: FILE_MODE });
	for (const p of pages) atomicWrite(path.join(planDir, "pages", `${p.record.id}.txt`), p.text);
	const inDiff = new Set(parsed.files.map((f) => f.path));
	const kinds: Record<string, number> = {};
	for (const p of pages) kinds[p.record.kind] = (kinds[p.record.kind] ?? 0) + 1;
	const warnings: string[] = [];
	const plan: Plan = {
		version: 1,
		createdAt: now(),
		repo: repoTop,
		range,
		files,
		pageBytes,
		diffSha256,
		diffBytes: patchBuf.length,
		planSha,
		gitArgv: ["git", ...gitArgv],
		fileKinds: parsed.files.map((f) => ({ path: f.path, kind: f.kind })),
		filesWithoutDiff: files.filter((f) => !inDiff.has(f)),
		pages: pages.map((p) => p.record),
		applicable: computeApplicable(repoTop, files, reviewedHead(range), warnings),
		warnings,
		stats: {
			pages: pages.length,
			maxPageBytes: Math.max(...pages.map((p) => p.record.bytes)),
			kinds,
		},
	};
	atomicWriteJson(path.join(planDir, "plan.json"), plan);
	return { text: JSON.stringify(planSummary(planDir, plan, true), null, 2) + "\n" };
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

interface PageState {
	state: "issued" | "done";
	issuedAt: string;
	doneAt?: string;
	note?: string;
	ack?: string;
}
interface ExtraPage {
	parent: string;
	kind: PageKind;
	start: Pos;
	end: Pos;
	bytes: number;
	ack: string;
}
interface Candidate {
	id: string;
	pageId: string;
	file: string;
	line: number;
	summary: string;
	failure_scenario: string;
	rule: string | null;
	addedAt: string;
}
interface ChecklistItem {
	id: string;
	source: string;
	rule: string;
	verdict: Verdict | null;
	evidence: string[];
	updatedAt: string;
}
export interface Ledger {
	version: 1;
	angle: string;
	planDir: string;
	planSha: string;
	createdAt: string;
	updatedAt: string;
	finishedAt: string | null;
	order: string[];
	extraPages: Record<string, ExtraPage>;
	replaced: Record<string, string[]>;
	pages: Record<string, PageState>;
	candidates: Candidate[];
	checklist: ChecklistItem[];
}
interface Ctx {
	dir: string;
	ledger: Ledger;
	plan: Plan;
}

const ledgerFile = (dir: string) => path.join(dir, "ledger.json");

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const LOCK_WAIT_MS = 10_000;

/** True unless the OS says no process has this pid (EPERM means it exists). */
function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return !(e instanceof Error && "code" in e && e.code === "ESRCH");
	}
}

/**
 * Serializes ledger mutations: a finder's tool may run several cursor calls in parallel.
 * The lock file holds `<holder pid>.<token>`. A waiter reclaims it only when that pid is dead and
 * otherwise waits up to LOCK_WAIT_MS for a live holder, then refuses naming the pid.
 */
function withLock<T>(dir: string, fn: () => T): T {
	fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
	const lock = path.join(dir, ".lock");
	const token = `${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
	const tmp = `${lock}.${token}.tmp`;
	fs.writeFileSync(tmp, token, { mode: FILE_MODE });
	const deadline = Date.now() + LOCK_WAIT_MS;
	try {
		for (;;) {
			try {
				fs.linkSync(tmp, lock); // atomic create-with-content: a lock is never seen empty
				break;
			} catch (e) {
				if (!(e instanceof Error && "code" in e && e.code === "EEXIST")) throw e;
			}
			const seen = readLock(lock);
			if (seen === null) continue; // released between the failed create and the read
			const holder = Number.parseInt(seen, 10);
			if (!(holder > 0) || !pidAlive(holder)) {
				takeOverDeadLock(lock, seen);
				continue;
			}
			if (Date.now() > deadline)
				throw refuse(`ledger busy: ${lock} is held by live pid ${holder}`);
			sleepSync(50);
		}
	} finally {
		fs.rmSync(tmp, { force: true });
	}
	try {
		return fn();
	} finally {
		if (readLock(lock) === token) fs.rmSync(lock, { force: true });
	}
}

function readLock(lock: string): string | null {
	try {
		return fs.readFileSync(lock, "utf8");
	} catch {
		return null;
	}
}

/**
 * Moves a dead holder's lock aside with an atomic rename, so only one waiter wins it. If the
 * renamed file is not the lock content that was judged dead (another waiter had already replaced
 * it), it is linked back.
 * lazy: a narrow window remains where that link-back loses to a third creator; a lock service if it matters.
 */
function takeOverDeadLock(lock: string, seen: string): void {
	const aside = `${lock}.aside.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
	try {
		fs.renameSync(lock, aside);
	} catch {
		return; // lock vanished or another waiter moved it first
	}
	try {
		if (readLock(aside) !== seen) fs.linkSync(aside, lock);
	} catch {
		// link-back lost the race; the holder's own release check tolerates a missing lock
	}
	fs.rmSync(aside, { force: true });
}

function openLedger(dir: string): Ctx {
	if (!fs.existsSync(ledgerFile(dir)))
		throw refuse(`no ledger at ${dir}; run init --plan <planDir> --angle <name> first`);
	const ledger: Ledger = JSON.parse(fs.readFileSync(ledgerFile(dir), "utf8"));
	const plan = loadPlan(ledger.planDir);
	if (plan.planSha !== ledger.planSha)
		throw refuse(
			`ledger ${dir} was built for plan ${ledger.planSha.slice(0, 12)} but ${ledger.planDir} now holds ${plan.planSha.slice(0, 12)}`,
		);
	return { dir, ledger, plan };
}

function assertOpenLedger(ctx: Ctx, action: string): void {
	if (ctx.ledger.finishedAt !== null)
		throw refuse(
			`ledger finished at ${ctx.ledger.finishedAt}; ${action} is refused because verify already treats it as complete. Use a new --ledger directory to review again.`,
		);
}

function save(ctx: Ctx): void {
	ctx.ledger.updatedAt = now();
	atomicWriteJson(ledgerFile(ctx.dir), ctx.ledger);
}

function pageMeta(
	ctx: Ctx,
	id: string,
): { kind: PageKind; ack: string; bytes: number; start: Pos; end: Pos } {
	const extra = ctx.ledger.extraPages[id];
	if (extra) return extra;
	const rec = ctx.plan.pages.find((p) => p.id === id);
	if (!rec) throw refuse(`unknown page ${id}`);
	return rec;
}

function pageText(ctx: Ctx, id: string): string {
	return fs.readFileSync(
		ctx.ledger.extraPages[id]
			? path.join(ctx.dir, "pages", `${id}.txt`)
			: path.join(ctx.ledger.planDir, "pages", `${id}.txt`),
		"utf8",
	);
}

const currentPage = (l: Ledger) => l.order.find((id) => l.pages[id]?.state !== "done") ?? null;
const doneCount = (l: Ledger) => l.order.filter((id) => l.pages[id]?.state === "done").length;
const deliveredCount = (l: Ledger) => l.order.filter((id) => l.pages[id] !== undefined).length;

const outputBudget = (ctx: Ctx) => Math.min(ctx.plan.pageBytes, TOOL_OUTPUT_CEILING);

function emit(ctx: Ctx, text: string): string {
	const size = bytes(text);
	if (size > outputBudget(ctx))
		throw new Error(
			`internal: output of ${size} bytes exceeds the page budget ${ctx.plan.pageBytes}`,
		);
	return text;
}

function showPage(ctx: Ctx, id: string, lead: string, label: string): string {
	const l = ctx.ledger;
	const done = doneCount(l);
	const head = `${lead}[${label} ${id} · page ${l.order.indexOf(id) + 1}/${l.order.length} · angle ${l.angle} · done ${done} · remaining ${l.order.length - done}]\n`;
	const foot = `NEXT: done ${id} --ack <code from the ### ACK line mid-page> --note "<what you checked and concluded>" --next\n`;
	return emit(ctx, head + pageText(ctx, id) + foot);
}

function issueNext(ctx: Ctx, lead: string): string {
	const l = ctx.ledger;
	const cur = currentPage(l);
	if (cur === null)
		return `${lead}ALL PAGES DONE (${l.order.length}/${l.order.length}) for angle ${l.angle}; run finish\n`;
	if (!l.pages[cur]) {
		l.pages[cur] = { state: "issued", issuedAt: now() };
		save(ctx);
	}
	return showPage(ctx, cur, lead, "PAGE");
}

function ledgerDirOf(v: Values, env: NodeJS.ProcessEnv): string {
	const dir = v.ledger ?? env[LEDGER_ENV];
	if (!dir) throw usage(`--ledger <dir> (or env ${LEDGER_ENV}) is required`);
	return path.resolve(dir);
}

function cmdInit(v: Values, env: NodeJS.ProcessEnv): Output {
	const dir = ledgerDirOf(v, env);
	const planDir = path.resolve(required(v.plan, "--plan"));
	const angle = required(v.angle, "--angle");
	if (!/^[a-z][a-z0-9_-]*$/.test(angle))
		throw usage(`--angle must match [a-z][a-z0-9_-]*, got: ${angle}`);
	const plan = loadPlan(planDir);
	return withLock(dir, () => {
		if (fs.existsSync(ledgerFile(dir))) {
			const existing: Ledger = JSON.parse(fs.readFileSync(ledgerFile(dir), "utf8"));
			if (existing.planSha === plan.planSha && existing.angle === angle)
				return {
					text: `LEDGER EXISTS angle=${angle} pages=${existing.order.length} done=${doneCount(existing)} ledger=${dir}\n`,
				};
			throw refuse(
				`ledger ${dir} already belongs to angle ${existing.angle} and plan ${existing.planSha.slice(0, 12)}; use another --ledger directory`,
			);
		}
		const ts = now();
		const ledger: Ledger = {
			version: 1,
			angle,
			planDir,
			planSha: plan.planSha,
			createdAt: ts,
			updatedAt: ts,
			finishedAt: null,
			order: plan.pages.map((p) => p.id),
			extraPages: {},
			replaced: {},
			pages: {},
			candidates: [],
			checklist: [],
		};
		atomicWriteJson(ledgerFile(dir), ledger);
		return {
			text: `INIT angle=${angle} pages=${ledger.order.length} ledger=${dir}\nNEXT: run next\n`,
		};
	});
}

function cmdNext(v: Values, env: NodeJS.ProcessEnv): Output {
	const dir = ledgerDirOf(v, env);
	return withLock(dir, () => ({ text: issueNext(openLedger(dir), "") }));
}

function cmdDone(v: Values, env: NodeJS.ProcessEnv, id: string | undefined): Output {
	const dir = ledgerDirOf(v, env);
	if (!id) throw usage("done needs a page id: done <pageId> --ack <code> --note <text> [--next]");
	return withLock(dir, () => {
		const ctx = openLedger(dir);
		const l = ctx.ledger;
		if (l.replaced[id])
			throw refuse(
				`page ${id} was re-split into ${l.replaced[id]?.join(", ")}; acknowledge those pages instead`,
			);
		if (!l.order.includes(id)) throw refuse(`unknown page ${id}`);
		const meta = pageMeta(ctx, id);
		const ack = (v.ack ?? "").trim().toLowerCase();
		const st = l.pages[id];
		if (st?.state === "done") {
			if (ack !== st.ack) throw refuse(`page ${id} is already done with a different ack`);
			return { text: v.next ? issueNext(ctx, `ALREADY DONE ${id}\n`) : `ALREADY DONE ${id}\n` };
		}
		if (!st)
			throw refuse(
				`out of order: page ${id} has not been issued yet; the current page is ${currentPage(l)}. Run next.`,
			);
		if (ack === "")
			throw refuse(
				`--ack is required: copy the code from the "### ACK ${id}: …" line in the middle of the page`,
			);
		if (ack !== meta.ack) {
			const half = Math.max(MIN_PAGE_BYTES, Math.floor(meta.bytes / 2));
			throw refuse(
				`ack mismatch for ${id}: the ### ACK line sits at the middle of the page. If the page output was cut in the middle, run resplit ${id} --page-bytes ${half} and then next.`,
			);
		}
		const note = (v.note ?? "").trim();
		if (note === "") throw refuse(`--note must not be blank: record what you checked on ${id}`);
		l.pages[id] = { ...st, state: "done", doneAt: now(), note, ack };
		save(ctx);
		const line = `DONE ${id} (${doneCount(l)}/${l.order.length})\n`;
		return { text: v.next ? issueNext(ctx, line) : line };
	});
}

function cmdView(v: Values, env: NodeJS.ProcessEnv, id: string | undefined): Output {
	const ctx = openLedger(ledgerDirOf(v, env));
	if (!id) throw usage("view needs a page id");
	if (ctx.ledger.replaced[id])
		throw refuse(`page ${id} was re-split into ${ctx.ledger.replaced[id]?.join(", ")}`);
	const st = ctx.ledger.pages[id];
	if (!ctx.ledger.order.includes(id)) throw refuse(`unknown page ${id}`);
	if (!st)
		throw refuse(
			`page ${id} has not been issued yet; the current page is ${currentPage(ctx.ledger)}`,
		);
	return { text: showPage(ctx, id, "", `VIEW (${st.state})`) };
}

function findApplicable(plan: Plan, p: string): ApplicableFile | undefined {
	return plan.applicable.find((a) => a.path === p || a.aliases.includes(p));
}

/** The reviewed tree: the head commit of the range, or the working tree for a single revision. */
function reviewedTree(plan: Plan): TreeSource {
	const head = reviewedHead(plan.range);
	return head === null ? fsSource(plan.repo) : gitSource(plan.repo, head);
}

/** Validates a repo-relative path and returns its normalized form; the file must exist in the reviewed tree. */
function existingRepoFile(plan: Plan, raw: string, flag: string): string {
	const p = raw.trim();
	if (p === "") throw refuse(`${flag} must not be blank`);
	if (p.startsWith("/") || p.split("/").includes(".."))
		throw refuse(`${flag} must be a repo-relative path without "..", got: ${raw}`);
	if (reviewedTree(plan).kind(p) !== "file")
		throw refuse(`${flag} ${p} is not a file in the reviewed tree`);
	return p;
}

/** A guideline or rule citation: any existing repo .md file, optionally with :line. */
function parseSource(plan: Plan, source: string): string {
	const m = /^(.+?)(?::(\d+))?$/.exec(source.trim());
	const given = m?.[1] ?? "";
	const known = findApplicable(plan, given);
	if (known === undefined && !given.endsWith(".md"))
		throw refuse(
			`--source must be the path of an existing repo .md file, optionally <path>:<line>, got: ${source}`,
		);
	const file = known?.path ?? existingRepoFile(plan, given, "--source");
	if (m?.[2] === undefined) return file;
	const line = Number(m[2]);
	const lines = known?.lines ?? lineCount(reviewedTree(plan).read(file));
	if (line < 1 || line > lines) throw refuse(`--source line ${line} is outside ${file} (1-${lines})`);
	return `${file}:${line}`;
}

function parseVerdict(value: string | undefined): Verdict | null {
	if (value === undefined) return null;
	const verdict = VERDICTS.find((x) => x === value);
	if (verdict === undefined) throw refuse(`--verdict must be one of ${VERDICTS.join(" | ")}`);
	return verdict;
}

function cmdCandidate(v: Values, env: NodeJS.ProcessEnv, sub: string | undefined): Output {
	if (sub !== "add") throw usage("candidate subcommand: add");
	const dir = ledgerDirOf(v, env);
	return withLock(dir, () => {
		const ctx = openLedger(dir);
		assertOpenLedger(ctx, "candidate add");
		const l = ctx.ledger;
		const file = required(v.file, "--file");
		const lineNo = Number(required(v.line, "--line"));
		const summary = required(v.summary, "--summary").trim();
		const failure = required(v["failure-scenario"], "--failure-scenario").trim();
		const pageId = required(v.page, "--page");
		existingRepoFile(ctx.plan, file, "--file");
		if (!Number.isInteger(lineNo) || lineNo < 1) throw refuse("--line must be a positive integer");
		if (summary === "" || failure === "")
			throw refuse("--summary and --failure-scenario must not be blank");
		if (!l.pages[pageId] && !l.replaced[pageId])
			throw refuse(`--page ${pageId} has not been issued to this finder`);
		let rule: string | null = null;
		if (v.rule !== undefined) {
			const item = l.checklist.find((c) => c.id === v.rule);
			rule = item ? item.id : parseSource(ctx.plan, v.rule);
		}
		const dup = l.candidates.find(
			(c) => c.file === file && c.line === lineNo && c.summary === summary,
		);
		if (dup) return { text: `CANDIDATE ${dup.id} already recorded (${file}:${lineNo})\n` };
		const id = `c${String(l.candidates.length + 1).padStart(3, "0")}`;
		l.candidates.push({
			id,
			pageId,
			file,
			line: lineNo,
			summary,
			failure_scenario: failure,
			rule,
			addedAt: now(),
		});
		save(ctx);
		return { text: `CANDIDATE ${id} recorded (${file}:${lineNo})\n` };
	});
}

function checklistSummary(l: Ledger): string {
	const count = (v: Verdict | null) => l.checklist.filter((c) => c.verdict === v).length;
	return `${l.checklist.length} item(s): 준수 ${count("준수")}, 위반 ${count("위반")}, 해당 없음 ${count("해당 없음")}, no verdict yet ${count(null)}`;
}

function cmdChecklist(
	v: Values,
	env: NodeJS.ProcessEnv,
	sub: string | undefined,
	itemId: string | undefined,
): Output {
	const dir = ledgerDirOf(v, env);
	if (sub === "list") {
		const ctx = openLedger(dir);
		if (v.json) return { text: JSON.stringify(ctx.ledger.checklist, null, 2) + "\n" };
		const lines = ctx.ledger.checklist.map(
			(c) =>
				`${c.id} ${c.source} [${c.verdict ?? "no verdict"}] ${c.rule}${c.evidence.length ? ` — ${c.evidence.join(" / ")}` : ""}`,
		);
		return {
			text: `CHECKLIST ${checklistSummary(ctx.ledger)}\n${lines.join("\n")}${lines.length ? "\n" : ""}`,
		};
	}
	if (sub !== "add" && sub !== "update")
		throw usage("checklist subcommands: add | update <itemId> | list");
	return withLock(dir, () => {
		const ctx = openLedger(dir);
		assertOpenLedger(ctx, `checklist ${sub}`);
		const l = ctx.ledger;
		const verdict = parseVerdict(v.verdict);
		const evidence = v.evidence?.trim();
		if (sub === "add") {
			const source = parseSource(ctx.plan, required(v.source, "--source"));
			const rule = required(v.rule, "--rule").trim();
			if (rule === "") throw refuse("--rule must not be blank");
			const id = `r${String(l.checklist.length + 1).padStart(3, "0")}`;
			l.checklist.push({
				id,
				source,
				rule,
				verdict,
				evidence: evidence ? [evidence] : [],
				updatedAt: now(),
			});
			save(ctx);
			return { text: `CHECKLIST ${id} added (${source}, ${verdict ?? "no verdict yet"})\n` };
		}
		const item = l.checklist.find((c) => c.id === itemId);
		if (!item) throw refuse(`unknown checklist item ${itemId ?? "(missing id)"}`);
		if (verdict === null && !evidence)
			throw usage("checklist update needs --verdict and/or --evidence");
		if (verdict !== null) item.verdict = verdict;
		if (evidence) item.evidence.push(evidence);
		item.updatedAt = now();
		save(ctx);
		return {
			text: `CHECKLIST ${item.id} updated (${item.verdict ?? "no verdict yet"}, ${item.evidence.length} evidence)\n`,
		};
	});
}

/** Everything that still blocks `finish`; empty when the finder is complete. */
export function finishProblems(ctx: Ctx): string[] {
	const l = ctx.ledger;
	const problems: string[] = [];
	const pending = l.order.filter((id) => l.pages[id]?.state !== "done");
	if (pending.length > 0)
		problems.push(
			`${pending.length} of ${l.order.length} page(s) not done: ${pending.slice(0, 20).join(", ")}${pending.length > 20 ? ", …" : ""}`,
		);
	if (l.angle === CLEANUP_ANGLE) {
		const covered = new Set(l.checklist.map((c) => c.source.replace(/:\d+$/, "")));
		const missing = ctx.plan.applicable.filter((a) => !covered.has(a.path)).map((a) => a.path);
		if (missing.length > 0)
			problems.push(`applicable file(s) without a checklist item: ${missing.join(", ")}`);
		const open = l.checklist.filter((c) => c.verdict === null).map((c) => c.id);
		if (open.length > 0)
			problems.push(`checklist item(s) without a final verdict: ${open.join(", ")}`);
		const unfiled = l.checklist
			.filter(
				(c) =>
					c.verdict === "위반" && !l.candidates.some((k) => k.rule === c.id || k.rule === c.source),
			)
			.map((c) => c.id);
		if (unfiled.length > 0)
			problems.push(
				`위반 item(s) without a candidate (candidate add … --rule <itemId>): ${unfiled.join(", ")}`,
			);
	}
	return problems;
}

function cmdFinish(v: Values, env: NodeJS.ProcessEnv): Output {
	const dir = ledgerDirOf(v, env);
	return withLock(dir, () => {
		const ctx = openLedger(dir);
		const problems = finishProblems(ctx);
		if (problems.length > 0)
			throw refuse(`finish refused for angle ${ctx.ledger.angle}:\n- ${problems.join("\n- ")}`);
		if (ctx.ledger.finishedAt === null) {
			ctx.ledger.finishedAt = now();
			save(ctx);
		}
		return {
			text: `FINISHED angle=${ctx.ledger.angle} pages ${ctx.ledger.order.length}/${ctx.ledger.order.length} candidates ${ctx.ledger.candidates.length}\n`,
		};
	});
}

function coverage(ctx: Ctx) {
	const l = ctx.ledger;
	const done = doneCount(l);
	return {
		angle: l.angle,
		pagesTotal: l.order.length,
		pagesDelivered: deliveredCount(l),
		pagesAcked: done,
		percent: Math.floor((done / l.order.length) * 1000) / 10,
		currentPage: currentPage(l),
		candidates: l.candidates.length,
		checklistItems: l.checklist.length,
		finished: l.finishedAt !== null,
		resplit: l.replaced,
	};
}

function cmdStatus(v: Values, env: NodeJS.ProcessEnv): Output {
	const ctx = openLedger(ledgerDirOf(v, env));
	const c = coverage(ctx);
	if (v.json) return { text: JSON.stringify(c, null, 2) + "\n" };
	return {
		text: `angle ${c.angle}: done ${c.pagesAcked}/${c.pagesTotal} (${c.percent}%), delivered ${c.pagesDelivered}, current ${c.currentPage ?? "none"}, candidates ${c.candidates}, checklist ${c.checklistItems}, finished ${c.finished ? "yes" : "no"}\n`,
	};
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Pages whose note holds a "check later" question; the notes themselves are read in full with `notes`. */
function openQuestionLines(ctx: Ctx): string[] {
	const l = ctx.ledger;
	const ids = l.order.filter(
		(id) => l.pages[id]?.state === "done" && /check later/i.test(l.pages[id]?.note ?? ""),
	);
	if (ids.length === 0) return [];
	const shown = ids.slice(0, 20).join(", ") + (ids.length > 20 ? ", …" : "");
	return [
		`OPEN QUESTIONS: ${ids.length} note(s) contain "check later" (pages ${shown}); read every note in full with: notes --from ${ids[0]}`,
	];
}

/** Full notes in page order, as many as fit the output budget, then a `MORE:` line. */
function cmdNotes(v: Values, env: NodeJS.ProcessEnv): Output {
	const ctx = openLedger(ledgerDirOf(v, env));
	const l = ctx.ledger;
	const done = l.order.filter((id) => l.pages[id]?.state === "done");
	let start = 0;
	if (v.from !== undefined) {
		const at = l.order.indexOf(v.from);
		if (at < 0) throw refuse(`unknown page ${v.from}`);
		start = done.findIndex((id) => l.order.indexOf(id) >= at);
		if (start < 0) start = done.length;
	}
	if (done.length === 0) return { text: emit(ctx, `NOTES angle=${l.angle}: no notes yet\n`) };
	const MORE_RESERVE = 200;
	let text = `NOTES angle=${l.angle}: ${done.length} note(s) in total, from ${done[start] ?? "the end"}\n`;
	let i = start;
	for (; i < done.length; i++) {
		const id = done[i] ?? "";
		const entry = `\n[${id}]\n${l.pages[id]?.note ?? ""}\n`;
		if (bytes(text + entry) > outputBudget(ctx) - MORE_RESERVE) break;
		text += entry;
	}
	if (i === start && start < done.length)
		throw refuse(
			`the note of ${done[start]} is larger than the output budget ${outputBudget(ctx)}; read it with export --out <file>`,
		);
	text += i < done.length ? `\nMORE: notes --from ${done[i]}\n` : "\nEND OF NOTES\n";
	return { text: emit(ctx, text) };
}

function cmdResume(v: Values, env: NodeJS.ProcessEnv): Output {
	const ctx = openLedger(ledgerDirOf(v, env));
	const l = ctx.ledger;
	const p = ctx.plan;
	const c = coverage(ctx);
	const n = v.notes === undefined ? 5 : Number(v.notes);
	if (!Number.isInteger(n) || n < 0) throw usage("--notes must be a non-negative integer");
	const notes = n === 0 ? [] : l.order.filter((id) => l.pages[id]?.state === "done").slice(-n);
	const out = [
		`RESUME angle=${l.angle} ledger=${ctx.dir}`,
		`PLAN: ${l.planDir} planSha=${p.planSha.slice(0, 12)} range=${p.range} files=${p.files.length} pages=${l.order.length}`,
		`PROGRESS: done ${c.pagesAcked}/${c.pagesTotal} (${c.percent}%), delivered ${c.pagesDelivered}, remaining ${c.pagesTotal - c.pagesAcked}${l.finishedAt ? ", FINISHED" : ""}`,
		`NEXT PAGE: ${c.currentPage === null ? "none (all pages done; run finish)" : `${c.currentPage} (${l.pages[c.currentPage] ? "issued, not done" : "not issued yet"})`}`,
		`LAST ${notes.length} NOTE(S):`,
		...notes.map((id) => `  ${id}: ${clip(l.pages[id]?.note ?? "", 240)}`),
		...openQuestionLines(ctx),
		`CANDIDATES: ${l.candidates.length}`,
		...l.candidates.slice(-10).map((k) => `  ${k.id} ${k.file}:${k.line} ${clip(k.summary, 120)}`),
		`CHECKLIST: ${checklistSummary(l)}`,
		`APPLICABLE GUIDELINES AND RULES (${p.applicable.length}):`,
		...p.applicable.map(
			(a) =>
				`  ${a.path}${a.aliases.length ? ` (= ${a.aliases.join(", ")})` : ""} — ${clip(a.reason, 160)}`,
		),
		c.currentPage === null
			? "NEXT STEP: run finish"
			: "NEXT STEP: run next (it re-prints the current page), then done <id> --ack <code> --note <text> --next until ALL PAGES DONE, then finish",
	];
	return { text: out.join("\n") + "\n" };
}

function cmdResplit(v: Values, env: NodeJS.ProcessEnv, id: string | undefined): Output {
	const dir = ledgerDirOf(v, env);
	if (!id) throw usage("resplit needs a page id: resplit <pageId> --page-bytes N");
	const budget = parsePageBytes(v["page-bytes"], null);
	return withLock(dir, () => {
		const ctx = openLedger(dir);
		const l = ctx.ledger;
		if (l.replaced[id])
			throw refuse(`page ${id} was already re-split into ${l.replaced[id]?.join(", ")}`);
		const idx = l.order.indexOf(id);
		if (idx < 0) throw refuse(`unknown page ${id}`);
		if (l.pages[id]?.state === "done")
			throw refuse(
				`page ${id} is already acknowledged; only a page that is not done can be re-split`,
			);
		const meta = pageMeta(ctx, id);
		const parsed = parseDiff(
			fs.readFileSync(path.join(l.planDir, "diff.patch")).toString("utf8"),
			ctx.plan.files,
		);
		const subs = packPages(
			parsed,
			meta.start,
			meta.end,
			budget - DYNAMIC_RESERVE,
			ctx.plan.planSha,
			(n) => `${id}.${n + 1}`,
		);
		if (subs.length < 2)
			throw refuse(
				`page ${id} (${meta.bytes} bytes) already fits in ${budget} bytes; choose a smaller --page-bytes`,
			);
		fs.mkdirSync(path.join(dir, "pages"), { recursive: true, mode: DIR_MODE });
		for (const s of subs) {
			atomicWrite(path.join(dir, "pages", `${s.record.id}.txt`), s.text);
			l.extraPages[s.record.id] = {
				parent: id,
				kind: s.record.kind,
				start: s.record.start,
				end: s.record.end,
				bytes: s.record.bytes,
				ack: s.record.ack,
			};
		}
		const ids = subs.map((s) => s.record.id);
		l.order.splice(idx, 1, ...ids);
		l.replaced[id] = ids;
		delete l.pages[id];
		save(ctx);
		return {
			text: `RESPLIT ${id} -> ${ids.join(", ")} (max ${Math.max(...subs.map((s) => s.record.bytes))} bytes per page); run next\n`,
		};
	});
}

function cmdVerify(v: Values, extra: string[]): Output {
	const plan = loadPlan(path.resolve(required(v.plan, "--plan")));
	const dirs = [...(v.ledgers ?? []), ...extra];
	if (dirs.length === 0) throw usage("verify needs --ledgers <dir> [<dir> …]");
	const ledgers = dirs.map((d) => {
		const dir = path.resolve(d);
		try {
			const ctx = openLedger(dir);
			const problems =
				ctx.ledger.planSha === plan.planSha
					? finishProblems(ctx)
					: [
							`ledger belongs to plan ${ctx.ledger.planSha.slice(0, 12)}, not ${plan.planSha.slice(0, 12)}`,
						];
			if (problems.length === 0 && ctx.ledger.finishedAt === null)
				problems.push("finish has not been run");
			const c = coverage(ctx);
			return {
				ledger: dir,
				angle: c.angle,
				pagesTotal: c.pagesTotal,
				pagesAcked: c.pagesAcked,
				pagesDelivered: c.pagesDelivered,
				candidates: c.candidates,
				finished: c.finished,
				ok: problems.length === 0,
				problems,
			};
		} catch (e) {
			if (!(e instanceof CursorError)) throw e;
			return { ledger: dir, angle: null, ok: false, problems: [e.message] };
		}
	});
	const ok = ledgers.every((x) => x.ok);
	return {
		code: ok ? 0 : 1,
		text:
			JSON.stringify({ ok, planSha: plan.planSha, pages: plan.stats.pages, ledgers }, null, 2) +
			"\n",
	};
}

/**
 * `export` prints the ledger as JSON parts that each fit the output budget: candidates first, then
 * checklist, then notes, never splitting an item. `--out <file>` writes the whole export instead.
 */
function cmdExport(v: Values, env: NodeJS.ProcessEnv): Output {
	const ctx = openLedger(ledgerDirOf(v, env));
	const l = ctx.ledger;
	const head = { angle: l.angle, planSha: l.planSha, coverage: coverage(ctx) };
	const candidates = l.candidates.map((c) => ({ ...c, found_by: l.angle }));
	const notes = l.order
		.filter((id) => l.pages[id]?.state === "done")
		.map((id) => ({ pageId: id, note: l.pages[id]?.note ?? "" }));
	if (v.out !== undefined) {
		const file = path.resolve(v.out);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const full = JSON.stringify(
			{ ...head, candidates, checklist: l.checklist, applicable: ctx.plan.applicable, notes },
			null,
			2,
		);
		atomicWrite(file, full + "\n");
		return {
			text: `EXPORT WRITTEN ${file} (${bytes(full) + 1} bytes, ${candidates.length} candidate(s), ${l.checklist.length} checklist item(s), ${notes.length} note(s))\n`,
		};
	}
	type Group = { candidates: unknown[]; checklist: unknown[]; notes: unknown[] };
	const render = (part: number, parts: number, g: Group) =>
		JSON.stringify(
			{ ...head, part, parts, next: part < parts ? `export --part ${part + 1}` : null, ...g },
			null,
			2,
		) + "\n";
	const fits = (g: Group) => bytes(render(999, 999, g)) <= outputBudget(ctx);
	let g: Group = { candidates: [], checklist: [], notes: [] };
	const groups: Group[] = [g];
	const items: [keyof Group, unknown][] = [
		...candidates.map((x): [keyof Group, unknown] => ["candidates", x]),
		...l.checklist.map((x): [keyof Group, unknown] => ["checklist", x]),
		...notes.map((x): [keyof Group, unknown] => ["notes", x]),
	];
	for (const [section, item] of items) {
		g[section].push(item);
		if (fits(g)) continue;
		g[section].pop();
		g = { candidates: [], checklist: [], notes: [] };
		g[section].push(item);
		if (!fits(g))
			throw refuse(
				`one ${section} item is larger than the output budget ${outputBudget(ctx)}; use export --out <file>`,
			);
		groups.push(g);
	}
	const part = v.part === undefined ? 1 : Number(v.part);
	const chosen = groups[part - 1];
	if (!Number.isInteger(part) || chosen === undefined)
		throw refuse(`--part must be an integer from 1 to ${groups.length}`);
	return { text: emit(ctx, render(part, groups.length, chosen)) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const OPTIONS = {
	repo: { type: "string" },
	range: { type: "string" },
	files: { type: "string" },
	out: { type: "string" },
	"page-bytes": { type: "string" },
	plan: { type: "string" },
	angle: { type: "string" },
	ledger: { type: "string" },
	ledgers: { type: "string", multiple: true },
	ack: { type: "string" },
	note: { type: "string" },
	next: { type: "boolean" },
	file: { type: "string" },
	line: { type: "string" },
	summary: { type: "string" },
	"failure-scenario": { type: "string" },
	page: { type: "string" },
	rule: { type: "string" },
	source: { type: "string" },
	verdict: { type: "string" },
	evidence: { type: "string" },
	notes: { type: "string" },
	from: { type: "string" },
	part: { type: "string" },
	json: { type: "boolean" },
	help: { type: "boolean", short: "h" },
} as const;

interface Values {
	repo?: string;
	range?: string;
	files?: string;
	out?: string;
	"page-bytes"?: string;
	plan?: string;
	angle?: string;
	ledger?: string;
	ledgers?: string[];
	ack?: string;
	note?: string;
	next?: boolean;
	file?: string;
	line?: string;
	summary?: string;
	"failure-scenario"?: string;
	page?: string;
	rule?: string;
	source?: string;
	verdict?: string;
	evidence?: string;
	notes?: string;
	from?: string;
	part?: string;
	json?: boolean;
	help?: boolean;
}
interface Output {
	text: string;
	code?: number;
}

function required(value: string | undefined, flag: string): string {
	if (value === undefined || value === "") throw usage(`${flag} is required`);
	return value;
}

export const HELP = `diff-cursor.ts — frozen diff pages + per-finder coverage ledger

CONDUCTOR
  plan --repo <dir> --range <base...head> --files <json array | file> --out <planDir> [--page-bytes N]
      Freeze the diff of the file list into pages of at most N bytes (default ${DEFAULT_PAGE_BYTES}, ${MIN_PAGE_BYTES}-${MAX_PAGE_BYTES}),
      record the applicable CLAUDE.md/AGENTS.md and rule files, print a JSON summary.
      Same inputs again: no-op. Different inputs for an existing planDir: refused.
  verify --plan <planDir> --ledgers <dir> [<dir> …]
      JSON report; exit 0 only when every ledger is finished at 100%.

FINDER (ledger dir via --ledger <dir> or env ${LEDGER_ENV})
  init --plan <planDir> --angle <name>      create the ledger (idempotent)
  next                                      print the current page (issues it if needed)
  done <pageId> --ack <code> --note <text> [--next]
                                            acknowledge the current page; --next prints the next one
  view <pageId>                             re-print an issued or done page
  candidate add --page <id> --file <path> --line <n> --summary <text> --failure-scenario <text> [--rule <itemId | path:line>]
  checklist add --source <path[:line]> --rule <text> [--verdict 준수|위반|해당 없음] [--evidence <text>]
  checklist update <itemId> [--verdict 준수|위반|해당 없음] [--evidence <text>]
  checklist list [--json]
  status [--json]                           progress counts
  resume [--notes N]                        everything needed to continue after an interruption; lists the pages whose note says "check later"
  notes [--from <pageId>]                   every note in full, in page order, up to the output budget; "MORE: notes --from <pageId>" means call again
  resplit <pageId> --page-bytes N           re-cut a page that is not done into <pageId>.1, <pageId>.2, …
  finish                                    refused until 100% of pages are done (cleanup: checklist complete)
  export [--part N]                         JSON part N of "parts" (default 1): coverage, candidates, then checklist, then notes; each part fits the output budget, read parts 1..parts
  export --out <file>                       write the whole export (also the applicable files) to a file instead
  (an argument value that starts with "-" must be written --flag=value, e.g. --note="-1 is not handled")

Exit codes: 0 success, 1 refused, 2 usage error.
`;

/** Runs one CLI invocation without exiting the process. */
export function run(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
): { code: number; stdout: string; stderr: string } {
	try {
		const parsed = (() => {
			try {
				return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
			} catch (e) {
				throw usage(e instanceof Error ? e.message : String(e));
			}
		})();
		const v: Values = parsed.values;
		const [cmd, arg1, arg2] = parsed.positionals;
		if (v.help || cmd === undefined || cmd === "help") return { code: 0, stdout: HELP, stderr: "" };
		let out: Output;
		switch (cmd) {
			case "plan":
				out = cmdPlan(v);
				break;
			case "init":
				out = cmdInit(v, env);
				break;
			case "next":
				out = cmdNext(v, env);
				break;
			case "done":
				out = cmdDone(v, env, arg1);
				break;
			case "view":
				out = cmdView(v, env, arg1);
				break;
			case "candidate":
				out = cmdCandidate(v, env, arg1);
				break;
			case "checklist":
				out = cmdChecklist(v, env, arg1, arg2);
				break;
			case "status":
				out = cmdStatus(v, env);
				break;
			case "resume":
				out = cmdResume(v, env);
				break;
			case "notes":
				out = cmdNotes(v, env);
				break;
			case "resplit":
				out = cmdResplit(v, env, arg1);
				break;
			case "finish":
				out = cmdFinish(v, env);
				break;
			case "verify":
				out = cmdVerify(v, parsed.positionals.slice(1));
				break;
			case "export":
				out = cmdExport(v, env);
				break;
			default:
				throw usage(`unknown command: ${cmd}`);
		}
		return { code: out.code ?? 0, stdout: out.text, stderr: "" };
	} catch (e) {
		if (e instanceof CursorError) return { code: e.exitCode, stdout: "", stderr: `${e.message}\n` };
		throw e;
	}
}

if (import.meta.main) {
	const r = run(process.argv.slice(2));
	process.stdout.write(r.stdout);
	process.stderr.write(r.stderr);
	process.exitCode = r.code;
}

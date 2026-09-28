/**
 * Session ledger writer: prompt → model → deterministic validation → reject-and-retry → render.
 *
 * The model fills a JSON schema; this module checks every claim it can check
 * mechanically (identifiers exist in the log, user quotes exist in the cited
 * message, ids resolve) and feeds violations back for a corrected attempt.
 * Prompt wording, budget, and attempt count were tuned by blind-judged replays.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Message, WorkLog } from "./extract.ts";

export const SCHEMA_PATH = join(import.meta.dir, "schema.json");
const PROMPT_PATH = join(import.meta.dir, "prompt.md");
export const DEFAULT_BUDGET = 32000;
export const DEFAULT_ATTEMPTS = 3;
const OVER_BUDGET = "your rendered fields are";

/** The summarizer's output; mirrors schema.json, which `isLedgerJson` checks at runtime. */
export interface LedgerJson {
	analysis_checklist: string[];
	primary_request_and_intent: string;
	current_work: string;
	next_steps: { step: string; authorized_by: string; authorization_quote: string; needs_user_confirmation: boolean }[];
	working_rules: { rule: string; source: string }[];
	approved_proposals: {
		proposal_id: string;
		approved_by: string;
		approval_quote: string;
		approved_scope: string;
		excluded_or_changed: string[];
		done: string[];
		remaining: string[];
	}[];
	decisions: { decision: string; rationale: string; decided_by: string; user_quote: string }[];
	rejected: { item: string; reason: string }[];
	unverified_results: { source: string; recommendations: { recommendation: string; related_settled_items: string[] }[] }[];
	open_questions: string[];
	key_technical_concepts: string[];
	files_and_code: { path: string; role: string; state: string; snippet: string }[];
	errors_and_fixes: { error: string; fix: string; user_feedback: string }[];
	operational_gotchas: { trap: string; fix: string }[];
	experiment_results: { what: string; result: string }[];
	findings: { finding: string; evidence: string }[];
	pieces: { path: string; contents: string }[];
	pending: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The subset of JSON Schema that schema.json uses: object/array/string/boolean, required, items, properties. */
function conforms(value: unknown, schema: unknown): boolean {
	if (!isRecord(schema)) return false;
	switch (schema.type) {
		case "string":
			return typeof value === "string";
		case "boolean":
			return typeof value === "boolean";
		case "array":
			return Array.isArray(value) && value.every((item) => conforms(item, schema.items));
		case "object": {
			if (!isRecord(value) || !isRecord(schema.properties)) return false;
			const properties = schema.properties;
			const required = Array.isArray(schema.required) ? schema.required : [];
			return (
				required.every((key) => typeof key === "string" && key in value) &&
				Object.entries(value).every(([key, field]) => key in properties && conforms(field, properties[key]))
			);
		}
		default:
			return false;
	}
}

const SCHEMA: unknown = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

export function isLedgerJson(value: unknown): value is LedgerJson {
	return conforms(value, SCHEMA);
}

export interface ModelResult {
	output?: LedgerJson;
	error?: string;
}

/** Runs one summarizer call; `timeoutMs` is the time left before the hook's deadline. */
export type ModelRunner = (prompt: string, timeoutMs: number) => Promise<ModelResult>;

export interface LedgerInput {
	log: WorkLog;
	/** Ledger written at the previous compaction, when the log covers only the part after it. */
	previousLedger?: string;
	runModel: ModelRunner;
	deadline: number;
	budget?: number;
	maxAttempts?: number;
}

export interface AttemptRecord {
	n: number;
	secs: number;
	bytes?: number;
	violations?: string[];
	error?: string;
}

export interface LedgerResult {
	markdown: string;
	status: "accepted" | "accepted-over-budget" | "fallback";
	attempts: AttemptRecord[];
}

// ─── Previous ledger carry-over ──────────────────────────────────────────────

const USERS_HEADING = "## All user messages (verbatim)";

/** User messages recorded in an earlier ledger, so a windowed log keeps every U-id resolvable. */
export function previousUsers(ledger: string | undefined): Message[] {
	if (!ledger) return [];
	const start = ledger.indexOf(USERS_HEADING);
	if (start < 0) return [];
	const users: Message[] = [];
	for (const line of ledger.slice(start + USERS_HEADING.length).split("\n")) {
		if (line.startsWith("## ")) break;
		const match = line.match(/^- \[(U\d+)\] ([\s\S]*)$/);
		if (match) users.push({ id: match[1], text: match[2] });
		else if (users.length > 0) users[users.length - 1].text += `\n${line}`;
	}
	for (const user of users) user.text = user.text.replace(/\n+$/, "");
	return users;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

export function renderFields(d: LedgerJson, withAppendixNote = false): string {
	const o: string[] = [
		"# Session ledger\n",
		`## 1. Primary request and intent\n${d.primary_request_and_intent}\n`,
		`## 2. Current work\n${d.current_work}\n`,
		"## 3. Next steps",
	];
	d.next_steps.forEach((s, i) => {
		const auth = s.authorized_by ? ` (authorized by ${s.authorized_by})` : "";
		const confirm = s.needs_user_confirmation ? " **Ask the user first.**" : " No further confirmation needed.";
		o.push(`${i + 1}. ${s.step}${auth}.${confirm}`);
	});
	o.push("");
	if (d.working_rules.length > 0) {
		o.push("## Working rules (still in force)");
		for (const x of d.working_rules) o.push(`- ${x.rule} (${x.source})`);
		o.push("");
	}
	for (const p of d.approved_proposals) {
		o.push(
			`## Approved proposal (assistant message ${p.proposal_id}, APPROVED by ${p.approved_by}: "${p.approval_quote}")`,
		);
		o.push(`Approved scope: ${p.approved_scope}`);
		if (p.excluded_or_changed.length > 0) {
			o.push("NOT approved / changed:");
			for (const x of p.excluded_or_changed) o.push(`- ${x}`);
		}
		if (p.done.length > 0) {
			o.push("Done:");
			for (const x of p.done) o.push(`- ${x}`);
		}
		if (p.remaining.length > 0) {
			o.push("Remaining:");
			for (const x of p.remaining) o.push(`- ${x}`);
		}
		o.push(withAppendixNote ? "The proposal's original text is in the appendix at the end of this ledger." : "");
		o.push("");
	}
	if (d.unverified_results.length > 0) {
		o.push("## UNVERIFIED results (verify the cited code, compare with the quoted items, ask before adopting)");
		for (const r of d.unverified_results) {
			o.push(`- **${r.source}**`);
			for (const rec of r.recommendations) {
				o.push(`  - Recommendation: ${rec.recommendation}`);
				for (const q of rec.related_settled_items) o.push(`    - Related: ${q}`);
			}
		}
		o.push("");
	}
	if (d.open_questions.length > 0) {
		o.push("## Open questions for the user");
		for (const q of d.open_questions) o.push(`- ${q}`);
		o.push("");
	}
	const sections: [string, string[]][] = [
		[
			"Decisions",
			d.decisions.map(
				(x) => `- ${x.decision} — ${x.rationale} (${x.decided_by}${x.user_quote.trim() ? `: "${x.user_quote}"` : ""})`,
			),
		],
		["Rejected", d.rejected.map((x) => `- Rejected: ${x.item} - because ${x.reason}`)],
		["Key technical concepts", d.key_technical_concepts.map((x) => `- ${x}`)],
		[
			"Files and code",
			d.files_and_code.map(
				(x) => `- \`${x.path}\` — ${x.role}; ${x.state}${x.snippet.trim() ? `\n\`\`\`\n${x.snippet}\n\`\`\`` : ""}`,
			),
		],
		[
			"Errors and fixes",
			d.errors_and_fixes.map(
				(x) => `- ${x.error} → ${x.fix}${x.user_feedback.trim() ? ` (user: ${x.user_feedback})` : ""}`,
			),
		],
		["Work pieces", d.pieces.map((x) => `- \`${x.path}\` — ${x.contents}`)],
		["Operational gotchas", d.operational_gotchas.map((x) => `- ${x.trap} → ${x.fix}`)],
		["Experiment results", d.experiment_results.map((x) => `- ${x.what}: ${x.result}`)],
		["Findings", d.findings.map((x) => `- ${x.finding} [${x.evidence}]`)],
		["Pending", d.pending.map((x) => `- ${x}`)],
	];
	for (const [title, lines] of sections) {
		if (lines.length === 0) continue;
		o.push(`## ${title}`, ...lines, "");
	}
	return `${o.join("\n").trimEnd()}\n`;
}

/** The model never selects user messages: all of them are appended verbatim, then the approved proposals' text. */
export function renderLedger(d: LedgerJson, users: Message[], assistants: Map<string, string>): string {
	const userLines = ["", USERS_HEADING, ...users.map((u) => `- [${u.id}] ${u.text}`)];
	const appendix: string[] = [];
	for (const p of d.approved_proposals) {
		const text = assistants.get(p.proposal_id);
		if (p.remaining.length === 0 || text === undefined) continue;
		appendix.push(
			"",
			`### Assistant message ${p.proposal_id} (verbatim; section "Approved proposal" above says which parts are approved, excluded, or overturned)`,
			...text.split("\n").map((line) => `> ${line}`),
		);
	}
	const appendixBlock =
		appendix.length > 0 ? `\n${["## Appendix: original text of approved proposals", ...appendix].join("\n")}` : "";
	return `${renderFields(d, true)}${userLines.join("\n")}\n${appendixBlock}`.trimEnd() + "\n";
}

// ─── Validation ─────────────────────────────────────────────────────────────

const CODE = /`([^`\n]+)`/g;
const IDS = /[,\s]+/;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

interface ValidationContext {
	users: Map<string, string>;
	assistants: Map<string, string>;
	sourceText: string;
	budget: number;
}

function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		previous = current;
	}
	return previous[b.length];
}

/**
 * Identifier-like tokens must appear verbatim in the source text: every token inside a code span, and,
 * in plain prose, identifier-like parts that are near misses of a log token.
 */
export function unknownIdentifiers(d: LedgerJson, sourceText: string): string[] {
	const bad = new Set<string>();
	const check = (raw: string) => {
		// Korean particles and quotes glued to a token are not part of it.
		const token = raw.replace(/^[()[\]{},;"'“”‘’]+|[()[\]{},;"'“”‘’]+$|[^\p{ASCII}]+$/gu, "");
		if (token.length < 6 || token.startsWith("-") || /[%'=$<>*|{}]/.test(token) || token.includes("...")) return;
		if (!/[/._-]/.test(token)) return;
		// Line suffixes (`file.ts:485`, `:12-30`) and refspec sides are checked as separate parts.
		for (const part of token.split(/:(?:\d[\d,-]*)?/).filter(Boolean)) {
			const p = part.replace(/\.+$/, "");
			if (p.length < 6 || !/[/._-]/.test(p) || sourceText.includes(p)) continue;
			// Fine: an absolute path joined from a directory the log shows and a file name it shows.
			const trimmed = p.replace(/\/+$/, "");
			const slash = trimmed.lastIndexOf("/");
			const head = trimmed.slice(0, slash);
			const base = trimmed.slice(slash + 1);
			const tail = trimmed.split("/").slice(-2).join("/");
			const joined = p.startsWith("/") && base.length >= 4 && sourceText.includes(head) && sourceText.includes(base);
			const composed = p.startsWith("/") && tail.split("/").length === 2 && sourceText.includes(tail);
			if (!joined && !composed) bad.add(p);
		}
	};
	const rendered = renderFields(d);
	for (const [, span] of rendered.matchAll(CODE)) for (const raw of span.split(/\s+/)) check(raw);
	// Prose paraphrases the (often Korean) log, so an unseen word is normal there. An identifier-like part
	// one edit away from a log token is not: it is a misspelled branch, path, or name.
	// "child-process" for `child_process` is prose, not a typo, so hyphen and underscore compare equal.
	const lowerSource = sourceText.toLowerCase().replaceAll("_", "-");
	const unhyphenated = lowerSource.replaceAll("-", "");
	let sourceTokens: Set<string> | undefined;
	for (const raw of rendered.replace(CODE, " ").split(/\s+/)) {
		const token = raw
			.replace(/^[[("'“‘*]+|[^\p{ASCII}]+$/gu, "")
			.replace(/[.,;:)\]"'”’*]+$/, "")
			.replace(/'s$/, "");
		// Only path, ref, and file-name contexts; a lone hyphenated word is ordinary English.
		if (/^https?:/.test(token) || !/[/.\d]/.test(token)) continue;
		for (const part of token.split(/[/:]/).map((x) => x.toLowerCase().replaceAll("_", "-"))) {
			if (part.length < 6 || !/[a-z]/.test(part) || !/[-_.\d]/.test(part) || part.startsWith("-")) continue;
			if (lowerSource.includes(part.replace(/e?s$/, "")) || unhyphenated.includes(part.replaceAll("-", ""))) continue;
			sourceTokens ??= new Set(lowerSource.split(/[^\w.-]+/).filter((t) => t.length >= 5));
			for (const t of sourceTokens) {
				if (Math.abs(t.length - part.length) <= 1 && editDistance(t, part) === 1) {
					bad.add(part);
					break;
				}
			}
		}
	}
	for (const raw of rendered.split(/\s+/)) {
		if (hasForeignLetter(raw, sourceText)) bad.add(raw.replace(/^[`'"(]+|[`'",;:.)]+$/g, ""));
	}
	return [...bad].sort();
}

/**
 * The summarizer can garble a Korean path into look-alike letters of another script
 * (`기존-프로그램-문제` → `기존-프로그램-խնդիր`), and a retry often garbles it again. A letter
 * outside Latin, Hangul, and Han that the log never contains marks such a token.
 */
function hasForeignLetter(text: string, sourceText: string): boolean {
	return [...text].some(
		(c) => /\p{L}/u.test(c) && !/[\p{Script=Latin}\p{Script=Hangul}\p{Script=Han}]/u.test(c) && !sourceText.includes(c),
	);
}

const TOKEN_DELIMITERS = /([\s`'"(),;:]+)/;

/**
 * Replaces each garbled path segment with a segment from the log, so a retry is not spent on it:
 * the segment the log's paths put between the same neighbors (a translated `기존-프로그램-문제`
 * is still framed by `algocare-home/` and `/apps`), else the closest spelling.
 */
export function repairForeignLetters(d: LedgerJson, sourceText: string): LedgerJson {
	if (!hasForeignLetter(JSON.stringify(d), sourceText)) return d;
	const betweenNeighbors = new Map<string, Set<string>>();
	const spellings = new Set<string>();
	for (const token of sourceText.split(TOKEN_DELIMITERS)) {
		const segments = token.split("/");
		segments.forEach((segment, i) => {
			if (segment.length >= 2) spellings.add(segment);
			if (i === 0 || i === segments.length - 1) return;
			const key = `${segments[i - 1]}/${segments[i + 1]}`;
			betweenNeighbors.set(key, (betweenNeighbors.get(key) ?? new Set()).add(segment));
		});
	}
	const closestSpelling = (part: string) => {
		let best: { segment: string; distance: number } | undefined;
		for (const segment of spellings) {
			if (Math.abs(segment.length - part.length) > part.length / 2) continue;
			const distance = editDistance(segment, part);
			if (!best || distance < best.distance) best = { segment, distance };
		}
		return best && best.distance <= Math.ceil(part.length / 2) ? best.segment : undefined;
	};
	const repairToken = (token: string) => {
		const segments = token.split("/");
		return segments
			.map((segment, i) => {
				if (!hasForeignLetter(segment, sourceText)) return segment;
				const framed = betweenNeighbors.get(`${segments[i - 1] ?? ""}/${segments[i + 1] ?? ""}`);
				if (i > 0 && i < segments.length - 1 && framed?.size === 1) return [...framed][0];
				// Left unrepaired, the validator reports the token and the model gets another try.
				return closestSpelling(segment) ?? segment;
			})
			.join("/");
	};
	const repaired: unknown = JSON.parse(JSON.stringify(d), (_key, value: unknown) =>
		typeof value === "string" ? value.split(TOKEN_DELIMITERS).map(repairToken).join("") : value,
	);
	return isLedgerJson(repaired) ? repaired : d;
}

export function validateLedger(d: LedgerJson, ctx: ValidationContext): string[] {
	const v: string[] = [];
	const { users, assistants } = ctx;
	if (!d.primary_request_and_intent.trim()) v.push("field `primary_request_and_intent` is empty");
	if (!d.current_work.trim()) v.push("field `current_work` is empty");
	if (d.next_steps.length === 0) v.push("next_steps is empty");
	if (d.analysis_checklist.length === 0) {
		v.push("analysis_checklist is empty; build it from the log before filling the fields");
	}

	const quoteOk = (ids: string, quote: string) => {
		// A quote may drop trailing punctuation; it must otherwise be an exact substring.
		const q = normalize(quote).replace(/[ .,!?…"']+$/, "");
		return (
			q.length >= 2 &&
			ids
				.split(IDS)
				.filter((id) => users.has(id))
				.some((id) => normalize(users.get(id) ?? "").includes(q))
		);
	};
	const badQuotes: string[] = [];
	for (const s of d.next_steps) {
		if (s.authorized_by && !quoteOk(s.authorized_by, s.authorization_quote)) {
			badQuotes.push(`${s.authorized_by}: "${s.authorization_quote}"`);
		}
	}
	for (const x of d.decisions) {
		if (x.decided_by && x.decided_by !== "agent" && !quoteOk(x.decided_by, x.user_quote)) {
			badQuotes.push(`${x.decided_by}: "${x.user_quote}"`);
		}
	}
	for (const p of d.approved_proposals) {
		if (!quoteOk(p.approved_by, p.approval_quote)) badQuotes.push(`${p.approved_by}: "${p.approval_quote}"`);
	}
	if (badQuotes.length > 0) {
		const cited = [...new Set(badQuotes.flatMap((x) => x.split(":")[0].split(IDS)))]
			.filter((id) => users.has(id))
			.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
		const shown = cited.map((id) => `${id} says: "${(users.get(id) ?? "").slice(0, 400)}"`).join("; ");
		v.push(
			`these quotes are not found in the cited user message(s): ${JSON.stringify(badQuotes.slice(0, 15))}. ` +
				`The cited messages read exactly: ${shown}. Copy the user's exact words from that message, or, if no user ` +
				`words authorize the item, set the U-id to "" ("agent" for decided_by) and needs_user_confirmation to true`,
		);
	}

	// "No further confirmation needed" is rendered for the main agent to act on, so it must rest on user words.
	const unauthorized = d.next_steps.filter((s) => !s.needs_user_confirmation && !s.authorized_by).map((s) => s.step.slice(0, 80));
	if (unauthorized.length > 0) {
		v.push(
			`next_steps ${JSON.stringify(unauthorized)} set needs_user_confirmation to false without authorized_by; cite the U-id and quote whose words authorize each, or set needs_user_confirmation to true`,
		);
	}

	const badProposals = d.approved_proposals.map((p) => p.proposal_id).filter((id) => !assistants.has(id));
	if (badProposals.length > 0) {
		v.push(
			`approved_proposals cite unknown assistant ids ${JSON.stringify(badProposals)}; use the A-id of the assistant message that states the proposal`,
		);
	}

	const refs: string[] = [
		...d.next_steps.map((s) => s.authorized_by).filter(Boolean),
		...d.decisions.map((x) => x.decided_by).filter((id) => id && id !== "agent"),
		...d.approved_proposals.map((p) => p.approved_by),
	];
	const unknownIds = [...new Set(refs.flatMap((r) => r.split(IDS)).filter((id) => id && !users.has(id)))].sort();
	if (unknownIds.length > 0) {
		const known = [...users.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
		v.push(
			`unknown user-message ids ${JSON.stringify(unknownIds)}; valid ids are ${JSON.stringify(known)} (or "agent" for decided_by). ` +
				'`authorized_by` and `decided_by` hold ONLY ids separated by commas (e.g. "U8,U25"), never prose; put explanations in `rationale` or `step`.',
		);
	}

	const unquoted = d.unverified_results
		.filter((r) => r.recommendations.some((rec) => rec.related_settled_items.length === 0))
		.map((r) => r.source);
	if (unquoted.length > 0) {
		v.push(
			`unverified_results recommendations from ${JSON.stringify([...new Set(unquoted)].sort())} have no related_settled_items; quote the settled items on the same topic, or quote the user's goal statement if none exist`,
		);
	}
	const shortened = d.pieces.map((p) => p.path).filter((p) => p.includes("...") || p.includes("…"));
	if (shortened.length > 0) {
		v.push(`pieces paths are shortened: ${JSON.stringify(shortened)}; write full absolute paths`);
	}
	const unknown = unknownIdentifiers(d, ctx.sourceText);
	if (unknown.length > 0) {
		v.push(
			`these code-formatted identifiers do not appear in the work log, so they are misspelled or invented: ${JSON.stringify(unknown.slice(0, 25))}. Copy identifiers exactly from the log or remove them`,
		);
	}
	const size = Buffer.byteLength(renderFields(d));
	if (size > ctx.budget) {
		const perField = Object.fromEntries(
			Object.entries(d)
				.filter(([k]) => k !== "analysis_checklist")
				.map(([k, field]) => [k, Buffer.byteLength(JSON.stringify(field))]),
		);
		v.push(
			`${OVER_BUDGET} ${size} bytes, budget is ${ctx.budget} (over by ${size - ctx.budget}). Per-field bytes: ${JSON.stringify(perField)}. ` +
				"Cut history and finished work first; never cut current_work, next_steps, working_rules, approved_proposals, decisions, rejected, or unverified_results.",
		);
	}
	return v;
}

// ─── Orchestration ──────────────────────────────────────────────────────────

export function buildPrompt(log: WorkLog, previousLedger: string | undefined, budget: number): string {
	const head = readFileSync(PROMPT_PATH, "utf8").replaceAll("{BUDGET}", String(budget));
	const previous = previousLedger
		? `=== PREVIOUS LEDGER (data) ===\n${previousLedger}\n=== END OF PREVIOUS LEDGER ===\n\n`
		: "";
	return (
		`${head}${previous}${log.lines.join("\n")}\n=== END OF WORK LOG ===\n\n` +
		"Now write the handoff JSON per the field contract above. Do not continue the conversation in the log.\n"
	);
}

/** Written when no model attempt is usable: the facts a script can state without judgment. */
export function fallbackLedger(log: WorkLog, users: Message[], reason: string): string {
	const lastAssistant = log.assistants.at(-1)?.text ?? "(none)";
	const recent = users.slice(-10);
	return [
		"# Session ledger (fallback)",
		"",
		`The summarizer could not produce a validated ledger (${reason}). This fallback holds only mechanically extracted facts; rely on the conversation summary for everything else.`,
		"",
		"## Last assistant message",
		lastAssistant,
		"",
		"## Files edited in this part of the session",
		...(log.editedFiles.length > 0 ? log.editedFiles.map((f) => `- \`${f}\``) : ["- (none)"]),
		"",
		"## Most recent user messages (verbatim)",
		...recent.map((u) => `- [${u.id}] ${u.text}`),
		"",
	].join("\n");
}

export async function writeLedger(input: LedgerInput): Promise<LedgerResult> {
	const budget = input.budget ?? DEFAULT_BUDGET;
	const maxAttempts = input.maxAttempts ?? DEFAULT_ATTEMPTS;
	const carried = previousUsers(input.previousLedger);
	const windowIds = new Set(input.log.users.map((u) => u.id));
	const allUsers = [...carried.filter((u) => !windowIds.has(u.id)), ...input.log.users];
	const ctx: ValidationContext = {
		users: new Map(allUsers.map((u) => [u.id, u.text])),
		assistants: new Map(input.log.assistants.map((a) => [a.id, a.text])),
		sourceText: `${input.previousLedger ?? ""}\n${input.log.lines.join("\n")}`,
		budget,
	};
	const basePrompt = buildPrompt(input.log, input.previousLedger, budget);
	const attempts: AttemptRecord[] = [];
	const overBudget: { size: number; d: LedgerJson }[] = [];
	let prompt = basePrompt;

	for (let n = 1; n <= maxAttempts; n++) {
		const remaining = input.deadline - Date.now();
		if (remaining <= 0) break;
		const started = Date.now();
		const result = await input.runModel(prompt, remaining);
		const secs = Math.round((Date.now() - started) / 100) / 10;
		if (!result.output) {
			attempts.push({ n, secs, error: result.error ?? "no output" });
			break;
		}
		const d = repairForeignLetters(result.output, ctx.sourceText);
		const violations = validateLedger(d, ctx);
		const size = Buffer.byteLength(renderFields(d));
		attempts.push({ n, secs, bytes: size, violations });
		if (violations.length === 0) {
			return { markdown: renderLedger(d, allUsers, ctx.assistants), status: "accepted", attempts };
		}
		// Over budget is the only soft violation: such an attempt is usable if none fully passes.
		if (violations.every((x) => x.startsWith(OVER_BUDGET))) overBudget.push({ size, d });
		prompt =
			`${basePrompt}\n=== YOUR PREVIOUS OUTPUT WAS REJECTED BY THE VALIDATOR ===\n${violations.map((x) => `- ${x}`).join("\n")}` +
			`\nPrevious output:\n${JSON.stringify(d)}\nReturn a corrected handoff JSON.\n`;
	}

	if (overBudget.length > 0) {
		const smallest = overBudget.reduce((a, b) => (b.size < a.size ? b : a));
		return {
			markdown: renderLedger(smallest.d, allUsers, ctx.assistants),
			status: "accepted-over-budget",
			attempts,
		};
	}
	const last = attempts.at(-1);
	const reason = last?.error ?? (last ? "every attempt failed validation" : "deadline reached before the first attempt");
	return { markdown: fallbackLedger(input.log, allUsers, reason), status: "fallback", attempts };
}

// ─── Model runner: headless Codex ───────────────────────────────────────────

/** Set on the summarizer's process so this hook, re-run by the nested session, does nothing. */
export const WORKER_ENV = "OMT_LEDGER_WORKER";

/** gpt-6-sol at low effort: in blind-judged replays it matched or beat gpt-6-luna max and native compaction, in a quarter of the time. */
export function codexRunner(model = "gpt-6-sol", effort = "low"): ModelRunner {
	return (prompt, timeoutMs) =>
		new Promise((resolve) => {
			const dir = mkdtempSync(join(tmpdir(), "omt-ledger-"));
			const out = join(dir, "out.json");
			const args = [
				"exec",
				"-m",
				model,
				"-c",
				`model_reasoning_effort="${effort}"`,
				"-c",
				'service_tier="fast"',
				"--ignore-user-config",
				"--skip-git-repo-check",
				"-s",
				"read-only",
				"--ephemeral",
				"-C",
				dir,
				"--output-schema",
				SCHEMA_PATH,
				"-o",
				out,
				"-",
			];
			const child = spawn("codex", args, {
				env: { ...process.env, [WORKER_ENV]: "1" },
				stdio: ["pipe", "ignore", "pipe"],
			});
			let stderr = "";
			child.stderr.on("data", (chunk) => {
				stderr = (stderr + chunk).slice(-2000);
			});
			const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
			const finish = (result: ModelResult) => {
				clearTimeout(timer);
				rmSync(dir, { recursive: true, force: true });
				resolve(result);
			};
			child.on("error", (error) => finish({ error: `codex not runnable: ${error.message}` }));
			child.on("close", (code) => {
				let parsed: unknown;
				try {
					parsed = JSON.parse(readFileSync(out, "utf8"));
				} catch {
					finish({ error: `codex exited ${code} without a parsable output: ${stderr.slice(-400)}` });
					return;
				}
				finish(isLedgerJson(parsed) ? { output: parsed } : { error: "codex output does not match schema.json" });
			});
			child.stdin.end(prompt);
		});
}

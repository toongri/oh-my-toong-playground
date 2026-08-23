#!/usr/bin/env bun
/**
 * qa-report — renders a self-contained HTML report from a `qa-state get`
 * (QaView) snapshot.
 *
 * Forks skills/explain-diff/scripts/render.ts's mechanics (inline <style>,
 * zero runtime <script>, escapeHtml on every interpolated value, no external
 * CSS/JS/font/image reference) without a runtime import from that skill — the
 * two skills stay independent; only the technique is reused.
 *
 * The report's AC/actor/story/scenario/evidence/verdict facts come from the
 * recorded QaView only — this file never re-derives or re-judges them. The
 * caller may additionally supply a `narrative` object carrying the parts that
 * are never persisted to qa-state: issue descriptions, expected-vs-actual
 * prose, and oracle diagnosis. See skills/qa/SKILL.md "HTML Report".
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, extname, resolve } from "path";
import { getOmtDir } from "@lib/omt-dir";
import type { QaBaseline, QaCell, QaEvidence, QaResult, QaRunCheck, QaStory } from "@lib/qa-chain-core";
import { readQaView, type QaView } from "./qa-state.ts";

// lazy: flat 2MB per-file embed cap keeps a report with a handful of
// screenshots well under the 16MB ceiling; add per-image downscaling if a
// real cycle's evidence set routinely exceeds this.
export const MAX_EMBED_BYTES = 2 * 1024 * 1024;

export type EvidenceEmbed =
	| { kind: "image"; dataUri: string }
	| { kind: "text"; content: string }
	| { kind: "missing"; path: string }
	| { kind: "too-large"; path: string; size: number };

export type EvidenceReader = (path: string) => EvidenceEmbed;

const IMAGE_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
};

/** Reads evidence off disk: images embed as base64 data URIs (capped), everything else renders as text. */
export function defaultEvidenceReader(path: string): EvidenceEmbed {
	const absolute = resolve(path);
	let size: number;
	try {
		size = statSync(absolute).size;
	} catch {
		return { kind: "missing", path };
	}
	if (size > MAX_EMBED_BYTES) return { kind: "too-large", path, size };
	const mime = IMAGE_MIME[extname(absolute).toLowerCase()];
	if (mime) {
		const data = readFileSync(absolute);
		return { kind: "image", dataUri: `data:${mime};base64,${data.toString("base64")}` };
	}
	return { kind: "text", content: readFileSync(absolute, "utf8") };
}

export interface QaReportNarrativeIssue {
	severity: "CRITICAL" | "LOW";
	description: string;
	location?: string;
	what?: string;
}

export interface QaReportScenarioNarrative {
	expectedVsActual?: string;
	oracleDiagnosis?: string;
}

/**
 * The subjective half of the report — never persisted to qa-state. Keyed by
 * `${story}:${cls}:${sub ?? ""}` (matching qa-chain-core's cell key shape).
 */
export interface QaReportNarrative {
	acceptanceCriteria?: string[];
	issues?: QaReportNarrativeIssue[];
	scenarios?: Record<string, QaReportScenarioNarrative>;
}

function escapeHtml(s: string): string {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function cellKey(cell: Pick<QaCell, "story" | "cls" | "sub">): string {
	return `${cell.story}:${cell.cls}:${cell.sub ?? ""}`;
}

function cellLabel(cell: Pick<QaCell, "cls" | "sub">): string {
	return `cls ${cell.cls}${cell.sub ? `/${cell.sub}` : ""}`;
}

type RecordedCheck = QaBaseline | QaRunCheck | QaResult | null | undefined;

function recordedResult(value: RecordedCheck): QaResult | null {
	if (typeof value === "string") return value;
	return value?.result ?? value?.status ?? null;
}

function recordedNote(value: RecordedCheck): string | undefined {
	return typeof value === "string" || value === null || value === undefined ? undefined : value.note;
}

function actorFor(view: QaView, story: QaStory): { id: string; name?: string; boundary?: string; driver?: string } | undefined {
	const id = story.actor ?? story.actor_id;
	return (view.actors ?? []).find((actor) => actor.id === id);
}

function cellsForStory(view: QaView, storyId: string): QaCell[] {
	return (view.cells ?? [])
		.filter((cell) => cell.story === storyId)
		.sort((a, b) => a.cls - b.cls || (a.sub ?? "").localeCompare(b.sub ?? ""));
}

function statusBadge(status: QaCell["status"]): string {
	const label = status ?? "unrecorded";
	return `<span class="badge badge-${escapeHtml(String(label))}">${escapeHtml(String(label))}</span>`;
}

function evidenceSlot(label: string, path: string | undefined, readEvidence: EvidenceReader): string {
	if (!path) return "";
	const embed = readEvidence(path);
	let body: string;
	if (embed.kind === "image") body = `<img src="${escapeHtml(embed.dataUri)}" alt="${escapeHtml(label)} evidence">`;
	else if (embed.kind === "text") body = `<pre>${escapeHtml(embed.content)}</pre>`;
	else if (embed.kind === "too-large") body = `<p class="evidence-note">too large to embed (${embed.size} bytes) — see path below</p>`;
	else body = `<p class="evidence-note">evidence file missing</p>`;
	return (
		`<div class="evidence-slot"><div class="evidence-slot-label">${escapeHtml(label)}</div>${body}` +
		`<div class="evidence-slot-path"><code>${escapeHtml(path)}</code></div></div>`
	);
}

function fieldRow(label: string, value: string | undefined): string {
	if (!value) return "";
	return `<p class="scenario-field"><strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}</p>`;
}

function renderAcceptanceCriteria(view: QaView, narrative: QaReportNarrative): string {
	// Recorded criteria (captured at PLAN) win; narrative is the render-time fallback.
	const items = (view.acceptance_criteria?.length ? view.acceptance_criteria : narrative.acceptanceCriteria) ?? [];
	const body = items.length
		? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
		: `<p class="evidence-note">no acceptance-criteria recorded or supplied at render time</p>`;
	return `<h2>Acceptance Criteria</h2>${body}`;
}

function renderActorRoster(view: QaView): string {
	const rows = (view.actors ?? [])
		.map(
			(actor) =>
				`<tr><td>${escapeHtml(actor.name ?? actor.id)}</td><td>${escapeHtml(actor.boundary ?? "")}</td>` +
				`<td>${escapeHtml(actor.driver ?? "")}</td><td>${escapeHtml(String(actor.reachable ?? ""))}</td></tr>`,
		)
		.join("");
	return (
		`<h2>Actor Roster</h2><table><thead><tr><th>actor</th><th>boundary</th><th>driver</th><th>reachable</th></tr></thead>` +
		`<tbody>${rows}</tbody></table>`
	);
}

function renderStoryTree(view: QaView): string {
	const stories = (view.stories ?? [])
		.map((story) => {
			const actor = actorFor(view, story);
			const cells = cellsForStory(view, story.id)
				.map(
					(cell) =>
						`<li>${escapeHtml(cellLabel(cell))} — <code>${escapeHtml(cell.attack_point ?? "")}</code> — ` +
						`priority ${escapeHtml(cell.priority ?? "")} — ${statusBadge(cell.status)}</li>`,
				)
				.join("");
			return (
				`<li><strong>${escapeHtml(story.id)}</strong> — actor: ${escapeHtml(actor?.name ?? actor?.id ?? "unknown")}` +
				` (${escapeHtml(actor?.boundary ?? "")})<ul>${cells}</ul></li>`
			);
		})
		.join("");
	return `<h2>Story &rarr; Scenario Tree</h2><ul class="story-tree">${stories}</ul>`;
}

function renderScenarioEvidence(view: QaView, narrative: QaReportNarrative, readEvidence: EvidenceReader): string {
	const blocks = (view.stories ?? [])
		.flatMap((story) => cellsForStory(view, story.id))
		.map((cell) => {
			const key = cellKey(cell);
			const scenarioNarrative = narrative.scenarios?.[key];
			const evidence: QaEvidence | undefined = cell.evidence;
			const supplementarySlots = evidence
				? [evidenceSlot("before", evidence.before, readEvidence), evidenceSlot("action", evidence.action, readEvidence), evidenceSlot("after", evidence.after, readEvidence)].filter(Boolean)
				: [];
			const slots = supplementarySlots.length ? supplementarySlots.join("") : evidence ? evidenceSlot("recorded", evidence.path, readEvidence) : "";
			return (
				`<div class="scenario"><h3>${escapeHtml(cell.story)} / ${escapeHtml(cellLabel(cell))} ` +
				`<span class="badge">${escapeHtml(cell.priority ?? "")}</span> ` +
				`<span class="src-badge">${escapeHtml(cell.source ?? "unspecified")}</span></h3>` +
				fieldRow("attack", cell.attack_point) +
				fieldRow("why-needed", cell.why_needed) +
				fieldRow("driven-at", cell.driven_at) +
				`<div class="evidence-slots">${slots}</div>` +
				(scenarioNarrative?.expectedVsActual ? `<p class="expected-vs-actual">${escapeHtml(scenarioNarrative.expectedVsActual)}</p>` : "") +
				(scenarioNarrative?.oracleDiagnosis ? `<p class="oracle-diagnosis">${escapeHtml(scenarioNarrative.oracleDiagnosis)}</p>` : "") +
				`<p class="scenario-result">${statusBadge(cell.status)}${cell.na_reason ? ` — ${escapeHtml(cell.na_reason)}` : ""}</p></div>`
			);
		})
		.join("");
	return `<h2>Scenario Evidence</h2>${blocks}`;
}

function renderFailures(view: QaView, narrative: QaReportNarrative): string {
	const failedCells = (view.cells ?? []).filter((cell) => cell.status === "fail");
	const cellRows = failedCells
		.map(
			(cell) =>
				`<li><code>${escapeHtml(cell.story)} / ${escapeHtml(cellLabel(cell))}</code> — ${escapeHtml(cell.attack_point ?? "")}</li>`,
		)
		.join("");
	const baselineRows = (view.stories ?? [])
		.map((story) => {
			const baseline = story.baseline;
			if (recordedResult(baseline) !== "fail") return "";
			const note = recordedNote(baseline);
			return `<li><code>${escapeHtml(story.id)} / baseline</code> — fail${note ? ` — ${escapeHtml(note)}` : ""}</li>`;
		})
		.join("");
	const runCheckRows = ([
		["stale-state", view.run_checks?.stale_state],
		["dirty-worktree", view.run_checks?.dirty_worktree],
		["flaky-rerun", view.run_checks?.flaky_rerun],
	] as const)
		.map(([name, check]) => {
			if (recordedResult(check) !== "fail") return "";
			const note = recordedNote(check);
			return `<li><code>run-check / ${escapeHtml(name)}</code> — fail${note ? ` — ${escapeHtml(note)}` : ""}</li>`;
		})
		.join("");
	const issueRows = (narrative.issues ?? [])
		.map(
			(issue) =>
				`<li class="issue issue-${escapeHtml(issue.severity)}"><strong>[${escapeHtml(issue.severity)}]</strong> ${escapeHtml(issue.description)}` +
				(issue.location ? ` — <code>${escapeHtml(issue.location)}</code>` : "") +
				(issue.what ? `<br>${escapeHtml(issue.what)}` : "") +
				`</li>`,
		)
		.join("");
	const body =
		cellRows || baselineRows || runCheckRows || issueRows
			? `<ul>${cellRows}${baselineRows}${runCheckRows}${issueRows}</ul>`
			: `<p class="evidence-note">no failures or mismatches recorded this cycle</p>`;
	return `<h2>Failures &amp; Mismatches</h2>${body}`;
}

function renderVerdict(view: QaView): string {
	const report = view.verdict_report;
	const waives = (report?.waives ?? [])
		.map(
			(waive) =>
				`<li><code>${escapeHtml(waive.story)}/${escapeHtml(String(waive.cls))}${waive.sub ? `/${escapeHtml(waive.sub)}` : ""}</code> — ${escapeHtml(waive.reason ?? "")}</li>`,
		)
		.join("");
	const inert = report?.inert?.declared ? `<p class="evidence-note">declared inert: ${escapeHtml(report.inert.reason ?? "")}</p>` : "";
	return (
		`<h2>Verdict</h2><p class="verdict">${escapeHtml(view.verdict ?? "—")}</p>` +
		inert +
		(waives ? `<h3>Waives</h3><ul>${waives}</ul>` : "")
	);
}

function collectEvidencePaths(view: QaView): string[] {
	const paths = new Set<string>();
	for (const story of view.stories ?? []) {
		const baseline = story.baseline?.evidence;
		if (baseline?.path) paths.add(baseline.path);
	}
	for (const cell of view.cells ?? []) {
		const e = cell.evidence;
		if (!e) continue;
		for (const p of [e.path, e.before, e.action, e.after]) if (p) paths.add(p);
	}
	return [...paths];
}

function renderEvidenceFiles(view: QaView): string {
	const paths = collectEvidencePaths(view);
	const body = paths.length
		? `<ul>${paths.map((p) => `<li><code>${escapeHtml(p)}</code></li>`).join("")}</ul>`
		: `<p class="evidence-note">no evidence files recorded</p>`;
	return `<h2>Evidence Files</h2>${body}`;
}

/**
 * Renders the full report, or `null` when the cycle never reached a roster
 * (PRE-FLIGHT fail-fast) — a no-op, not an empty document.
 */
export function renderQaReport(view: QaView, narrative: QaReportNarrative = {}, readEvidence: EvidenceReader = defaultEvidenceReader): string | null {
	if ((view.actors ?? []).length === 0) return null;
	const title = `QA Report — ${view.target || view.phase}`;
	const body = [
		`<h1>${escapeHtml(title)}</h1>`,
		`<ul class="doc-meta"><li><strong>Target</strong> ${escapeHtml(view.target)}</li>` +
			`<li><strong>Cycle</strong> ${escapeHtml(String(view.cycle))}</li>` +
			`<li><strong>Generated</strong> ${escapeHtml(view.last_touched_at)}</li></ul>`,
		renderAcceptanceCriteria(view, narrative),
		renderActorRoster(view),
		renderStoryTree(view),
		renderScenarioEvidence(view, narrative, readEvidence),
		renderFailures(view, narrative),
		renderVerdict(view),
		renderEvidenceFiles(view),
	].join("\n");
	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

// One page, no external references, readable in either theme — same design
// contract as explain-diff's renderer, a fresh instance so qa carries no
// runtime dependency on that skill.
const STYLE = `
:root {
  --bg: #ffffff; --fg: #1a1a1a; --muted: #666; --rule: #e3e3e3;
  --code-bg: #f6f6f4; --accent: #2b5fa8;
  --pass: #2e7d4f; --fail: #b0563a; --na: #9a8a2e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181c; --fg: #e6e6e6; --muted: #9aa0a6; --rule: #2e3238;
    --code-bg: #1e2126; --accent: #7aa7e6;
    --pass: #7ec99a; --fail: #e0937a; --na: #d8c874;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif; }
main { max-width: 52rem; margin: 0 auto; padding: 2rem 1.25rem 6rem; }
h1, h2, h3 { line-height: 1.3; margin: 2.25rem 0 0.75rem; }
h1 { font-size: 1.75rem; margin-top: 0; }
h2 { font-size: 1.3rem; border-bottom: 1px solid var(--rule); padding-bottom: 0.35rem; }
h3 { font-size: 1.05rem; }
p, li { overflow-wrap: anywhere; }
code, pre { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }
pre { background: var(--code-bg); padding: 0.7rem 0.85rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; white-space: pre-wrap; }
code { background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.9em; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.94rem; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--rule); padding: 0.45rem 0.6rem; text-align: left; }
th { background: var(--code-bg); }
img { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--rule); }
.doc-meta { display: flex; flex-wrap: wrap; gap: 0.4rem 1.5rem; list-style: none; margin: 0 0 1.5rem; padding: 0.8rem 1.1rem; background: var(--code-bg); border-radius: 8px; font-size: 0.9rem; color: var(--muted); }
.doc-meta strong { color: var(--fg); font-weight: 600; }
.evidence-note { color: var(--muted); font-size: 0.92rem; }
.badge { display: inline-block; padding: 0.1em 0.55em; border-radius: 999px; font-size: 0.8rem; border: 1px solid var(--rule); background: var(--code-bg); }
.badge-pass { color: var(--pass); border-color: var(--pass); }
.badge-fail { color: var(--fail); border-color: var(--fail); }
.badge-na { color: var(--na); border-color: var(--na); }
.src-badge { font-size: 0.75rem; color: var(--muted); border: 1px solid var(--rule); border-radius: 999px; padding: 0 0.5rem; }
.story-tree ul { margin: 0.35rem 0 0.75rem 1rem; }
.scenario { margin: 1.25rem 0; padding: 1rem; border: 1px solid var(--rule); border-radius: 10px; }
.scenario-field { margin: 0.25rem 0; font-size: 0.92rem; }
.evidence-slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0.75rem; margin: 0.75rem 0; }
.evidence-slot { border: 1px solid var(--rule); border-radius: 8px; padding: 0.5rem; }
.evidence-slot-label { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.03em; color: var(--muted); margin-bottom: 0.35rem; }
.evidence-slot-path { font-size: 0.72rem; color: var(--muted); margin-top: 0.35rem; word-break: break-all; }
.expected-vs-actual, .oracle-diagnosis { background: var(--code-bg); border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.92rem; }
.verdict { font-size: 1.2rem; font-weight: 700; }
.issue-CRITICAL { color: var(--fail); }
.issue-LOW { color: var(--na); }
`;

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
	const argv = process.argv.slice(2);
	const get = (name: string): string | undefined => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const session = get("session");
	if (!session) {
		process.stderr.write("Usage: qa-report.ts --session <id> [--out <path>] [--narrative <json-file>]\n");
		process.exit(1);
	}
	const out = get("out") ?? `${getOmtDir()}/evidence/qa-report-${session}.html`;
	const narrativePath = get("narrative");
	const narrative: QaReportNarrative = narrativePath ? JSON.parse(readFileSync(narrativePath, "utf8")) : {};
	const view = readQaView(session);
	if (!view) {
		process.stderr.write(`qa-report: no state found for session "${session}"\n`);
		process.exit(1);
	}
	const html = renderQaReport(view, narrative);
	if (html === null) {
		process.stdout.write("qa-report: no roster recorded this cycle — report not generated (PRE-FLIGHT fail-fast)\n");
		return;
	}
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, html, "utf8");
	process.stdout.write(`${out}\n`);
}

if (import.meta.main) {
	main();
}

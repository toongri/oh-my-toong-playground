// Structural probe over the RED/GREEN trees.
//
// Measures the candidate rubric items on every produced document so the rubric
// is finalized against observed baselines rather than guesses. Each item is
// scored by a predicate that a script can run — items that need judgment are
// deliberately absent here; this probe measures only what is mechanically
// decidable.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Fixture {
	id: string;
	range: string;
}

/** Fixture rows from manifest.json, narrowed off the untyped JSON parse. */
function fixtures(): Fixture[] {
	const raw: unknown = manifest["fixtures"];
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((x) => {
		if (x === null || typeof x !== "object") return [];
		const r: Record<string, unknown> = {};
		Object.assign(r, x);
		const id = r["id"];
		const range = r["range"];
		if (typeof id !== "string" || typeof range !== "string") return [];
		return [{ id, range }];
	});
}

/** Report line to stdout. These scripts ARE their output; no-console targets debugging leftovers. */
function say(line: string): void {
	process.stdout.write(`${line}\n`);
}

const EVAL = process.env["OMT_EVAL_ROOT"] ?? `${process.env["HOME"]}/.omt/oh-my-toong-playground/explain-diff-eval`;

// Which tree to score. Defaults preserve the original RED invocation exactly;
// the GREEN arm passes its own arm/control so both trees run the same probe.
const ARM = process.argv[2] || "red";
const CONTROLS = (process.argv[3] || "naive,gist").split(",");
const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "manifest.json"), "utf8"));

const NOISE = /(^|\/)(bun\.lock|package-lock\.json|.*\.snap|dist\/|.*\.generated\..*)$/;

function changedFiles(fixtureId: string): string[] {
	const f = fixtures().find((x) => x.id === fixtureId);
	if (f === undefined) throw new Error(`manifest.json에 fixture가 없습니다: ${fixtureId}`);
	const wt = path.join(EVAL, "fixtures", fixtureId);
	const out = execFileSync("git", ["-C", wt, "diff", "--name-only", ...f.range.split("..").join("..").split(" ")], {
		encoding: "utf8",
	});
	return out.split("\n").filter(Boolean);
}

// Strip the quiz section: "why" language inside quiz prompts is a question, not
// a claim, and counting it inflated the fabrication signal in the first pass.
function body(text: string): string {
	const idx = text.search(/(^|\n)#{1,3}\s*(quiz|퀴즈)|<h[1-3][^>]*>\s*(quiz|퀴즈)/i);
	return idx > 0 ? text.slice(0, idx) : text;
}

// Presentation chrome that is not prose: stylesheets and CSS comments. Box-drawing
// characters inside them are decorative rules, not diagrams.
function stripDecoration(text: string): string {
	return text.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

type Row = Record<string, string | number>;

const rows: Row[] = [];

for (const platform of ["claude", "codex"]) {
	for (const control of CONTROLS) {
		for (const fx of fixtures()) {
			const dir = path.join(EVAL, ARM, platform, control, fx.id);
			if (!fs.existsSync(dir)) continue;
			// Prefer the markdown source: the rubric's structural slots are authored
			// in markdown, and the rendered HTML wraps them in tags that a literal
			// heading match no longer sees.
			const names = fs.readdirSync(dir).filter((n) => n !== "run.log" && !n.startsWith("."));
			const file = names.find((n) => n.endsWith(".md")) ?? names[0];
			if (!file) continue;
			const text = fs.readFileSync(path.join(dir, file), "utf8");
			const b = body(text);

			const signal = changedFiles(fx.id).filter((p) => !NOISE.test(p));
			const mentioned = signal.filter((p) => text.includes(p) || text.includes(path.basename(p)));

			rows.push({
				plat: platform,
				ctl: control,
				fx: fx.id,
				kb: Math.round(text.length / 1024),
				// G1 — named change groups
				group: (b.match(/(change group|변경 그룹|그룹\s*\d|group\s*\d)/gi) || []).length,
				// G2 — every signal file reachable in the document
				files: `${mentioned.length}/${signal.length}`,
				// G4 — a why backed by a marker rather than asserted flat
				unk: (text.match(/(unknown\s*\/\s*not supplied|명시되지 않|알 수 없)/gi) || []).length,
				infer: (text.match(/\[추론|\[inference|추정하건대|presumably|likely because/gi) || []).length,
				// G5 — two-tier background with an explicit skip marker
				skip: (b.match(/(건너뛰|skip (this|ahead)|이미 (아는|익숙)|already familiar)/gi) || []).length,
				// G7 — ASCII diagrams. Three things masquerade as one here and the
				// first pass counted all of them: CSS comment rules (/* ──── */),
				// <style> blocks, and markdown table delimiter rows (|---|---|).
				// None is a diagram. Strip the first two, then exclude any line that
				// is only table punctuation.
				ascii: (stripDecoration(text)
					.split("\n")
					.filter((l) => /^[ \t]*[+|][-+|=]{3,}|[┌└├┤┬┴─│]{3,}/.test(l))
					.filter((l) => !/^[ \t]*\|[\s:|-]*\|[\s:|-]*$/.test(l))).length,
				// G8 — traceability
				fileline: (text.match(/[\w./-]+\.(ts|tsx|js|sh|md|yaml|json):\d+/g) || []).length,
				// G9 — quiz shape. Detecting multiple choice by <input type="radio">
				// alone missed every gist run: they render options as clickable divs
				// carrying the answer index (data-answer / data-correct), which is
				// still multiple choice — the reader picks from shown options rather
				// than recalling. Judge by "are the options shown", not by widget.
				mcq: (text.match(
					/(<input[^>]+type=["']radio|data-(answer|correct)\b|class=["'][^"']*\b(option|choice)\b|option\s*[a-d]\)|^\s*[A-D][).]\s)/gim,
				) || []).length,
			});
		}
	}
}

const cols = Object.keys(rows[0]);
say(cols.map((c) => c.padEnd(c === "fx" ? 19 : 7)).join(" "));
for (const r of rows) {
	say(cols.map((c) => String(r[c]).padEnd(c === "fx" ? 19 : 7)).join(" "));
}

// Column totals for the binary items — how many of the 16 documents exhibit it.
say(`\n--- ${rows.length}건 중 해당 항목이 1회 이상 나타난 문서 수 ---`);
for (const c of ["group", "unk", "infer", "skip", "ascii", "fileline", "mcq"]) {
	const n = rows.filter((r) => Number(r[c]) > 0).length;
	say(`${c.padEnd(9)} ${n}/${rows.length}`);
}
const full = rows.filter((r) => {
	const [a, b2] = String(r.files).split("/").map(Number);
	return a === b2;
}).length;
say(`files=전수 ${full}/${rows.length}`);

// Scores produced documents with the PRODUCTION structural checker.
//
// probe.ts measures candidate signals for rubric design; this runs the exact
// predicate the shipped gate runs (lib/explain-diff-structure.ts), so a GREEN
// number here means "this document would have passed the real gate", not "it
// resembles something that would".
//
//   score-structure.ts <arm> <controls-csv>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkStructure } from "../../../lib/explain-diff-structure.ts";

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
const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "manifest.json"), "utf8"));
const ARM = process.argv[2] || "green";
const CONTROLS = (process.argv[3] || "skill").split(",");

const NOISE = /(^|\/)(bun\.lock|package-lock\.json|.*\.snap|dist\/|.*\.generated\..*)$/;

function nameStatus(fixtureId: string): Array<{ status: string; file: string }> {
	const f = fixtures().find((x) => x.id === fixtureId);
	if (f === undefined) throw new Error(`manifest.json에 fixture가 없습니다: ${fixtureId}`);
	const wt = path.join(EVAL, "fixtures", fixtureId);
	const out = execFileSync("git", ["-C", wt, "diff", "--name-status", ...f.range.split(" ")], {
		encoding: "utf8",
	});
	return out
		.split("\n")
		.filter(Boolean)
		.map((line) => line.split("\t"))
		.filter((parts) => parts.length >= 2)
		.flatMap((parts) => {
			const status = parts[0];
			const file = parts[parts.length - 1];
			if (status === undefined || file === undefined || NOISE.test(file)) return [];
			return [{ status, file }];
		});
}

let total = 0;
let passed = 0;
const itemFails: Record<string, number> = {};

for (const platform of ["claude", "codex"]) {
	for (const control of CONTROLS) {
		for (const fx of fixtures()) {
			const dir = path.join(EVAL, ARM, platform, control, fx.id);
			if (!fs.existsSync(dir)) continue;
			const names = fs.readdirSync(dir).filter((n) => n !== "run.log" && !n.startsWith("."));
			const file = names.find((n) => n.endsWith(".md"));
			if (!file) continue;
			const text = fs.readFileSync(path.join(dir, file), "utf8");
			const ns = nameStatus(fx.id);
			const signalFiles = ns.map((e) => e.file);
			const addedFiles = ns.filter((e) => e.status.startsWith("A")).map((e) => e.file);
			// A finished document has no single "step" — it is the union of every
			// authoring step's output. `code` covers R2/R3/R5/R1(coverage form);
			// `background` covers R4. Together that is exactly the original
			// unconditional five-item rubric, with no id scored twice.
			const codeResult = checkStructure(text, { signalFiles, addedFiles, step: "code" });
			const backgroundResult = checkStructure(text, { signalFiles, addedFiles, step: "background" });
			const r = {
				pass: codeResult.pass && backgroundResult.pass,
				items: [...codeResult.items, ...backgroundResult.items],
				failedItems: [...codeResult.failedItems, ...backgroundResult.failedItems],
			};
			total += 1;
			if (r.pass) passed += 1;
			const failed = r.items.filter((i) => !i.pass).map((i) => i.id);
			for (const id of failed) itemFails[id] = (itemFails[id] ?? 0) + 1;
			say(
				`${platform.padEnd(7)}${control.padEnd(7)}${fx.id.padEnd(20)}${r.pass ? "PASS" : "FAIL"}  ${failed.join(",")}`,
			);
			for (const line of r.failedItems) say(`        ${line}`);
		}
	}
}

say(`\n구조 검사 통과: ${passed}/${total}`);
for (const id of ["R1", "R2", "R3", "R4", "R5"]) {
	say(`${id} 실패 ${itemFails[id] ?? 0}/${total}`);
}

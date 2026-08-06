#!/usr/bin/env bun
/**
 * explain-diff state CLI — the only writer of explain-diff-state-<sid>.json.
 *
 * Every step transition passes through here, which is what makes the gate real:
 * the PreToolUse artifact guard and the Stop gate read booleans this CLI wrote,
 * and hooks/write-guard-core.sh denies any attempt to edit the file directly.
 * A step cannot advance because someone said it did — it advances because the
 * structural checks in lib/explain-diff-structure.ts passed and a judge backed
 * every existence claim with a quote this CLI found in the document.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { getOmtDir } from "@lib/omt-dir";
import { nowStamp, resolveSessionIdOrThrow, STATE_PREFIX } from "@lib/state-core";
import {
	computeDerived,
	nextStep,
	normalizeExplainDiffState,
	REQUIRED_JUDGE_IDS,
	STEP_ORDER,
	type ExplainDiffState,
	type Step,
} from "@lib/explain-diff-core";
import { checkStructure } from "@lib/explain-diff-structure";

interface Persisted extends ExplainDiffState {
	range: string;
	slug: string;
	/** Steps whose structural checks passed but whose judge review has not run. */
	structural_ok: Step[];
	started_at: string;
	last_touched_at: string;
	derived: ReturnType<typeof computeDerived>;
}

function statePath(sessionId: string): string {
	return `${getOmtDir()}/${STATE_PREFIX["explain-diff"]}${sessionId}.json`;
}

// mkdir is atomic, which is the property this needs: two CLI processes racing on
// the same state file must serialize, and the loser must wait rather than
// clobber. Same mechanism qa-state.ts uses, for the same reason.
const LOCK_RETRIES = 200;
const LOCK_SLEEP = new Int32Array(new SharedArrayBuffer(4));

function withLock<T>(path: string, fn: () => T): T {
	const lockPath = `${path}.lock`;
	for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
		try {
			mkdirSync(lockPath, { recursive: false });
			try {
				return fn();
			} finally {
				rmSync(lockPath, { recursive: true, force: true });
			}
		} catch (err) {
			// Only a lost create race is retryable; anything else is a real failure
			// and must surface rather than spin for a second.
			const code =
				err !== null && typeof err === "object" && "code" in err ? String(err.code) : "";
			if (code !== "EEXIST") throw err;
			Atomics.wait(LOCK_SLEEP, 0, 0, 5);
		}
	}
	throw new Error(`could not acquire state lock: ${path}.lock`);
}

function read(sessionId: string): Persisted | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(statePath(sessionId), "utf8"));
		const base = normalizeExplainDiffState(parsed);
		if (!base) return null;
		const r: Record<string, unknown> = {};
		Object.assign(r, parsed);
		const structuralRaw = r["structural_ok"];
		return {
			...base,
			structural_ok: Array.isArray(structuralRaw)
				? structuralRaw.flatMap((x) => STEP_ORDER.find((s) => s === x) ?? [])
				: [],
			range: typeof r["range"] === "string" ? r["range"] : "",
			slug: typeof r["slug"] === "string" ? r["slug"] : "",
			started_at: typeof r["started_at"] === "string" ? r["started_at"] : nowStamp(),
			last_touched_at:
				typeof r["last_touched_at"] === "string" ? r["last_touched_at"] : nowStamp(),
			// Recomputed on every write; the persisted copy is never trusted on read.
			derived: computeDerived(base),
		};
	} catch {
		return null;
	}
}

/** Every write recomputes `derived` — the booleans the hooks read are never stale. */
function write(sessionId: string, state: Persisted): void {
	state.derived = computeDerived(state);
	state.last_touched_at = nowStamp();
	const path = statePath(sessionId);
	mkdirSync(getOmtDir(), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function mustRead(sessionId: string): Persisted {
	const s = read(sessionId);
	if (!s) throw new Error("explain-diff 상태가 없습니다. 먼저 `start` 를 실행하세요.");
	return s;
}

function start(sessionId: string, range: string, slug: string): void {
	const ts = nowStamp();
	const seed: Persisted = {
		active: true,
		step: "evidence",
		passed: [],
		structural_ok: [],
		concepts: [],
		bank: [],
		awaiting_answer: false,
		no_progress: { key: "", count: 0, doc_digest: "" },
		last_failure: null,
		range,
		slug,
		started_at: ts,
		last_touched_at: ts,
		derived: {
			artifact_write_allowed: false,
			quiz_passed: false,
			stop_allowed: false,
			no_progress_tripped: false,
			block_reason: "",
		},
	};
	withLock(statePath(sessionId), () => write(sessionId, seed));
}

/**
 * render is a derivation, not authoring — the markdown structure slots (R1..R5)
 * were already earned at `code`, so this checks the artifact itself exists and
 * is not empty rather than re-running a check aimed at prose.
 */
function checkRenderOutput(htmlPath: string | undefined): { pass: boolean; failedItems: string[] } {
	if (!htmlPath) {
		return { pass: false, failedItems: ["render 산출물 경로(--html)가 없습니다."] };
	}
	let size: number;
	try {
		size = statSync(htmlPath).size;
	} catch {
		return { pass: false, failedItems: [`render 산출물을 찾을 수 없습니다: ${htmlPath}`] };
	}
	if (size === 0) {
		return { pass: false, failedItems: [`render 산출물이 비어 있습니다: ${htmlPath}`] };
	}
	return { pass: true, failedItems: [] };
}

/**
 * Runs the script-decidable rubric items against the section just authored.
 * A failure is recorded, not just reported: `last_failure` is what the artifact
 * guard's deny message quotes back, so the author reads the same sentence the
 * gate acted on.
 */
function submitStep(
	sessionId: string,
	step: Step,
	docPath: string,
	signalFiles: string[],
	addedFiles: string[],
	htmlPath?: string,
): number {
	return withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		if (s.step !== step) {
			throw new Error(`현재 스텝은 ${s.step} 입니다. ${step} 을 제출할 수 없습니다.`);
		}
		const result =
			step === "render"
				? checkRenderOutput(htmlPath)
				: checkStructure(readFileSync(docPath, "utf8"), { signalFiles, addedFiles, step });
		if (!result.pass) {
			s.last_failure = { step, items: result.failedItems };
			s.structural_ok = s.structural_ok.filter((x) => x !== step);
			write(sessionId, s);
			process.stderr.write(`${result.failedItems.join("\n")}\n`);
			return 1;
		}
		s.last_failure = null;
		if (!s.structural_ok.includes(step)) s.structural_ok.push(step);
		write(sessionId, s);
		return 0;
	});
}

interface JudgeItem {
	id: string;
	pass: boolean;
	quote?: string;
}

/**
 * Records the judge's verdict and advances the step.
 *
 * Two refusals matter here. A judge that passes an existence item without a
 * quote is refused, and a quote that is not a literal substring of the document
 * is refused — an unverifiable citation is how a review-shaped gate turns into a
 * rubber stamp, and both checks are cheap enough to run every time.
 */
function passStep(sessionId: string, step: Step, docPath: string, judge: JudgeItem[]): number {
	return withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		if (s.step !== step) throw new Error(`현재 스텝은 ${s.step} 입니다.`);
		if (!s.structural_ok.includes(step)) {
			throw new Error(`${step} 구조 검사를 먼저 통과시키세요 (\`submit-step\`).`);
		}
		const text = readFileSync(docPath, "utf8");
		const bad: string[] = [];
		// A required id missing from the payload entirely is refused before the
		// per-item loop runs — an empty (or off-topic) judge array must not
		// vacuously satisfy a step whose rubric depends on the judge's review.
		const presentIds = new Set(judge.map((item) => item.id));
		for (const id of REQUIRED_JUDGE_IDS[step]) {
			if (!presentIds.has(id)) bad.push(`${id}: 심사 판정이 없습니다`);
		}
		for (const item of judge) {
			if (!item.pass) {
				bad.push(`${item.id}: 심사 실패`);
				continue;
			}
			if (!item.quote) {
				bad.push(`${item.id}: pass 인데 인용이 없습니다 — 인용 없는 통과는 자동 실패입니다.`);
				continue;
			}
			if (!text.includes(item.quote)) {
				bad.push(`${item.id}: 인용이 문서에 문자열로 존재하지 않습니다 — "${item.quote}"`);
			}
		}
		if (bad.length > 0) {
			s.last_failure = { step, items: bad };
			write(sessionId, s);
			process.stderr.write(`${bad.join("\n")}\n`);
			return 1;
		}
		s.last_failure = null;
		if (!s.passed.includes(step)) s.passed.push(step);
		const nxt = nextStep(step);
		if (nxt) s.step = nxt;
		write(sessionId, s);
		return 0;
	});
}

function addConcept(sessionId: string, id: string, required: boolean): void {
	withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		if (!s.concepts.some((c) => c.id === id)) s.concepts.push({ id, required, passed: false });
		write(sessionId, s);
	});
}

/** Marks a question outstanding. The Stop gate reads this and permits the wait. */
function ask(sessionId: string): void {
	withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		s.awaiting_answer = true;
		write(sessionId, s);
	});
}

/**
 * Records one graded answer.
 *
 * The no-progress counter advances only when the SAME rubric item fails again on
 * an UNCHANGED document. Either a different missing item or an edited document
 * resets it, so the escalation fires on a genuinely stuck loop rather than on a
 * reader who is simply taking more than one attempt.
 */
function grade(sessionId: string, concept: string, missing: string[], docDigest: string): void {
	withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		// No pending question means no reader answer exists to grade — reject before
		// any mutation so a grade attempted without `ask` leaves the state untouched,
		// not just leaves `passed` false.
		if (s.awaiting_answer !== true) {
			throw new Error(
				"채점할 수 없습니다: 먼저 `ask` 로 문항을 내고 독자의 답을 받아야 합니다.",
			);
		}
		s.awaiting_answer = false;
		const c = s.concepts.find((x) => x.id === concept);
		if (!c) throw new Error(`알 수 없는 개념: ${concept}`);
		if (missing.length === 0) {
			c.passed = true;
			s.no_progress = { key: "", count: 0, doc_digest: docDigest };
		} else {
			const key = `${concept}:${missing.slice().sort().join("|")}`;
			s.no_progress =
				s.no_progress.key === key && s.no_progress.doc_digest === docDigest
					? { key, count: s.no_progress.count + 1, doc_digest: docDigest }
					: { key, count: 1, doc_digest: docDigest };
			if (computeDerived({ ...s, no_progress: s.no_progress }).no_progress_tripped) s.stalled = true;
		}
		write(sessionId, s);
	});
}

function complete(sessionId: string): number {
	return withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		const d = computeDerived(s);
		if (!d.quiz_passed) {
			process.stderr.write(
				"완료할 수 없습니다: 필수 개념이 전부 통과되지 않았습니다. 남은 개념의 문항을 계속 진행하세요.\n",
			);
			return 1;
		}
		s.active = false;
		write(sessionId, s);
		return 0;
	});
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | string[] | boolean> {
	const out: Record<string, string | string[] | boolean> = {};
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === undefined || !a.startsWith("--")) continue;
		const key = a.slice(2);
		const next = argv[i + 1];
		if (next === undefined || next.startsWith("--")) {
			out[key] = true;
			continue;
		}
		const prior = out[key];
		if (prior === undefined) out[key] = next;
		else if (Array.isArray(prior)) prior.push(next);
		else out[key] = [String(prior), next];
		i += 1;
	}
	return out;
}

function req(args: Record<string, string | string[] | boolean>, name: string): string {
	const v = args[name];
	if (typeof v !== "string" || v.length === 0) throw new Error(`--${name} 은 필수입니다.`);
	return v;
}

/** Validates the step name against the known set instead of asserting it. */
function reqStep(args: Record<string, string | string[] | boolean>, name: string): Step {
	const raw = req(args, name);
	const found = STEP_ORDER.find((s) => s === raw);
	if (!found) throw new Error(`알 수 없는 스텝: ${raw} (가능: ${STEP_ORDER.join(", ")})`);
	return found;
}

/**
 * Parses the judge's verdict array. A malformed payload is rejected here rather
 * than trusted into the gate — this is the one input a subagent controls.
 */
function parseJudge(raw: string): JudgeItem[] {
	const parsed: unknown = JSON.parse(raw);
	if (!Array.isArray(parsed)) throw new Error("--judge-json 은 JSON 배열이어야 합니다.");
	return parsed.map((entry, i) => {
		if (entry === null || typeof entry !== "object") {
			throw new Error(`--judge-json[${i}] 이 객체가 아닙니다.`);
		}
		const rec: Record<string, unknown> = {};
		Object.assign(rec, entry);
		const id = rec["id"];
		if (typeof id !== "string") throw new Error(`--judge-json[${i}].id 가 없습니다.`);
		const quote = rec["quote"];
		return { id, pass: rec["pass"] === true, quote: typeof quote === "string" ? quote : undefined };
	});
}

function csv(raw: string): string[] {
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function list(args: Record<string, string | string[] | boolean>, name: string): string[] {
	const v = args[name];
	if (v === undefined || typeof v === "boolean") return [];
	return Array.isArray(v) ? v : [v];
}

function main(): void {
	const sub = process.argv[2];
	const args = parseArgs(process.argv.slice(3));
	try {
		const sessionId = resolveSessionIdOrThrow();
		switch (sub) {
			case "start":
				start(sessionId, req(args, "range"), req(args, "slug"));
				break;
			case "get":
				process.stdout.write(`${JSON.stringify(read(sessionId))}\n`);
				break;
			case "submit-step":
				process.exit(
					submitStep(
						sessionId,
						reqStep(args, "step"),
						req(args, "doc"),
						csv(req(args, "signal-files")),
						csv(typeof args["added-files"] === "string" ? args["added-files"] : ""),
						typeof args["html"] === "string" ? args["html"] : undefined,
					),
				);
				break;
			case "pass-step":
				process.exit(
					passStep(
						sessionId,
						reqStep(args, "step"),
						req(args, "doc"),
						parseJudge(req(args, "judge-json")),
					),
				);
				break;
			case "add-concept":
				addConcept(sessionId, req(args, "id"), args["required"] === true);
				break;
			case "ask":
				ask(sessionId);
				break;
			case "grade":
				grade(sessionId, req(args, "concept"), list(args, "missing"), req(args, "doc-digest"));
				break;
			case "complete":
				process.exit(complete(sessionId));
				break;
			default:
				process.stderr.write(
					`Usage: explain-diff-state.ts <start|get|submit-step|pass-step|add-concept|ask|grade|complete> [options]\n` +
						`Steps: ${STEP_ORDER.join(" -> ")}\n`,
				);
				process.exit(1);
		}
	} catch (e) {
		process.stderr.write(`explain-diff-state: ${String(e)}\n`);
		process.exit(1);
	}
}

if (import.meta.main) {
	main();
}

export { start, submitStep, passStep, addConcept, ask, grade, complete, read, statePath };

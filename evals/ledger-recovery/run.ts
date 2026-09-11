import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Scenario = { id: string; facts: string; task: string; ledger: string };
type Arm = "control" | "current" | "improved";
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object";
const root = path.dirname(fileURLToPath(import.meta.url));
const fixture: unknown = JSON.parse(readFileSync(path.join(root, "scenarios.json"), "utf8"));
if (
	!isRecord(fixture) ||
	typeof fixture.id !== "string" ||
	typeof fixture.facts !== "string" ||
	typeof fixture.task !== "string" ||
	typeof fixture.ledger !== "string"
)
	throw new Error("invalid scenario fixture");
const scenario: Scenario = {
	id: fixture.id,
	facts: fixture.facts,
	task: fixture.task,
	ledger: fixture.ledger,
};
const evidence =
	process.env.OMT_EVAL_ROOT ??
	path.join(
		os.homedir(),
		".omt",
		"oh-my-toong-playground",
		"evidence",
		"ledger-recovery-improvement",
	);
const seededLedger = `${scenario.ledger}## Learnings\n${"inactive historical note: superseded context; do not use as current state.\n".repeat(5000)}`;
const frozenSourceFiles = ["ledger-core.sh", "omt-ledger.sh", "lib/omt-dir.sh"];
const improvedSourceFiles = [...frozenSourceFiles, "lib/ledger-events.mjs"];
const usage =
	"usage: bun evals/ledger-recovery/run.ts --arm control|current|improved --rep 1..5 [--smoke]";
const nodeExec = execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
const nodePath = `${path.dirname(nodeExec)}:${process.env.PATH ?? ""}`;
process.env.PATH = nodePath;

function parseArgs(): { arm?: Arm; rep?: number; smoke: boolean; help: boolean } {
	const args = process.argv.slice(2);
	let arm: Arm | undefined;
	let rep: number | undefined;
	let smoke = false;
	let help = false;
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (arg === "--smoke") {
			smoke = true;
			continue;
		}
		if (arg === "--arm") {
			const value = args[++i];
			if (value !== "control" && value !== "current" && value !== "improved")
				throw new Error(`${usage}\ninvalid --arm`);
			arm = value;
			continue;
		}
		if (arg === "--rep") {
			const value = Number(args[++i]);
			if (!Number.isInteger(value) || value < 1 || value > 5)
				throw new Error(`${usage}\ninvalid --rep (must be 1..5)`);
			rep = value;
			continue;
		}
		throw new Error(`${usage}\nunknown argument: ${arg}`);
	}
	if (help) return { arm, rep, smoke, help };
	if (smoke && !arm && !rep) return { smoke, help };
	if (!arm || !rep)
		throw new Error(`${usage}\n--arm and --rep are required (one process runs one cell)`);
	return { arm, rep, smoke, help };
}

function sourceText(file: string, arm: Arm): string {
	if (arm === "improved") return readFileSync(path.join(root, "../../hooks", file), "utf8");
	return execFileSync("git", ["show", `c85d70e7:hooks/${file}`], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
}

function materialize(
	work: string,
	sid: string,
	arm: Arm,
): { core: string; home: string; sourceMap: Record<string, string> } {
	const deployed = path.join(work, "deployed-hooks");
	const home = path.join(work, "codex-home");
	mkdirSync(path.join(deployed, "lib"), { recursive: true });
	const sourceMap: Record<string, string> = {};
	for (const file of arm === "improved" ? improvedSourceFiles : frozenSourceFiles) {
		const content = sourceText(file, arm);
		const target = path.join(deployed, file);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, content);
		sourceMap[file] = createHash("sha256").update(content).digest("hex");
	}
	chmodSync(path.join(deployed, "omt-ledger.sh"), 0o755);
	mkdirSync(path.join(home, "hooks"), { recursive: true });
	const wrapper = path.join(home, "hooks", "omt-ledger.sh");
	writeFileSync(
		wrapper,
		`#!/bin/bash\nexport CODEX_THREAD_ID=${sid}\nexec bash "${path.join(deployed, "omt-ledger.sh")}" "$@"\n`,
	);
	chmodSync(wrapper, 0o755);
	return { core: path.join(deployed, "ledger-core.sh"), home, sourceMap };
}

function smokeFixture(work: string, sid: string, arm: Arm): void {
	const smokeRoot = path.join(work, "smoke-fixture");
	const omt = path.join(smokeRoot, "omt");
	mkdirSync(omt, { recursive: true });
	const fixture = materialize(smokeRoot, sid, arm);
	const env = {
		...process.env,
		PATH: nodePath,
		OMT_DIR: omt,
		OMT_SESSION_ID: sid,
		CODEX_THREAD_ID: sid,
		CODEX_HOME: fixture.home,
		HOME: smokeRoot,
	};
	const wrapper = path.join(fixture.home, "hooks", "omt-ledger.sh");
	if (arm === "improved") {
		const checkpoint =
			'{"goal":"smoke","scope":"fixture","user_updates":"smoke","done":"no","pending":"smoke","next":"smoke","refs":[]}';
		execFileSync(
			"bash",
			["-c", 'printf \'%s\' "$1" | "$2" checkpoint', "bash", checkpoint, wrapper],
			{ encoding: "utf8", env },
		);
		const recovery = execFileSync(
			"bash",
			["-c", '"$1" recover --max-bytes 2000', "bash", wrapper],
			{ encoding: "utf8", env },
		);
		if (!recovery.includes("smoke") || !recovery.includes("checkpoint"))
			throw new Error("improved fixture recovery smoke failed");
		const context = hookContext(smokeRoot, sid, fixture);
		if (!context.includes("[LEDGER RECOVERY]")) throw new Error("hook context smoke failed");
		execFileSync(
			"bash",
			[
				"-c",
				"printf '%s' context-smoke | \"$1/hooks/omt-ledger.sh\" append Decisions",
				"bash",
				fixture.home,
			],
			{ encoding: "utf8", env },
		);
		if (!readFileSync(path.join(omt, `session-ledger-${sid}.md`), "utf8").includes("context-smoke"))
			throw new Error("helper SID smoke failed");
	} else
		execFileSync("bash", ["-c", "printf '%s' smoke | \"$1\" append Decisions", "bash", wrapper], {
			encoding: "utf8",
			env,
		});
	const ledger = path.join(omt, `session-ledger-${sid}.md`);
	if (!existsSync(ledger) || !readFileSync(wrapper, "utf8").includes(`CODEX_THREAD_ID=${sid}`))
		throw new Error("fixture helper smoke identity failed");
}

function hookContext(work: string, sid: string, fixture: { core: string; home: string }): string {
	const omt = path.join(work, ".omt");
	mkdirSync(omt, { recursive: true });
	writeFileSync(path.join(omt, `session-ledger-${sid}.md`), seededLedger);
	const env = {
		...process.env,
		PATH: nodePath,
		OMT_DIR: omt,
		OMT_SESSION_ID: sid,
		CODEX_HOME: fixture.home,
		HOME: work,
	};
	const output = execFileSync(
		"bash",
		["-c", 'source "$1"; ledger_core_run codex', "bash", fixture.core],
		{
			input: JSON.stringify({ source: "compact", session_id: sid, cwd: work }),
			encoding: "utf8",
			env,
		},
	);
	const parsed: unknown = JSON.parse(output);
	if (
		!isRecord(parsed) ||
		!isRecord(parsed.hookSpecificOutput) ||
		typeof parsed.hookSpecificOutput.additionalContext !== "string"
	)
		throw new Error("hook output is invalid");
	return parsed.hookSpecificOutput.additionalContext;
}

function copyAuth(codexHome: string): void {
	const source = path.join(
		process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
		"auth.json",
	);
	if (existsSync(source)) {
		mkdirSync(codexHome, { recursive: true });
		cpSync(source, path.join(codexHome, "auth.json"));
	}
}

function wholeReadFlag(events: string): boolean {
	for (const line of events.split("\n")) {
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(value) || value.type !== "item.completed" || !isRecord(value.item)) continue;
		const item = value.item;
		const command = item.command;
		if (item.type !== "command_execution" || typeof command !== "string") continue;
		if (
			/\bcat\b[^\n]*session-ledger-/.test(command) &&
			!/[>]|<<|\|\s*(head|tail|sed|awk)\b/.test(command)
		)
			return true;
	}
	return false;
}

function runCell(arm: Arm, rep: number): void {
	const work = mkdtempSync(path.join(os.tmpdir(), "ledger-recovery-v3-"));
	const sid = `ledger-v3-${arm}-${rep}`;
	const omt = path.join(work, ".omt");
	mkdirSync(omt, { recursive: true });
	const report = path.join(work, "release-readiness.md");
	const ledger = path.join(omt, `session-ledger-${sid}.md`);
	const template = "# Release readiness\n\nStatus: in progress\n";
	try {
		const fixture = materialize(work, sid, arm);
		copyAuth(fixture.home);
		writeFileSync(ledger, seededLedger);
		writeFileSync(report, template);
		smokeFixture(work, `${sid}-smoke`, arm);
		rmSync(path.join(work, "smoke-fixture"), { recursive: true, force: true });
		const guidance = arm === "control" ? "" : hookContext(work, sid, fixture);
		const prompt = [
			"Work only in the supplied workspace. Do not use network or external services.",
			scenario.facts,
			scenario.task,
			"Inspect the existing report and session ledger if useful. Then update the report and durable ledger with what you actually learned and the next state. Do not merely describe what you would do: use tools and leave artifacts.",
			`Report path: ${report}\nLedger path: ${ledger}`,
		].join("\n\n");
		const env = {
			...process.env,
			HOME: work,
			CODEX_HOME: fixture.home,
			OMT_DIR: omt,
			OMT_SESSION_ID: sid,
			CODEX_THREAD_ID: sid,
		};
		const args = [
			"exec",
			"-C",
			work,
			"-s",
			"workspace-write",
			"--skip-git-repo-check",
			"--ephemeral",
			"--json",
			"-o",
			path.join(work, "last.txt"),
		];
		if (guidance) args.push("-c", `developer_instructions=${JSON.stringify(guidance)}`);
		args.push(prompt);
		let events = "";
		let stderr = "";
		let infrastructure = "";
		try {
			events = execFileSync("codex", args, {
				encoding: "utf8",
				timeout: 240000,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			const e = isRecord(error) ? error : {};
			const out = e.stdout;
			const err = e.stderr;
			events = typeof out === "string" ? out : Buffer.isBuffer(out) ? out.toString() : "";
			stderr = typeof err === "string" ? err : Buffer.isBuffer(err) ? err.toString() : "";
			infrastructure = typeof e.message === "string" ? e.message : String(error);
		}
		const response = existsSync(path.join(work, "last.txt"))
			? readFileSync(path.join(work, "last.txt"), "utf8")
			: "";
		const dir = path.join(evidence, arm, `rep-${rep}`);
		mkdirSync(dir, { recursive: true });
		const after = existsSync(ledger) ? readFileSync(ledger, "utf8") : "<missing ledger>";
		const reportText = existsSync(report) ? readFileSync(report, "utf8") : "<missing report>";
		writeFileSync(path.join(dir, "prompt.txt"), prompt);
		writeFileSync(path.join(dir, "response.txt"), response);
		writeFileSync(path.join(dir, "events.jsonl"), events);
		writeFileSync(path.join(dir, "events.stderr.txt"), stderr);
		writeFileSync(
			path.join(dir, "infrastructure.json"),
			JSON.stringify(
				{ classification: infrastructure ? "cli_error" : "none", detail: infrastructure },
				null,
				2,
			) + "\n",
		);
		writeFileSync(path.join(dir, "ledger-before.md"), seededLedger);
		writeFileSync(path.join(dir, "ledger-after.md"), after);
		writeFileSync(path.join(dir, "report-after.md"), reportText);
		writeFileSync(path.join(dir, "guidance.txt"), guidance);
		writeFileSync(
			path.join(dir, "source-bytes.txt"),
			Object.entries(fixture.sourceMap)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([file, hash]) => `${file} sha256=${hash}`)
				.concat([
					`source-origin=${arm === "improved" ? "working-tree" : "git:c85d70e7"}`,
					`ledger-before-bytes=${Buffer.byteLength(seededLedger, "utf8")}`,
					"baseline-reference=c85d70e7",
				])
				.join("\n") + "\n",
		);
		const row =
			[
				`arm=${arm}`,
				`rep=${rep}`,
				`cli_error=${infrastructure ? "yes" : "no"}`,
				`report_written=${reportText !== template ? "yes" : "no"}`,
				`ledger_changed=${after !== seededLedger ? "yes" : "no"}`,
				`whole_ledger_read_flag=${wholeReadFlag(events) ? "manual-review" : "none"}`,
				`handle_in_ledger=${after.includes("worker-payment-7") ? "yes" : "no"}`,
				`scope_in_ledger=${after.includes("GraphQL-only") ? "yes" : "no"}`,
			].join("\n") + "\n";
		writeFileSync(path.join(dir, "summary.tsv"), row);
		process.stdout.write(row + `Evidence: ${dir}\n`);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

try {
	const options = parseArgs();
	if (options.help)
		process.stdout.write(`${usage}\n--smoke runs only the disposable fixture helper smoke.\n`);
	else if (options.smoke) {
		const work = mkdtempSync(path.join(os.tmpdir(), "ledger-recovery-smoke-"));
		try {
			smokeFixture(work, "smoke-only", options.arm ?? "improved");
			process.stdout.write("fixture smoke: pass\n");
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	} else if (options.arm && options.rep) runCell(options.arm, options.rep);
	else throw new Error(`${usage}`);
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 2;
}

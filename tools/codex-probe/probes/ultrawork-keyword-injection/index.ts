#!/usr/bin/env bun
/**
 * ultrawork-keyword-injection probe — spec AC line 81: "codex 세션에
 * ultrawork 키워드를 넣으면 주입 컨텍스트가 실제로 관측된다(센티널 확인)."
 *
 * Runs a REAL `codex exec` session against hooks/codex-keyword-detector.sh
 * (this repo's source, not a possibly-stale deployed copy — see
 * isolated-codex-home.ts's header comment on why that's equivalent for a
 * hook SCRIPT specifically) inside a fully isolated HOME/CODEX_HOME (see
 * isolated-codex-home.ts), and asserts the hook's `<ultrawork-mode>`
 * additionalContext actually lands in the rollout's `injectedContext`
 * channel (types.ts's doc comment on why `baseInstructions` alone would miss
 * this — the CONFIRMED blind spot this repo's parity spec names).
 *
 * Three arms, selected via --arm:
 *   --arm=present  "ultrawork" IS in the prompt, hook IS registered+trusted
 *                  (bypass flag) -> expects the sentinel PRESENT.
 *   --arm=absent   "ultrawork" is NOT in the prompt, hook IS registered — the
 *                  discriminating negative control: only the keyword varies
 *                  from "present", so the mechanism is proven session-scoped
 *                  and prompt-driven, not vacuously always-on -> expects the
 *                  sentinel ABSENT.
 *   --arm=broken   "ultrawork" IS in the prompt (same as "present"), but the
 *                  isolated CODEX_HOME's hooks.json registers NO hooks at all
 *                  (buildIsolatedCodexHome's `{}` "mechanism absent" case) ->
 *                  reuses buildJudgment(true), the SAME judgment "present"
 *                  uses. Under correct code this arm MUST measure exit 1
 *                  (sentinel absent, because nothing injected it) — that
 *                  exit 1 is the CORRECT/expected outcome, proof the harness
 *                  actually discriminates a broken injection mechanism rather
 *                  than vacuously passing. Do not "fix" a red result here.
 *
 * Exit codes (unchanged from probe.ts): 0 pass, 1 fail (measured, judgment
 * false), 2 unmeasurable (env/timeout/parse/auth-copy failure).
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { runProbe } from "../../probe.ts";
import type { ProbeOptions, ProbeSpec } from "../../probe.ts";
import { buildIsolatedCodexHome } from "../../isolated-codex-home.ts";
import type { HooksSpec, IsolatedCodexHome } from "../../isolated-codex-home.ts";
import { buildJudgment } from "./judgment.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const KEYWORD_DETECTOR_SCRIPT = path.join(REPO_ROOT, "hooks", "codex-keyword-detector.sh");

export type Arm = "present" | "absent" | "broken";

const OBJECTIVE =
	"Verify whether the file package.json exists at the repository root " +
	"(falsifiable via `test -f package.json`; report true or false). " +
	"Do not modify anything.";

/**
 * Pure spec builder — no I/O. `cwd` is a scratch project dir (any writable
 * temp dir; the keyword-detector hook doesn't read project files, only the
 * prompt text). `isolated` is a caller-materialized HOME/CODEX_HOME pair
 * (via buildIsolatedCodexHome) — this function only wires it into the
 * session's env and threads `codexHome` through for rollout correlation.
 */
export function buildProbeSpec(cwd: string, arm: Arm, isolated: IsolatedCodexHome): ProbeSpec {
	const keyword = arm === "absent" ? "" : "ultrawork ";
	return {
		session: {
			prompt: `${keyword}${OBJECTIVE}`,
			cwd,
			sandbox: "read-only",
			timeoutMs: 120_000,
			env: { HOME: isolated.home, CODEX_HOME: isolated.codexHome },
			// Sanctioned ONLY for this self-authored-hooks + fresh-CODEX_HOME
			// combination — see isolated-codex-home.ts's header comment.
			extraArgs: ["--dangerously-bypass-hook-trust"],
		},
		judgment: buildJudgment(arm !== "absent"),
		codexHome: isolated.codexHome,
	};
}

export function parseArm(argv: readonly string[]): Arm {
	const flag = argv.find((a) => a.startsWith("--arm="));
	const value = flag?.slice("--arm=".length);
	if (value === "present" || value === "absent" || value === "broken") return value;
	throw new Error(`--arm must be one of present|absent|broken (got ${value ?? "<missing>"})`);
}

export type MainOptions = ProbeOptions & {
	/** Injectable scratch root, bypassing this function's own mkdtemp — hermetic tests only. @default a fresh mkdtemp under os.tmpdir(). */
	scratchRoot?: string;
	/** Injectable auth.json source, bypassing the real `~/.codex/auth.json` — hermetic tests only. */
	authSourcePath?: string;
};

export async function main(arm: Arm, opts: MainOptions = {}): Promise<number> {
	const { scratchRoot: scratchRootOverride, authSourcePath, ...probeOpts } = opts;
	const scratchRoot = scratchRootOverride ?? (await fs.mkdtemp(path.join(os.tmpdir(), "codex-probe-ultrawork-keyword-injection-")));
	const cwd = path.join(scratchRoot, "cwd");
	try {
		await fs.mkdir(cwd, { recursive: true });
		const hooks: HooksSpec = arm === "broken" ? {} : { UserPromptSubmit: [{ command: KEYWORD_DETECTOR_SCRIPT, timeout: 10 }] };
		const isolated = await buildIsolatedCodexHome(scratchRoot, hooks, authSourcePath === undefined ? {} : { authSourcePath });

		const outcome = await runProbe(buildProbeSpec(cwd, arm, isolated), probeOpts);

		if (outcome.exitCode === 2) {
			process.stdout.write(JSON.stringify({ arm, exitCode: 2, reason: outcome.reason, detail: outcome.detail }) + "\n");
		} else {
			process.stdout.write(
				JSON.stringify({
					arm,
					exitCode: outcome.exitCode,
					injectedContextLength: outcome.observation.injectedContext.length,
					finalMessage: outcome.observation.finalMessage,
				}) + "\n",
			);
		}
		return outcome.exitCode;
	} finally {
		await fs.rm(scratchRoot, { recursive: true, force: true });
	}
}

/**
 * Runs the process-boundary entry and returns the exit code — never throws.
 * Same shape as the sibling skill-chain probes' runEntry: an invalid --arm=
 * value or any exception raised while running the probe (mkdtemp, auth copy,
 * spawn) is "the probe could not be measured", not "the probe measured a
 * negative" — so both map to exit 2, not the uncaught-throw exit 1 bun would
 * otherwise produce.
 */
export async function runEntry(argv: readonly string[], opts: MainOptions = {}): Promise<number> {
	let arm: Arm;
	try {
		arm = parseArm(argv);
	} catch (err) {
		process.stderr.write(`codex-probe ultrawork-keyword-injection: ${err instanceof Error ? err.message : String(err)}\n`);
		return 2;
	}
	try {
		return await main(arm, opts);
	} catch (err) {
		process.stderr.write(`codex-probe ultrawork-keyword-injection: unmeasurable — ${err instanceof Error ? err.message : String(err)}\n`);
		return 2;
	}
}

if (import.meta.main) {
	const code = await runEntry(process.argv);
	process.exit(code);
}

#!/usr/bin/env bun
/**
 * rules-runtime-leak-absence probe — spec AC line 76: "codex 세션 프로브에서
 * 주입된 rules 본문에 AskUserQuestion / TaskOutput / TaskCreate /
 * subagent_type 리터럴이 관측되지 않는다."
 *
 * WHY A PLAIN `absent` JUDGMENT IS NOT ENOUGH (this probe's whole reason to
 * exist as custom orchestration rather than a one-line ProbeSpec): an
 * `absent` judgment over injectedContext passes vacuously if rules were
 * never injected into that session AT ALL — a session run in a cwd with no
 * `.codex/rules`, or one where the rules-injector hook silently failed to
 * fire, "passes" the exact same way a correctly-patched pipeline does. Spec
 * AC line 76 demands the positive control this probe's judgment.ts
 * (`evaluateGatedAbsence`) implements: prove the rule body ACTUALLY reached
 * injectedContext (a unique sentinel, present) before trusting an absence
 * result about it — on the SAME observation, not a separate run. See
 * judgment.ts for the pure verdict logic this file only orchestrates a real
 * session around.
 *
 * CONFIRMED environmental defect this probe's isolated-CODEX_HOME setup
 * avoids (measured on this development machine 2026-07-24, real `codex
 * exec` run, default HOME): this user's OWN `~/.claude/rules/tool-usage-
 * policy.md` and `~/.claude/rules/work-principles.md` leak `TaskOutput`,
 * `TaskCreate`, and `subagent_type` into EVERY codex session's
 * injectedContext, because this machine's `~/.codex/rules` (the superseding
 * counterpart — see hooks/rules-injector/rules/sources.ts's doc comment on
 * existence-conditional supersede) has never been populated by a real `make
 * sync` run. That leak is genuine but has nothing to do with whether THIS
 * REPO's rewrite pipeline is correct — isolating HOME (isolated-codex-
 * home.ts) removes it as a confound instead of the probe silently inheriting
 * a red herring from whichever machine happens to run it.
 *
 * Three arms, selected via --arm:
 *   --arm=rewritten   rule deployed through the REAL codex rewrite pass
 *                      (materialize.ts, skipRewrite unset) + the rules-
 *                      injector hook registered — the GREEN arm. Expects
 *                      evaluateGatedAbsence to report "pass".
 *   --arm=unrewritten  rule deployed WITHOUT the rewrite pass (raw Claude
 *                      vocabulary survives) + hook registered — the RED arm
 *                      demonstrating the absence check's discriminating
 *                      power. Expects "fail" (a forbidden literal genuinely
 *                      leaked) -> exit 1 is the CORRECT/expected outcome.
 *   --arm=no-hook      rule deployed correctly (rewritten), but the isolated
 *                      CODEX_HOME registers NO hooks at all
 *                      (buildIsolatedCodexHome's `{}` case) — the RED arm
 *                      demonstrating the positive control's discriminating
 *                      power. Expects "positive-control-failed" -> exit 2 is
 *                      the CORRECT/expected outcome, never exit 0.
 *
 * Exit codes: 0 pass, 1 fail (measured, a forbidden literal leaked),
 * 2 unmeasurable — either a session-level failure (env/timeout/parse/auth)
 * or the positive control itself failing (rule content never reached the
 * model at all).
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { getCodexVersions } from "../../../lib/config.ts";
import { buildIsolatedCodexHome } from "../../isolated-codex-home.ts";
import type { HooksSpec, IsolatedCodexHome } from "../../isolated-codex-home.ts";
import { runSession } from "../../runner.ts";
import type { SessionConfig, UnmeasurableReason } from "../../types.ts";
import { RULE_NAME, writeSyntheticRuleSource } from "./fixture.ts";
import { evaluateGatedAbsence } from "./judgment.ts";
import { materializeCodexRule } from "./materialize.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const RULES_INJECTOR_CLI = path.join(REPO_ROOT, "hooks", "rules-injector", "cli.ts");

export type Arm = "rewritten" | "unrewritten" | "no-hook";

const OBJECTIVE =
	"Verify whether the file package.json exists at the repository root " +
	"(falsifiable via `test -f package.json`; report true or false). " +
	"Do not modify anything.";

/**
 * Pure spec builder — no I/O. `cwd` is the project scratch dir the caller
 * already materialized the rule into (via materializeCodexRule); `isolated`
 * is a caller-materialized HOME/CODEX_HOME pair.
 */
export function buildSessionConfig(cwd: string, isolated: IsolatedCodexHome): SessionConfig {
	return {
		prompt: OBJECTIVE,
		cwd,
		sandbox: "read-only",
		timeoutMs: 120_000,
		env: { HOME: isolated.home, CODEX_HOME: isolated.codexHome },
		// Sanctioned ONLY for this self-authored-hooks + fresh-CODEX_HOME
		// combination — see isolated-codex-home.ts's header comment.
		extraArgs: ["--dangerously-bypass-hook-trust"],
	};
}

export function parseArm(argv: readonly string[]): Arm {
	const flag = argv.find((a) => a.startsWith("--arm="));
	const value = flag?.slice("--arm=".length);
	if (value === "rewritten" || value === "unrewritten" || value === "no-hook") return value;
	throw new Error(`--arm must be one of rewritten|unrewritten|no-hook (got ${value ?? "<missing>"})`);
}

export type MainOptions = {
	/** Injectable scratch root, bypassing this function's own mkdtemp — hermetic tests only. @default a fresh mkdtemp under os.tmpdir(). */
	scratchRoot?: string;
	/** Injectable auth.json source, bypassing the real `~/.codex/auth.json` — hermetic tests only. */
	authSourcePath?: string;
	/** Injectable in place of the real runner.runSession — hermetic tests only. */
	runSessionFn?: typeof runSession;
	/** @default config.yaml's `codex-versions` allowlist */
	allowedVersions?: string[];
};

export async function main(arm: Arm, opts: MainOptions = {}): Promise<number> {
	const { scratchRoot: scratchRootOverride, authSourcePath, runSessionFn = runSession, allowedVersions: allowedVersionsOverride } = opts;
	const scratchRoot = scratchRootOverride ?? (await fs.mkdtemp(path.join(os.tmpdir(), "codex-probe-rules-runtime-leak-absence-")));
	const sourceRoot = path.join(scratchRoot, "source");
	const deployRoot = path.join(scratchRoot, "deploy");
	try {
		await writeSyntheticRuleSource(sourceRoot);
		await materializeCodexRule(sourceRoot, deployRoot, RULE_NAME, { skipRewrite: arm === "unrewritten" });

		const hooks: HooksSpec =
			arm === "no-hook" ? {} : { UserPromptSubmit: [{ command: `bun run ${RULES_INJECTOR_CLI} hook user-prompt-submit`, timeout: 10 }] };
		const isolated = await buildIsolatedCodexHome(scratchRoot, hooks, authSourcePath === undefined ? {} : { authSourcePath });

		const allowedVersions = allowedVersionsOverride ?? (await getCodexVersions());
		const result = await runSessionFn(buildSessionConfig(deployRoot, isolated), { allowedVersions, codexHome: isolated.codexHome });

		if (!result.ok) {
			const payload: { arm: Arm; exitCode: 2; reason: UnmeasurableReason; detail: string } = {
				arm,
				exitCode: 2,
				reason: result.reason,
				detail: result.detail,
			};
			process.stdout.write(JSON.stringify(payload) + "\n");
			return 2;
		}

		const verdict = evaluateGatedAbsence(result.observation);
		if (verdict.kind === "positive-control-failed") {
			process.stdout.write(
				JSON.stringify({ arm, exitCode: 2, reason: "positive-control-failed", detail: "rule sentinel never observed in injectedContext" }) + "\n",
			);
			return 2;
		}
		const exitCode = verdict.kind === "pass" ? 0 : 1;
		process.stdout.write(
			JSON.stringify({
				arm,
				exitCode,
				verdict: verdict.kind,
				leaked: verdict.kind === "fail" ? verdict.leaked : [],
				injectedContextLength: result.observation.injectedContext.length,
			}) + "\n",
		);
		return exitCode;
	} finally {
		await fs.rm(scratchRoot, { recursive: true, force: true });
	}
}

/**
 * Runs the process-boundary entry and returns the exit code — never throws.
 * Same shape as the sibling probes' runEntry: an invalid --arm= value or any
 * exception raised while running the probe (mkdtemp, materialize, auth copy,
 * spawn) is "the probe could not be measured", not "the probe measured a
 * negative" — so both map to exit 2, never bun's uncaught-throw exit 1.
 */
export async function runEntry(argv: readonly string[], opts: MainOptions = {}): Promise<number> {
	let arm: Arm;
	try {
		arm = parseArm(argv);
	} catch (err) {
		process.stderr.write(`codex-probe rules-runtime-leak-absence: ${err instanceof Error ? err.message : String(err)}\n`);
		return 2;
	}
	try {
		return await main(arm, opts);
	} catch (err) {
		process.stderr.write(`codex-probe rules-runtime-leak-absence: unmeasurable — ${err instanceof Error ? err.message : String(err)}\n`);
		return 2;
	}
}

if (import.meta.main) {
	const code = await runEntry(process.argv);
	process.exit(code);
}

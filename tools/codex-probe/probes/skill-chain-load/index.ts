#!/usr/bin/env bun
/**
 * skill-chain-load probe.
 *
 * SCOPE (narrowed — see REPORT for the incident this narrowing fixes):
 * answers ONLY "does a load trace exist" — spec AC line 70: does a real
 * codex session, given `$goal` at the user-input position, produce a tool
 * call that opens skills/sisyphus/SKILL.md at all. It does NOT, and cannot,
 * answer the CAUSAL question "does the `$sisyphus` sigil (vs. prose
 * `Skill(skill: "sisyphus")`) cause that open" — that question lives in
 * probes/skill-chain-cue-form, which isolates cue form with a synthetic
 * fixture free of the confounds real skill prose carries (goal's own body
 * and its references/*.md mention "sisyphus" in plain prose in several
 * places independent of rule 6a's rewrite, so a rewrite-applied/skipped
 * comparison on the REAL goal skill cannot isolate sigil-vs-prose as the
 * cause — both arms give the model the same non-sigil textual cues to
 * follow). This probe used to also expose a `--negative` control built on
 * exactly that confounded comparison; it rendered exit 0 on both arms
 * (no discriminating power) and has been removed rather than left to imply
 * a judgment this probe was never able to make.
 *
 * Builds on the existing harness (tools/codex-probe/{runner,evaluate,probe,
 * types}.ts) unmodified — this file only composes materializeCodexSkills +
 * skillChainJudgment + runProbe.
 *
 * Usage:
 *   bun run index.ts
 *
 * Exit codes (unchanged from probe.ts): 0 pass, 1 fail (measured, chain
 * never opened sisyphus/SKILL.md), 2 unmeasurable (env/timeout/parse).
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { runProbe } from "../../probe.ts";
import type { ProbeOptions, ProbeSpec } from "../../probe.ts";
import { buildIsolatedCodexHome } from "../../isolated-codex-home.ts";
import type { IsolatedCodexHome } from "../../isolated-codex-home.ts";
import { skillChainJudgment } from "./judgment.ts";
import { materializeCodexSkills } from "./materialize.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const CHAIN_SKILL = "goal";
const TARGET_SKILL = "sisyphus";

/**
 * Tiny but falsifiable objective — passes goal's Entry Gate (a machine-
 * checkable verification surface: `test -f`'s exit code) without asking the
 * model to perform real work. `-s read-only` (see buildProbeSpec) makes any
 * accidental write attempt a no-op at the sandbox layer, independent of
 * this prompt's own "do not modify anything" instruction.
 */
const OBJECTIVE =
	"Verify whether the file package.json exists at the repository root " +
	"(falsifiable via `test -f package.json`; report true or false). " +
	"Do not modify anything.";

/**
 * Pure spec builder — no I/O. `deployRoot` is the temp root a caller already
 * materialized skills into (via materializeCodexSkills); `isolated` is a
 * caller-materialized HOME/CODEX_HOME pair (via buildIsolatedCodexHome).
 * This function only shapes the ProbeSpec around them.
 *
 * CONFIRMED defect this closes (code-review): without HOME isolation, codex
 * ALSO loads home-scoped skills from the real `~/.agents/skills` alongside
 * the temp project copy. The predicate accepts any successful
 * `sisyphus/SKILL.md` read, so on a machine that already has sisyphus
 * installed home-scope it could pass by reading the AMBIENT skill without the
 * freshly materialized `deployRoot` bytes ever being loaded — a false green
 * that makes this probe's primary deployment-behavior experiment
 * machine-dependent. (Concrete trigger, not a hypothetical: this machine's
 * `~/.agents/skills` already carries discovery-oriented skills, and root
 * sync.yaml deploys goal/ultragoal there.) Isolating HOME/CODEX_HOME is the
 * same measure probes/ultrawork-keyword-injection and
 * probes/rules-runtime-leak-absence already take.
 */
export function buildProbeSpec(deployRoot: string, isolated: IsolatedCodexHome): ProbeSpec {
	return {
		session: {
			// `$goal` MUST lead the user-input prompt: a user-position `$X` is
			// mechanically loaded by codex's mention scanner (verified fact,
			// see this repo's parity spec) — a body-position mention is not.
			prompt: `$goal ${OBJECTIVE}`,
			cwd: deployRoot,
			sandbox: "read-only",
			// Generous but finite: goal's Entry Gate + Six-Slot decomposition is a
			// generative multi-step task, not a one-shot reply — but probe.ts's
			// timeout still guarantees exit 2 rather than hanging forever.
			timeoutMs: 300_000,
			env: { HOME: isolated.home, CODEX_HOME: isolated.codexHome },
			// No extraArgs: this probe registers NO hooks, so buildIsolatedCodexHome
			// writes no hooks.json and there is no untrusted-hooks gate to bypass.
			// `--dangerously-bypass-hook-trust` stays confined to the probes that
			// actually self-author hooks.
		},
		judgment: skillChainJudgment(TARGET_SKILL),
		codexHome: isolated.codexHome,
	};
}

export type MainOptions = ProbeOptions & {
	/**
	 * Injectable deploy root, bypassing this function's own mkdtemp — hermetic
	 * tests only (e.g. a pre-made unwritable directory, to exercise the
	 * materialize-failure path without a real codex spawn). @default a fresh
	 * mkdtemp under os.tmpdir().
	 */
	deployRoot?: string;
	/**
	 * Injectable `auth.json` source for buildIsolatedCodexHome — hermetic tests
	 * only. @default `~/.codex/auth.json` (the real credential this probe's
	 * isolated CODEX_HOME needs to authenticate a session). Tests MUST inject a
	 * fixture: reading the developer's real auth.json would reintroduce exactly
	 * the machine-dependence this isolation exists to remove.
	 */
	authSourcePath?: string;
};

export async function main(opts: MainOptions = {}): Promise<number> {
	const { deployRoot: deployRootOverride, authSourcePath, ...probeOpts } = opts;
	const deployRoot = deployRootOverride ?? (await fs.mkdtemp(path.join(os.tmpdir(), "codex-probe-skill-chain-load-")));
	// Deliberately a SIBLING of deployRoot, never inside it: deployRoot is the
	// session's cwd, and an isolated `home/` sitting in it would show up as
	// project content to the very model under observation.
	const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-probe-skill-chain-load-home-"));
	try {
		await materializeCodexSkills(REPO_ROOT, deployRoot, [CHAIN_SKILL, TARGET_SKILL]);
		const isolated = await buildIsolatedCodexHome(homeRoot, {}, authSourcePath === undefined ? {} : { authSourcePath });

		const outcome = await runProbe(buildProbeSpec(deployRoot, isolated), probeOpts);

		if (outcome.exitCode === 2) {
			process.stdout.write(JSON.stringify({ exitCode: 2, reason: outcome.reason, detail: outcome.detail }) + "\n");
		} else {
			process.stdout.write(
				JSON.stringify({
					exitCode: outcome.exitCode,
					toolCallCount: outcome.observation.toolCalls.length,
					toolCommands: outcome.observation.toolCalls.map((c) => c.item.command).filter((c) => typeof c === "string"),
					finalMessage: outcome.observation.finalMessage,
				}) + "\n",
			);
		}
		return outcome.exitCode;
	} finally {
		await fs.rm(deployRoot, { recursive: true, force: true });
		await fs.rm(homeRoot, { recursive: true, force: true });
	}
}

/**
 * Runs the process-boundary entry and returns the exit code — never throws.
 * Same shape as cli.ts's runCli: any exception raised while running the
 * probe (mkdtemp, materialize, spawn) is "the probe could not be measured",
 * not "the probe measured a negative" — so it maps to exit 2, not the
 * uncaught-throw exit 1 bun would otherwise produce.
 */
export async function runEntry(opts: MainOptions = {}): Promise<number> {
	try {
		return await main(opts);
	} catch (err) {
		process.stderr.write(`codex-probe skill-chain-load: unmeasurable — ${err instanceof Error ? err.message : String(err)}\n`);
		return 2;
	}
}

if (import.meta.main) {
	const code = await runEntry();
	process.exit(code);
}

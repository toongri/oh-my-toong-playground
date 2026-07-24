#!/usr/bin/env bun
/**
 * skill-chain-cue-form probe.
 *
 * Answers the CAUSAL question skill-chain-load cannot: does a body-position
 * `$beta` sigil (rule 6a's rewrite target) cause the model to open a
 * sub-skill more than body-position prose `Skill(skill: "beta")` does — or
 * does the model open it regardless of cue form (the "removed" arm also
 * opening it would mean this too), which would mean the sigil-vs-prose
 * causal claim is false rather than merely unproven?
 *
 * skill-chain-load could not answer this: its own `--negative` control
 * compared the REAL goal skill with/without the rewrite pass, but goal's
 * body and its references/*.md mention "sisyphus" in plain prose in several
 * places independent of rule 6a — so both arms handed the model the same
 * non-sigil textual cues, and both rendered exit 0. This probe isolates cue
 * form with a synthetic alpha (chain) / beta (target) fixture (fixture.ts)
 * that never repeats the target's name anywhere except the one dispatch
 * spot, plus gamma/delta decoys never named anywhere, to also surface a
 * third possible cause: the model sweeping every discovered skill dir
 * regardless of whether it was told to (see judgment.ts's decoysOpened —
 * reported separately, never gating pass/fail).
 *
 * Four arms, selected via --arm:
 *   --arm=sigil    dispatch line becomes `$beta` (rule 6a rewrite applied)
 *   --arm=prose    dispatch line stays literal `Skill(skill: "beta")` (rewrite skipped for alpha — Claude's own unrewritten source form)
 *   --arm=oldprose dispatch line is `the beta skill` — the OLD rule 6a's actual output (replace: "the $1 skill",
 *                  in force before commit ba36eb7b), derived by applying that legacy rule locally in fixture.ts,
 *                  not hand-typed. This is the exact form the parity spec's claim about "구 규칙 6a의 산문화" refers
 *                  to — `prose` above is NOT that form, since it never went through any 6a rewrite at all.
 *   --arm=removed  no reference to beta anywhere in alpha's fixture — the discriminating control;
 *                  if this ALSO opens beta/SKILL.md, the probe cannot attribute an open to cue form at all (report as such, do not adjust the probe to pass).
 *
 * Materialization reuses materializeCodexSkills (skill-chain-load/materialize.ts)
 * unmodified — the SAME rewrite pipeline `make sync` runs for real skills,
 * pointed at this probe's own synthetic fixture root instead of skills/.
 *
 * Judgment: cueFormJudgment (judgment.ts) — a tool call naming
 * beta/SKILL.md AND the sentinel planted in beta's body appearing in the
 * model's final reply. "Opened" alone is not enough.
 *
 * Exit codes (unchanged from probe.ts): 0 pass, 1 fail, 2 unmeasurable.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";

import { runProbe } from "../../probe.ts";
import type { ProbeOptions, ProbeSpec } from "../../probe.ts";
import { buildIsolatedCodexHome } from "../../isolated-codex-home.ts";
import type { IsolatedCodexHome } from "../../isolated-codex-home.ts";
import { materializeCodexSkills } from "../skill-chain-load/materialize.ts";
import type { Arm } from "./fixture.ts";
import { DECOY_NAMES, writeSyntheticFixture } from "./fixture.ts";
import { cueFormJudgment, decoysOpened, invertedCueFormJudgment } from "./judgment.ts";

export type { Arm };

const OBJECTIVE =
	"Verify whether the file package.json exists at the repository root " +
	"(falsifiable via `test -f package.json`; report true or false). " +
	"Do not modify anything.";

/**
 * Pure spec builder — no I/O. `deployRoot` is the temp root a caller already
 * materialized the fixture into (via materializeCodexSkills over
 * writeSyntheticFixture's output).
 *
 * Judgment is arm-dependent (CONFIRMED-defect fix): "sigil"/"prose" are the
 * arms hypothesized to actually cause beta to open, so they keep the
 * positive predicate. "removed"/"oldprose" are negative controls — alpha's
 * fixture gives the model no reliable cue to open beta, so passing means
 * beta stayed CLOSED; an open there means the control failed to discriminate
 * cue form at all (see this file's header comment on the four arms), which
 * must render exit 1, not exit 0.
 *
 * `isolated` is a caller-materialized HOME/CODEX_HOME pair (via
 * buildIsolatedCodexHome), for the same reason skill-chain-load isolates —
 * with one difference worth naming, since this probe's synthetic names
 * (alpha/beta/decoys) make a NAME collision with an ambient home skill
 * structurally impossible. The confound here is BEHAVIORAL, not nominal: an
 * un-isolated session still loads this machine's home-scoped skills and
 * rules, and `~/.agents/skills` already carries discovery-oriented skills
 * (`find-skills`, `orchestration`) whose whole purpose is to make a model
 * sweep available skill dirs. A sweep opens beta regardless of cue form,
 * which is precisely the failure the "removed"/"oldprose" negative-control
 * arms exist to detect — so ambient influence would destroy this probe's
 * discriminating power rather than merely add noise.
 */
export function buildProbeSpec(deployRoot: string, arm: Arm, isolated: IsolatedCodexHome): ProbeSpec {
	return {
		session: {
			// `$alpha` MUST lead the user-input prompt — same mechanical-load
			// reasoning as skill-chain-load's `$goal` (a user-position `$X` is
			// machine-loaded by codex's mention scanner).
			prompt: `$alpha ${OBJECTIVE}`,
			cwd: deployRoot,
			sandbox: "read-only",
			// alpha is a one-hop synthetic dispatch, not goal's Six-Slot
			// decomposition — a short but still generous timeout.
			timeoutMs: 120_000,
			env: { HOME: isolated.home, CODEX_HOME: isolated.codexHome },
			// No extraArgs: no hooks are registered, so no hooks.json is written
			// and there is no untrusted-hooks gate to bypass.
		},
		judgment: arm === "removed" || arm === "oldprose" ? invertedCueFormJudgment() : cueFormJudgment(),
		codexHome: isolated.codexHome,
	};
}

export function parseArm(argv: readonly string[]): Arm {
	const flag = argv.find((a) => a.startsWith("--arm="));
	const value = flag?.slice("--arm=".length);
	if (value === "sigil" || value === "prose" || value === "removed" || value === "oldprose") return value;
	throw new Error(`--arm must be one of sigil|prose|removed|oldprose (got ${value ?? "<missing>"})`);
}

export type MainOptions = ProbeOptions & {
	/**
	 * Injectable scratch root, bypassing this function's own mkdtemp —
	 * hermetic tests only (e.g. a pre-made unwritable directory, to exercise
	 * the fixture-write-failure path without a real codex spawn). @default a
	 * fresh mkdtemp under os.tmpdir().
	 */
	scratchRoot?: string;
	/**
	 * Injectable `auth.json` source for buildIsolatedCodexHome — hermetic tests
	 * only. @default `~/.codex/auth.json`. Tests MUST inject a fixture; reading
	 * the developer's real credential would reintroduce the machine-dependence
	 * this isolation removes.
	 */
	authSourcePath?: string;
};

export async function main(arm: Arm, opts: MainOptions = {}): Promise<number> {
	const { scratchRoot: scratchRootOverride, authSourcePath, ...probeOpts } = opts;
	const scratchRoot = scratchRootOverride ?? (await fs.mkdtemp(path.join(os.tmpdir(), "codex-probe-skill-chain-cue-form-")));
	const fixtureRoot = path.join(scratchRoot, "fixture");
	// buildIsolatedCodexHome puts its HOME at `<scratchRoot>/home` — a SIBLING of
	// deploy/, never inside it, so the isolated home never appears as project
	// content in the session's cwd.
	const deployRoot = path.join(scratchRoot, "deploy");
	try {
		await writeSyntheticFixture(fixtureRoot, arm);
		// The "sigil" arm runs the full rewrite pass (rule 6a converts alpha's
		// literal `Skill(skill: "beta")` to `$beta`); "prose", "oldprose", and
		// "removed" all skip rewriting alpha so its content survives verbatim —
		// for "oldprose" and "removed" this is a no-op since neither body
		// contains a live `Skill(...)` call for rule 6a to match.
		const skipRewrite = arm === "sigil" ? undefined : new Set(["alpha"]);
		await materializeCodexSkills(fixtureRoot, deployRoot, ["alpha", "beta", ...DECOY_NAMES], { skipRewrite });
		const isolated = await buildIsolatedCodexHome(scratchRoot, {}, authSourcePath === undefined ? {} : { authSourcePath });

		const outcome = await runProbe(buildProbeSpec(deployRoot, arm, isolated), probeOpts);

		if (outcome.exitCode === 2) {
			process.stdout.write(JSON.stringify({ arm, exitCode: 2, reason: outcome.reason, detail: outcome.detail }) + "\n");
		} else {
			process.stdout.write(
				JSON.stringify({
					arm,
					exitCode: outcome.exitCode,
					toolCallCount: outcome.observation.toolCalls.length,
					toolCommands: outcome.observation.toolCalls.map((c) => c.item.command).filter((c) => typeof c === "string"),
					finalMessage: outcome.observation.finalMessage,
					decoysOpened: decoysOpened(outcome.observation, DECOY_NAMES),
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
 * Same shape as cli.ts's runCli: an invalid `--arm=` value (a parseArm
 * throw) or any exception raised while running the probe (fixture write,
 * materialize, spawn) is "the probe could not be measured", not "the probe
 * measured a negative" — so both map to exit 2, not the uncaught-throw exit
 * 1 bun would otherwise produce.
 */
export async function runEntry(argv: readonly string[], opts: MainOptions = {}): Promise<number> {
	let arm: Arm;
	try {
		arm = parseArm(argv);
	} catch (err) {
		process.stderr.write(`codex-probe skill-chain-cue-form: ${err instanceof Error ? err.message : String(err)}\n`);
		return 2;
	}
	try {
		return await main(arm, opts);
	} catch (err) {
		process.stderr.write(`codex-probe skill-chain-cue-form: unmeasurable — ${err instanceof Error ? err.message : String(err)}\n`);
		return 2;
	}
}

if (import.meta.main) {
	const code = await runEntry(process.argv);
	process.exit(code);
}

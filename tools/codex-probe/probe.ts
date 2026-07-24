/**
 * Probe orchestration — composes the session runner and the judgment
 * evaluator into the exit-code trichotomy (plan AC3):
 *   0 = pass, 1 = fail (measured, judgment false), 2 = unmeasurable.
 *
 * Also owns the retry policy (plan AC4): retry ONLY on an unmeasurable
 * outcome, never on a measured failure. Retrying a measured failure would
 * let a real behavioral regression masquerade as flake and silently pass on
 * a later attempt — the exact failure mode a probe harness exists to catch.
 * Flake tolerance is opt-in per caller via `attempts`; the default is a
 * strict single try.
 */

import { getCodexVersions } from "../lib/config.ts";
import { evaluateJudgmentVerdict } from "./evaluate.ts";
import { runSession } from "./runner.ts";
import type { Judgment, Observation, RunResult, SessionConfig, UnmeasurableReason } from "./types.ts";

export type ProbeSpec = {
	session: SessionConfig;
	judgment: Judgment;
	/** @default config.yaml's `codex-versions` allowlist */
	allowedVersions?: string[];
	/** @default `${os.homedir()}/.codex` — see runner.ts's RunnerOptions. */
	codexHome?: string;
};

export type ProbeOptions = {
	/** Max attempts, retrying only on an unmeasurable result. @default 1 */
	attempts?: number;
	/** Injectable in place of the real runner.runSession — hermetic retry-policy tests. */
	runSessionFn?: typeof runSession;
};

export type ProbeOutcome =
	| { exitCode: 0; observation: Observation }
	| { exitCode: 1; observation: Observation }
	| { exitCode: 2; reason: UnmeasurableReason; detail: string };

export async function runProbe(spec: ProbeSpec, opts: ProbeOptions = {}): Promise<ProbeOutcome> {
	const attempts = Math.max(1, opts.attempts ?? 1);
	const runSessionFn = opts.runSessionFn ?? runSession;
	const allowedVersions = spec.allowedVersions ?? (await getCodexVersions());

	let last: RunResult | null = null;
	for (let attempt = 0; attempt < attempts; attempt++) {
		last = await runSessionFn(spec.session, { allowedVersions, codexHome: spec.codexHome });
		if (last.ok) break; // measured (pass or fail) — never retry, see header comment
	}
	// unreachable: attempts is clamped to >= 1, so the loop above always runs.
	if (last === null) throw new Error("runProbe: attempts loop produced no result");

	if (!last.ok) {
		return { exitCode: 2, reason: last.reason, detail: last.detail };
	}

	// evaluateJudgmentVerdict (not the plain boolean evaluateJudgment): an
	// `absent` judgment carrying `positiveControl` can itself be unmeasurable
	// — its gate never observed anything — and that must map to exit 2, never
	// a vacuous exit 0 (see evaluate.ts's evaluateJudgmentVerdict doc).
	const verdict = evaluateJudgmentVerdict(last.observation, spec.judgment);
	if (verdict === "unmeasurable") {
		return {
			exitCode: 2,
			reason: "judgment-unmeasurable",
			detail: "the absent judgment's positive control was never observed in scope — nothing was measured about the literals under test",
		};
	}
	return verdict === "pass" ? { exitCode: 0, observation: last.observation } : { exitCode: 1, observation: last.observation };
}

/**
 * Validates the installed Codex CLI version against an admitted allowlist.
 *
 * Codex auto-upgrades unpredictably (observed 0.142.5 -> 0.143.0 -> 0.144.1
 * mid-project), so sync admits a SET of probe-verified versions
 * (config.yaml `codex-versions`) rather than a single pin — a lone pin would
 * break every `make sync` on the next silent upgrade.
 */

const VERSION_PATTERN = /\d+\.\d+\.\d+/;

/**
 * Extract a `major.minor.patch` version string from `codex --version` output
 * (e.g. "codex-cli 0.144.1" -> "0.144.1"). Returns null when no
 * version-shaped substring is present.
 */
export function parseCodexVersion(raw: string): string | null {
	const match = raw.match(VERSION_PATTERN);
	return match ? match[0] : null;
}

/**
 * Throw when `observed` is not a member of `allowed`. The error message
 * names both the observed version and the full allowed set, so a failing
 * sync tells the operator exactly what to probe-verify and add to
 * config.yaml's `codex-versions`.
 */
export function assertCodexVersionAllowed(observed: string, allowed: string[]): void {
	if (allowed.includes(observed)) return;
	throw new Error(
		`Codex CLI version ${observed} is not in the validated allowlist [${allowed.join(", ")}]. ` +
			`Probe-verify the new version and add it to config.yaml's codex-versions before syncing.`,
	);
}

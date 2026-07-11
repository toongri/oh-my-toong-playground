import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { writeErrorBreadcrumb } from "./debug-log.js";

/**
 * Hydrates `env` with knobs from the module-local two-tier config read from
 * this module's own directory:
 *   config.yaml       — committed shared base
 *   config.local.yaml — gitignored per-machine override (local wins over base)
 * so `configFromEnvironment` (config.ts) consumes them as "just another env
 * provider". A present real env var (canonical CODEX_RULES_ or legacy PI_RULES_
 * alias) always wins over yaml (12-factor); see the merge below.
 *
 * Never throws. Absent/unreadable file = NORMAL state (silent no-op, no
 * breadcrumb — mirrors isOffFilePresentSync in config.ts). A present-but-broken
 * file (malformed YAML / wrong-typed value) is diagnosable: non-fatal
 * breadcrumb. Either way degrades to returning env effectively unchanged — the
 * hook's exit-0 guarantee depends on it.
 */
export function hydrateEnvFromLocalConfig(
	env: NodeJS.ProcessEnv,
	configDir: string = resolveConfigDir(env),
): NodeJS.ProcessEnv {
	const base = readYamlObject(join(configDir, "config.yaml"));
	const local = readYamlObject(join(configDir, "config.local.yaml"));
	const merged = { ...base, ...local }; // config.local.yaml overrides config.yaml

	const yamlEnv: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(merged)) {
		const canonicalKey = `CODEX_RULES_${toScreamingSnakeCase(key)}`;
		const legacyKey = `PI_RULES_${toScreamingSnakeCase(key)}`;
		// A present real env var under EITHER alias wins over yaml (12-factor).
		// "Present" mirrors firstEnv (config.ts): blank/whitespace-only = absent.
		if (isPresent(env[canonicalKey]) || isPresent(env[legacyKey])) {
			continue;
		}
		try {
			yamlEnv[canonicalKey] = serializeValue(key, value);
		} catch (error) {
			// wrong-typed value (e.g. `exclude: 42`): breadcrumb, drop this key only.
			writeErrorBreadcrumb("local-config", error);
		}
	}

	// yamlEnv holds only keys with no present real override, so overlaying it
	// onto env can't clobber a present real var under either alias — and a
	// *blank* real canonical var no longer survives the merge to shadow yaml.
	return { ...env, ...yamlEnv };
}

// Config dir defaults to this module's own directory (config.yaml ships beside
// the deployed hook), overridable via CODEX_RULES_CONFIG_DIR — the hermetic-test
// seam, mirroring plugin-root.ts's PLUGIN_ROOT override.
function resolveConfigDir(env: NodeJS.ProcessEnv): string {
	const override = env["CODEX_RULES_CONFIG_DIR"];
	if (typeof override === "string" && override.trim().length > 0) {
		return override;
	}
	return fileURLToPath(new URL(".", import.meta.url));
}

// Reads + parses one yaml file into a plain object. Absent/unreadable = {}
// silently (the normal state). Present-but-malformed = breadcrumb + {}. A valid
// non-mapping document (scalar/array/null) = {} (nothing to hydrate).
function readYamlObject(path: string): Record<string, unknown> {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return {};
	}
	try {
		const parsed: unknown = parseYaml(raw);
		if (isRecord(parsed)) {
			return parsed;
		}
		return {};
	} catch (error) {
		writeErrorBreadcrumb("local-config", error);
		return {};
	}
}

// Generic transform: array -> comma-join; EXCEPT `exclude` -> newline-join (so
// brace-comma globs like `**/*.{spec,test}.md` survive). `exclude` also
// accepts a bare scalar string (a single glob, not a `- <glob>` list),
// applied as-is. Any other type (number, boolean, object, ...) — including a
// non-string element inside the array (e.g. `- 42`) — is a genuinely
// wrong-typed `exclude`: throw so the caller's try/catch breadcrumbs it and
// drops the value, rather than silently coercing it into a bogus glob.
function serializeValue(key: string, value: unknown): string {
	if (key === "exclude") {
		if (typeof value === "string") {
			return value;
		}
		if (Array.isArray(value)) {
			const badTypes = value.filter((v) => typeof v !== "string").map((v) => typeof v);
			if (badTypes.length > 0) {
				throw new TypeError(`exclude array must contain only strings, got ${badTypes.join(", ")}`);
			}
			return value.join("\n");
		}
		throw new TypeError(`exclude must be a string or string[], got ${typeof value}`);
	}
	if (Array.isArray(value)) {
		return value.join(",");
	}
	return String(value);
}

function toScreamingSnakeCase(key: string): string {
	return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

// Mirrors `firstEnv`'s present-definition (config.ts) exactly, so the
// skip-guard above and the consumer agree on what counts as "present".
function isPresent(value: string | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

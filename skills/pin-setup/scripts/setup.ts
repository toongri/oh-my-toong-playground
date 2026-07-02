#!/usr/bin/env bun
/**
 * pin-setup: write pins.yaml into the fixed pins home, then migrate legacy pins.
 *
 * Usage:
 *   bun setup.ts [--location <abs-path>] --scope <private|shared> [--git <true|false>]
 *
 * Argv-driven and non-interactive. The AI skill gathers values via interview,
 * then invokes this script. This is the ONLY script that creates pins.yaml —
 * it does NOT call resolveManifest (D3 exception: setup writes, not reads).
 *
 * Fixed pointer, flexible data: the manifest FILE always lives at
 * resolvePinsHome()/pins.yaml. Only the manifest's `location` FIELD (the data
 * dir) takes a --location override; when omitted it defaults to resolvePinsHome()
 * (co-located). D8 write-safety: migrate() receives exactly the location written
 * to pins.yaml, never an inferred cwd path.
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { migrate } from "@lib/pins/migrate";
import { failEngine } from "@lib/pin-cli/io";
import { resolvePinsHome } from "@lib/omt-dir";

// ── Argv parsing ──────────────────────────────────────────────────────────────

function parseArgs(): { location: string | null; scope: string; git: boolean | null } {
	const args = process.argv.slice(2);
	let location: string | null = null;
	let scope: string | null = null;
	let git: boolean | null = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--location" && args[i + 1]) {
			location = args[++i];
		} else if (args[i] === "--scope" && args[i + 1]) {
			scope = args[++i];
		} else if (args[i] === "--git" && args[i + 1]) {
			const val = args[++i];
			git = val === "true";
		}
	}

	if (!scope || (scope !== "private" && scope !== "shared")) {
		process.stderr.write('[pin-setup] --scope must be "private" or "shared"\n');
		process.exit(1);
	}

	return { location, scope, git };
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
	const { location, scope, git } = parseArgs();

	// The data directory: explicit --location or co-located with the manifest home.
	const dataLocation = location ?? resolvePinsHome();

	// The manifest FILE always lives at the fixed pins home.
	const pinsHome = resolvePinsHome();
	mkdirSync(pinsHome, { recursive: true });
	const manifestPath = join(pinsHome, "pins.yaml");

	const manifestObj: Record<string, unknown> = { location: dataLocation, scope };
	if (git !== null) manifestObj.git = git;
	const manifest = `# pins.yaml — knowledge graph storage manifest\n${Bun.YAML.stringify(manifestObj, null, 2)}`;

	writeFileSync(manifestPath, manifest, "utf8");
	process.stdout.write(`[pin-setup] manifest created: ${manifestPath}\n`);

	// Migrate legacy pins at the just-written location (D8: exact same value).
	// C6: skip migrate when location does not yet exist — first record() call creates it.
	try {
		if (existsSync(dataLocation)) {
			await migrate({ location: dataLocation });
		}
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		failEngine(`migrate failed: ${detail}`);
	}

	process.stdout.write(`[pin-setup] migration complete: ${dataLocation}\n`);
}

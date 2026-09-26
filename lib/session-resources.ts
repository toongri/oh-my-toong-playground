/**
 * Session resource registry: background resources a skill started (emulators,
 * simulators, dev servers) and the command that stops each one.
 *
 * qa and ultragoal share one file per session, so a resource started under
 * either skill blocks completion of both until it is released. Release runs
 * the recorded stop command and records the release only when it exits 0 —
 * a claim "I stopped it" is never enough.
 *
 * State file: ${OMT_DIR}/session-resources-${sessionId}.json
 */

import { closeSync, existsSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOmtDir } from "@lib/omt-dir";
import { withStateLock } from "@lib/persistent-mode-core/state-lock";

export interface SessionResource {
	id: string;
	kind: string;
	/** Shell command that stops this resource; run by releaseResource. */
	stop: string;
	recorded_at: string;
	/** Set only after the stop command exited 0. */
	released_at?: string;
}

const STOP_TIMEOUT_MS = 120_000;

export function resolveResourcesPath(sessionId: string): string {
	return `${getOmtDir()}/session-resources-${sessionId}.json`;
}

/** Fail-closed read: an absent or corrupt file reads as no resources. */
function readAll(path: string): SessionResource[] {
	if (!existsSync(path)) return [];
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeAll(path: string, resources: SessionResource[]): void {
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(resources, null, 2));
	renameSync(tmp, path);
}

/**
 * Records a resource this run started. Re-recording an id replaces the entry
 * and marks it unreleased again (the resource was restarted).
 */
export function recordResource(sessionId: string, input: { id: string; kind: string; stop: string }): void {
	for (const [flag, value] of Object.entries(input)) {
		if (value.trim() === "") throw new Error(`record-resource: refused — --${flag} is required`);
	}
	const path = resolveResourcesPath(sessionId);
	withStateLock(path, () => {
		const next = readAll(path).filter((r) => r.id !== input.id);
		next.push({ ...input, recorded_at: new Date().toISOString() });
		writeAll(path, next);
	});
}

/**
 * Runs the recorded stop command and marks the resource released only when it
 * exits 0. Throws with the command's output otherwise; the entry stays
 * unreleased so the completion gate keeps blocking.
 */
export function releaseResource(sessionId: string, id: string): SessionResource {
	const path = resolveResourcesPath(sessionId);
	return withStateLock(path, () => {
		const all = readAll(path);
		const target = all.find((r) => r.id === id);
		if (!target) throw new Error(`release-resource: refused — no recorded resource with id "${id}"`);
		if (target.released_at) return target;
		const run = spawnSync("bash", ["-c", target.stop], { encoding: "utf8", timeout: STOP_TIMEOUT_MS });
		if (run.status !== 0) {
			const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim() || String(run.error ?? "no output");
			throw new Error(
				`release-resource: stop command for "${id}" failed (exit ${String(run.status)}); the resource stays unreleased.\n` +
					`  command: ${target.stop}\n  output: ${out}\n` +
					"Fix the stop command or stop the resource another way, then re-record it with a working --stop and release again.",
			);
		}
		target.released_at = new Date().toISOString();
		writeAll(path, all);
		return target;
	});
}

export function unreleasedResources(sessionId: string): SessionResource[] {
	return readAll(resolveResourcesPath(sessionId)).filter((r) => !r.released_at);
}

/**
 * Completion-gate refusal body naming every unreleased resource and the exact
 * command that releases it; empty string when nothing is left running.
 */
export function unreleasedResourcesRefusal(sessionId: string, cliName: string): string {
	const open = unreleasedResources(sessionId);
	if (open.length === 0) return "";
	const lines = open.map((r) => `  - ${r.kind} "${r.id}": ${cliName} release-resource --id ${r.id}`);
	return (
		`refused — ${open.length} background resource(s) started in this session are still running. ` +
		`Release each one (it runs the recorded stop command), then retry:\n${lines.join("\n")}`
	);
}

export type DevicePlatform = "ios" | "android";

/** Process seams acquireDevice drives; tests replace them. */
export interface DeviceDeps {
	run(cmd: string, args: string[]): { status: number | null; stdout: string; stderr: string };
	launchDetached(cmd: string, args: string[], logPath: string): void;
	sleep(ms: number): void;
}

const BOOT_TIMEOUT_MS = 300_000;
// Console ports inside the emulator's recommended range; the serial is emulator-<port>.
const EMULATOR_PORTS = Array.from({ length: 16 }, (_, i) => 5554 + i * 2);

const systemDeps: DeviceDeps = {
	run(cmd, args) {
		const r = spawnSync(cmd, args, { encoding: "utf8", timeout: BOOT_TIMEOUT_MS });
		return { status: r.status, stdout: r.stdout ?? "", stderr: `${r.stderr ?? ""}${r.error ? String(r.error) : ""}` };
	},
	launchDetached(cmd, args, logPath) {
		const fd = openSync(logPath, "a");
		spawn(cmd, args, { detached: true, stdio: ["ignore", fd, fd] }).unref();
		closeSync(fd);
	},
	sleep(ms) {
		spawnSync("sleep", [String(ms / 1000)]);
	},
};

function androidTool(sub: string, name: string): string {
	const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
	const candidate = sdk ? join(sdk, sub, name) : "";
	return candidate !== "" && existsSync(candidate) ? candidate : name;
}

function failed(step: string, r: { status: number | null; stdout: string; stderr: string }): Error {
	return new Error(`acquire-device: ${step} failed (exit ${String(r.status)}): ${`${r.stderr}${r.stdout}`.trim()}`);
}

/**
 * Starts a device owned by this session and records it before waiting for boot,
 * so a boot failure still leaves a recorded resource the completion gate sees.
 *
 * Ownership lives on the device, not in a before/after comparison, so
 * concurrent sessions never claim or stop each other's devices:
 * - iOS: a fresh simulator named omt-<session>-<n>; stop shuts it down and deletes it.
 * - Android: a -read-only instance of the AVD whose host process carries
 *   `-prop qemu.omt.session=<session>` in argv (the guest drops custom props on
 *   current images, the host argv keeps it); stop kills the emulator only when
 *   a process with that port and tag still exists.
 *
 * Returns the UDID (iOS) or serial (Android).
 */
export function acquireDevice(
	sessionId: string,
	req: { platform: string; base: string; runtime?: string },
	deps: DeviceDeps = systemDeps,
): string {
	if (req.platform !== "ios" && req.platform !== "android") {
		throw new Error(`acquire-device: refused — --platform must be ios or android, got "${req.platform}"`);
	}
	if (req.base.trim() === "") {
		throw new Error("acquire-device: refused — --base is required (iOS: device type such as \"iPhone 17 Pro\"; Android: AVD name from `emulator -list-avds`)");
	}
	const n = readAll(resolveResourcesPath(sessionId)).length + 1;

	if (req.platform === "ios") {
		const created = deps.run("xcrun", ["simctl", "create", `omt-${sessionId}-${n}`, req.base, ...(req.runtime ? [req.runtime] : [])]);
		if (created.status !== 0) throw failed("xcrun simctl create", created);
		const udid = created.stdout.trim();
		recordResource(sessionId, {
			id: udid,
			kind: "simulator",
			stop: `xcrun simctl shutdown ${udid} >/dev/null 2>&1; xcrun simctl delete ${udid} 2>/dev/null || ! xcrun simctl list devices | grep -q ${udid}`,
		});
		const booted = deps.run("xcrun", ["simctl", "bootstatus", udid, "-b"]);
		if (booted.status !== 0) throw failed(`boot of recorded simulator ${udid} (release it with release-resource)`, booted);
		return udid;
	}

	const adb = androidTool("platform-tools", "adb");
	const listed = deps.run(adb, ["devices"]);
	if (listed.status !== 0) throw failed("adb devices", listed);
	const used = new Set([...listed.stdout.matchAll(/emulator-(\d+)/g)].map((m) => Number(m[1])));
	const port = EMULATOR_PORTS.find((p) => !used.has(p));
	if (port === undefined) throw new Error("acquire-device: refused — every emulator console port 5554-5584 is in use");
	// lazy: two sessions picking the same free port in the same instant collide;
	// the loser's emulator exits, its boot wait fails loud, and its ownership-checked
	// stop is a no-op. Add a cross-session port lock if that shows up in practice.
	const serial = `emulator-${port}`;
	const tag = `qemu.omt.session=${sessionId}`;
	deps.launchDetached(
		androidTool("emulator", "emulator"),
		["-avd", req.base, "-read-only", "-no-boot-anim", "-port", String(port), "-prop", tag],
		join(tmpdir(), `omt-${serial}-${sessionId}.log`),
	);
	// `[-]port` keeps pgrep from matching this bash -c command line itself.
	recordResource(sessionId, {
		id: serial,
		kind: "emulator",
		stop: `if pgrep -f '[-]port ${port} -prop ${tag}' >/dev/null; then '${adb}' -s ${serial} emu kill; fi`,
	});
	const deadline = Date.now() + BOOT_TIMEOUT_MS;
	while (deps.run(adb, ["-s", serial, "shell", "getprop", "sys.boot_completed"]).stdout.trim() !== "1") {
		if (Date.now() > deadline) {
			throw new Error(`acquire-device: recorded emulator ${serial} did not finish booting in ${BOOT_TIMEOUT_MS / 1000}s; release it with release-resource`);
		}
		deps.sleep(3_000);
	}
	return serial;
}

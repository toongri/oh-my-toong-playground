import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { evaluateProgress } from "./progress.ts";
import { readUltragoalStateRaw } from "./state.ts";

const root = join(tmpdir(), `progress-fingerprint-${Date.now()}`);
const run = (cwd: string, args: string[]) => Bun.spawnSync(["git", ...args], { cwd }).exitCode;
const out = (cwd: string, args: string[]) =>
	Bun.spawnSync(["git", ...args], { cwd })
		.stdout.toString()
		.trim();

async function repo(name: string) {
	const cwd = join(root, name);
	await mkdir(cwd, { recursive: true });
	run(cwd, ["init", "-q"]);
	run(cwd, ["config", "user.email", "test@example.com"]);
	run(cwd, ["config", "user.name", "Test"]);
	return cwd;
}

async function commit(cwd: string, file: string, value: string) {
	await writeFile(join(cwd, file), value);
	run(cwd, ["add", file]);
	run(cwd, ["commit", "-qm", value]);
	return out(cwd, ["rev-parse", "HEAD"]);
}

function state(
	fingerprint: { last_seen_head?: string; last_seen_stories_digest?: string },
	stories: Array<{ id: string; status: string; [key: string]: unknown }> = [],
) {
	return { ...fingerprint, stories };
}

describe("progress fingerprint", () => {
	beforeEach(async () => mkdir(root, { recursive: true }));
	afterEach(async () => rm(root, { recursive: true, force: true }));

	it("initializes without reporting progress", async () => {
		const cwd = await repo("first");
		const head = await commit(cwd, "a", "a");
		const result = evaluateProgress(state({}), cwd);
		expect(result.progressed).toBe(false);
		expect(result.newFingerprint).toEqual({
			last_seen_head: head,
			last_seen_stories_digest: expect.any(String),
		});
	});

	it("empty commit reports no progress", async () => {
		const cwd = await repo("empty");
		const head = await commit(cwd, "a", "a");
		run(cwd, ["commit", "--allow-empty", "-qm", "empty"]);
		expect(evaluateProgress(state({ last_seen_head: head }), cwd).progressed).toBe(false);
	});

	it("work commit followed by empty commit reports progress", async () => {
		const cwd = await repo("work-empty-cumulative");
		const baseline = await commit(cwd, "a", "a");
		await commit(cwd, "b", "b");
		run(cwd, ["commit", "--allow-empty", "-qm", "empty"]);
		expect(evaluateProgress(state({ last_seen_head: baseline }), cwd).progressed).toBe(true);
	});

	it("ignores worktree changes and an empty commit", async () => {
		const cwd = await repo("work-empty");
		const head = await commit(cwd, "a", "a");
		await writeFile(join(cwd, "a"), "changed");
		run(cwd, ["commit", "--allow-empty", "-qm", "empty"]);
		expect(evaluateProgress(state({ last_seen_head: head }), cwd).progressed).toBe(false);
	});

	it("diff-carrying commit on top of seen head reports progress", async () => {
		const cwd = await repo("diff");
		const first = await commit(cwd, "a", "a");
		await commit(cwd, "b", "b");
		expect(evaluateProgress(state({ last_seen_head: first }), cwd).progressed).toBe(true);
	});

	it("checkout to diverged branch reports no progress", async () => {
		const cwd = await repo("diverged");
		const first = await commit(cwd, "a", "a");
		const second = await commit(cwd, "b", "b");
		run(cwd, ["reset", "--hard", "-q", first]);
		await commit(cwd, "c", "c");
		expect(evaluateProgress(state({ last_seen_head: second }), cwd).progressed).toBe(false);
	});

	it("does not count an amended prior HEAD", async () => {
		const cwd = await repo("amend");
		await commit(cwd, "a", "a");
		const prior = await commit(cwd, "b", "b");
		run(cwd, ["commit", "--amend", "--allow-empty", "--no-edit"]);
		expect(evaluateProgress(state({ last_seen_head: prior }), cwd).progressed).toBe(false);
	});

	it("does not count a rebased prior HEAD", async () => {
		const cwd = await repo("rebase");
		const first = await commit(cwd, "a", "a");
		const prior = await commit(cwd, "b", "b");
		run(cwd, ["checkout", "-qb", "rewritten"]);
		run(cwd, ["rebase", "--onto", first, first, "rewritten"]);
		expect(evaluateProgress(state({ last_seen_head: prior }), cwd).progressed).toBe(false);
	});

	it("does not count a commit followed by its revert", async () => {
		const cwd = await repo("revert");
		const prior = await commit(cwd, "a", "a");
		await commit(cwd, "a", "changed");
		run(cwd, ["revert", "--no-edit", "HEAD"]);
		expect(evaluateProgress(state({ last_seen_head: prior }), cwd).progressed).toBe(false);
	});

	it("reports story transitions without git progress", async () => {
		const cwd = await repo("stories");
		const head = await commit(cwd, "a", "a");
		const before = evaluateProgress(
			state({ last_seen_head: head }, [{ id: "s1", status: "pending" }]),
			cwd,
		);
		const after = evaluateProgress(
			state(
				{
					last_seen_head: head,
					last_seen_stories_digest: before.newFingerprint.last_seen_stories_digest,
				},
				[{ id: "s1", status: "completed" }],
			),
			cwd,
		);
		expect(after.progressed).toBe(true);
	});

	it("fails open outside a git repository", () => {
		expect(evaluateProgress(state({ last_seen_head: "deadbeef" }), root).progressed).toBe(false);
	});

	it("digests only sorted id/status pairs", async () => {
		const cwd = await repo("digest");
		const a = evaluateProgress(
			state({}, [
				{ id: "b", status: "pending", title: "x" },
				{ id: "a", status: "completed" },
			]),
			cwd,
		);
		const b = evaluateProgress(
			state({}, [
				{ id: "a", status: "completed", title: "changed" },
				{ id: "b", status: "pending" },
			]),
			cwd,
		);
		expect(a.newFingerprint.last_seen_stories_digest).toBe(
			b.newFingerprint.last_seen_stories_digest,
		);
	});

	it("fingerprint fields survive raw read", async () => {
		const dir = join(root, "omt");
		await mkdir(dir, { recursive: true });
		const previous = process.env.OMT_DIR;
		process.env.OMT_DIR = dir;
		await writeFile(
			join(dir, "ultragoal-state-raw.json"),
			JSON.stringify({
				active: true,
				phase: "pursuing",
				iteration: 1,
				max_iterations: 2,
				last_seen_head: "h",
				last_seen_stories_digest: "d",
			}),
		);
		expect(readUltragoalStateRaw("raw")).toMatchObject({
			last_seen_head: "h",
			last_seen_stories_digest: "d",
		});
		if (previous === undefined) delete process.env.OMT_DIR;
		else process.env.OMT_DIR = previous;
	});
});

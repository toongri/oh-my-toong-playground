/**
 * Hermetic tests for buildIsolatedCodexHome — no codex spawn. Uses a fixture
 * `auth.json` (never real credentials) so this test never touches this
 * machine's real `~/.codex/auth.json`.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { buildIsolatedCodexHome } from "./isolated-codex-home.ts";

describe("buildIsolatedCodexHome", () => {
	let tmpDir: string;
	let authFixture: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "isolated-codex-home-test-"));
		authFixture = path.join(tmpDir, "fixture-auth.json");
		await fs.writeFile(authFixture, JSON.stringify({ fixture: true }));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("creates <root>/home and <root>/home/.codex", async () => {
		const root = path.join(tmpDir, "root1");
		const { home, codexHome } = await buildIsolatedCodexHome(root, {}, { authSourcePath: authFixture });
		expect(home).toBe(path.join(root, "home"));
		expect(codexHome).toBe(path.join(root, "home", ".codex"));
		expect((await fs.stat(codexHome)).isDirectory()).toBe(true);
	});

	it("copies the given authSourcePath to <codexHome>/auth.json", async () => {
		const root = path.join(tmpDir, "root2");
		const { codexHome } = await buildIsolatedCodexHome(root, {}, { authSourcePath: authFixture });
		const copied = await fs.readFile(path.join(codexHome, "auth.json"), "utf8");
		expect(JSON.parse(copied)).toEqual({ fixture: true });
	});

	it("writes no hooks.json at all when hooks is empty — the 'mechanism absent' arm", async () => {
		const root = path.join(tmpDir, "root3");
		const { codexHome } = await buildIsolatedCodexHome(root, {}, { authSourcePath: authFixture });
		const exists = await fs
			.stat(path.join(codexHome, "hooks.json"))
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);
	});

	it("writes hooks.json wrapping each event's entries under {matcher:'*', hooks:[...]}", async () => {
		const root = path.join(tmpDir, "root4");
		const { codexHome } = await buildIsolatedCodexHome(
			root,
			{ UserPromptSubmit: [{ command: "/bin/true", timeout: 10 }] },
			{ authSourcePath: authFixture },
		);
		const raw = await fs.readFile(path.join(codexHome, "hooks.json"), "utf8");
		const parsed = JSON.parse(raw);
		expect(parsed).toEqual({
			hooks: {
				UserPromptSubmit: [
					{
						matcher: "*",
						hooks: [{ type: "command", command: "/bin/true", timeout: 10 }],
					},
				],
			},
		});
	});

	it("omits the timeout key entirely when a hook entry doesn't specify one", async () => {
		const root = path.join(tmpDir, "root5");
		const { codexHome } = await buildIsolatedCodexHome(
			root,
			{ UserPromptSubmit: [{ command: "/bin/true" }] },
			{ authSourcePath: authFixture },
		);
		const parsed = JSON.parse(await fs.readFile(path.join(codexHome, "hooks.json"), "utf8"));
		expect(parsed.hooks.UserPromptSubmit[0].hooks[0]).toEqual({ type: "command", command: "/bin/true" });
	});

	it("supports multiple events and multiple entries per event, preserving order", async () => {
		const root = path.join(tmpDir, "root6");
		const { codexHome } = await buildIsolatedCodexHome(
			root,
			{
				UserPromptSubmit: [{ command: "/bin/a" }, { command: "/bin/b" }],
				SessionStart: [{ command: "/bin/c" }],
			},
			{ authSourcePath: authFixture },
		);
		const parsed = JSON.parse(await fs.readFile(path.join(codexHome, "hooks.json"), "utf8"));
		expect(parsed.hooks.UserPromptSubmit[0].hooks.map((h: { command: string }) => h.command)).toEqual([
			"/bin/a",
			"/bin/b",
		]);
		expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("/bin/c");
	});

	it("rejects (throws, not silently degrades) when authSourcePath does not exist — caller must know auth setup failed", async () => {
		const root = path.join(tmpDir, "root7");
		await expect(
			buildIsolatedCodexHome(root, {}, { authSourcePath: path.join(tmpDir, "does-not-exist.json") }),
		).rejects.toThrow();
	});
});

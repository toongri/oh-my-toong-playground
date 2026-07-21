/**
 * AC-1 evidence (recorded for durability per plan §4 AC-1):
 *   $ grep -nE '\$(CLAUDE_PROJECT_DIR|HOME)/\.claude/hooks' tools/adapters/claude.ts
 *   → 4 emission sites at L138 (syncAgentsDirect), L434/L436/L442 (syncPlatformYaml).
 * Each site is now branched via isGlobalSync(targetPath) — see plan §5 T3.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFileSync } from "node:child_process";

import { ClaudeAdapter } from "./claude.ts";
import { deriveClaudeProjectKey } from "../lib/git-key.ts";
import baseline from "./__fixtures__/claude-project-baseline.json";
import type { PlatformYaml } from "../lib/types.ts";
import { parseFrontmatter } from "../lib/frontmatter.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function writeFile(filePath: string, content: string, mode?: number): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, "utf8");
	if (mode !== undefined) {
		await fs.chmod(filePath, mode);
	}
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
	const text = await fs.readFile(filePath, "utf8");
	return JSON.parse(text) as Record<string, unknown>;
}

async function exists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let targetPath: string;
let adapter: ClaudeAdapter;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-adapter-test-"));
	targetPath = path.join(tmpDir, "target");
	await fs.mkdir(targetPath, { recursive: true });
	adapter = new ClaudeAdapter();
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// PlatformAdapter fields
// ---------------------------------------------------------------------------

describe("PlatformAdapter 기본 필드", () => {
	it("returns 'claude' for platform field", () => {
		expect(adapter.platform).toBe("claude");
	});

	it("returns '.claude' for configDir field", () => {
		expect(adapter.configDir).toBe(".claude");
	});

	it("returns 'CLAUDE.md' for contextFile field", () => {
		expect(adapter.contextFile).toBe("CLAUDE.md");
	});
});

// ---------------------------------------------------------------------------
// buildHookEntry
// ---------------------------------------------------------------------------

describe("buildHookEntry", () => {
	it("builds a 'command' type hook entry via `buildHookEntry`", () => {
		const entry = adapter.buildHookEntry(
			"PreToolUse",
			"*",
			"command",
			10,
			"$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh",
		);

		expect(entry["PreToolUse"]).toBeArray();
		const group = (entry["PreToolUse"] as Record<string, unknown>[])[0];
		expect(group["matcher"]).toBe("*");
		const hooks = group["hooks"] as Record<string, unknown>[];
		expect(hooks[0]["type"]).toBe("command");
		expect(hooks[0]["command"]).toBe("$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh");
		expect(hooks[0]["timeout"]).toBe(10);
	});

	it("builds a 'prompt' type hook entry via `buildHookEntry`", () => {
		const entry = adapter.buildHookEntry(
			"Stop",
			"*",
			"prompt",
			30,
			"Please summarize what you did.",
		);

		const group = (entry["Stop"] as Record<string, unknown>[])[0];
		const hooks = group["hooks"] as Record<string, unknown>[];
		expect(hooks[0]["type"]).toBe("prompt");
		expect(hooks[0]["prompt"]).toBe("Please summarize what you did.");
		expect(hooks[0]["timeout"]).toBe(30);
	});

	it("replaces ${component} placeholder with displayName via `buildHookEntry`", () => {
		const entry = adapter.buildHookEntry(
			"PostToolUse",
			"*",
			"command",
			10,
			"$CLAUDE_PROJECT_DIR/.claude/hooks/${component}",
			"my-hook.sh",
		);

		const hooks = (entry["PostToolUse"] as Record<string, unknown>[])[0]["hooks"] as Record<
			string,
			unknown
		>[];
		expect(hooks[0]["command"]).toBe("$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh");
	});

	it("includes matcher in the hook group via `buildHookEntry`", () => {
		const entry = adapter.buildHookEntry("PreToolUse", "Bash", "command", 5, "/path/cmd");
		const group = (entry["PreToolUse"] as Record<string, unknown>[])[0];
		expect(group["matcher"]).toBe("Bash");
	});
});

// ---------------------------------------------------------------------------
// updateSettings
// ---------------------------------------------------------------------------

describe("updateSettings", () => {
	it("writes hooks to settings.local.json via `updateSettings`", async () => {
		const hooksEntries = {
			PreToolUse: [
				{ matcher: "*", hooks: [{ type: "command", command: "/bin/test", timeout: 10 }] },
			],
		};

		await adapter.updateSettings(targetPath, hooksEntries);

		const settings = await readJsonFile(path.join(targetPath, ".claude", "settings.local.json"));
		expect(settings["hooks"]).toEqual(hooksEntries);
	});

	it("overwrites existing hooks via `updateSettings`", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(
			settingsFile,
			JSON.stringify({
				hooks: { Stop: [{ matcher: "*", hooks: [] }] },
				someOtherKey: true,
			}),
		);

		const newHooks = { PreToolUse: [] };
		await adapter.updateSettings(targetPath, newHooks);

		const settings = await readJsonFile(settingsFile);
		expect(settings["hooks"]).toEqual(newHooks);
		expect(settings["someOtherKey"]).toBe(true);
	});

	it("skips file write in dry-run mode via `updateSettings`", async () => {
		await adapter.updateSettings(targetPath, { PreToolUse: [] }, true);
		expect(await exists(path.join(targetPath, ".claude", "settings.local.json"))).toBe(false);
	});

	it("preserves foreign hook entries matching preserve marker via `updateSettings`", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(
			settingsFile,
			JSON.stringify({
				hooks: {
					Stop: [
						{
							matcher: "*",
							hooks: [{ type: "command", command: "$HOME/.claude/hooks/old-omt.sh", timeout: 15 }],
						},
						{
							hooks: [
								{
									type: "command",
									command:
										'[ -n "$SUPERSET_HOME_DIR" ] && "$SUPERSET_HOME_DIR/hooks/notify.sh" || true',
								},
							],
						},
					],
					PostToolUse: [
						{
							hooks: [
								{
									type: "command",
									command: 'SUPERSET_AGENT_ID=claude "$SUPERSET_HOME_DIR/hooks/notify.sh"',
								},
							],
						},
					],
				},
			}),
		);

		const newHooks = {
			Stop: [
				{
					matcher: "*",
					hooks: [{ type: "command", command: "$HOME/.claude/hooks/pin-up/index.ts", timeout: 15 }],
				},
			],
		};

		await adapter.updateSettings(targetPath, newHooks, false, {
			"command-contains": ["$SUPERSET_HOME_DIR"],
		});

		const settings = await readJsonFile(settingsFile);
		const hooks = settings["hooks"] as Record<string, Record<string, unknown>[]>;

		// Stop: OMT entry replaced, then matching foreign entry carried over (OMT first, foreign appended)
		expect(hooks["Stop"]).toHaveLength(2);
		expect((hooks["Stop"][0]["hooks"] as Record<string, unknown>[])[0]["command"]).toBe(
			"$HOME/.claude/hooks/pin-up/index.ts",
		);
		expect(
			(hooks["Stop"][1]["hooks"] as Record<string, unknown>[])[0]["command"] as string,
		).toContain("$SUPERSET_HOME_DIR");

		// PostToolUse: OMT defines none, foreign-only entry preserved
		expect(hooks["PostToolUse"]).toHaveLength(1);
		expect(
			(hooks["PostToolUse"][0]["hooks"] as Record<string, unknown>[])[0]["command"] as string,
		).toContain("$SUPERSET_HOME_DIR");
	});

	it("drops foreign hooks when no preserve marker is configured via `updateSettings`", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(
			settingsFile,
			JSON.stringify({
				hooks: {
					Stop: [{ hooks: [{ type: "command", command: '"$SUPERSET_HOME_DIR/hooks/notify.sh"' }] }],
				},
			}),
		);

		await adapter.updateSettings(targetPath, { PreToolUse: [] });

		const settings = await readJsonFile(settingsFile);
		expect(settings["hooks"]).toEqual({ PreToolUse: [] });
	});
});

// ---------------------------------------------------------------------------
// readJsonFile 동작 — syncConfig/updateSettings를 통한 간접 테스트
// ---------------------------------------------------------------------------

describe("readJsonFile 동작", () => {
	it("throws when settings.local.json contains corrupt JSON via `syncConfig`", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(settingsFile, "{invalid");

		// syncConfig internally calls readJsonFile; corrupt JSON should propagate as throw
		expect(adapter.syncConfig(targetPath, { foo: "bar" })).rejects.toThrow();
	});

	it("creates a new file when settings.local.json is absent via `syncConfig`", async () => {
		// settings.local.json does not exist; syncConfig should create it from scratch
		await adapter.syncConfig(targetPath, { createdFresh: true });

		const settings = await readJsonFile(path.join(targetPath, ".claude", "settings.local.json"));
		expect(settings["createdFresh"]).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// syncConfig
// ---------------------------------------------------------------------------

describe("syncConfig", () => {
	it("deep merges config into settings.local.json via `syncConfig`", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(settingsFile, JSON.stringify({ existingKey: "value", nested: { a: 1 } }));

		await adapter.syncConfig(targetPath, { newKey: "hello", nested: { b: 2 } });

		const settings = await readJsonFile(settingsFile);
		expect(settings["existingKey"]).toBe("value");
		expect(settings["newKey"]).toBe("hello");
		expect((settings["nested"] as Record<string, unknown>)["a"]).toBe(1);
		expect((settings["nested"] as Record<string, unknown>)["b"]).toBe(2);
	});

	it("creates settings.local.json when absent via `syncConfig`", async () => {
		await adapter.syncConfig(targetPath, { foo: "bar" });

		const settings = await readJsonFile(path.join(targetPath, ".claude", "settings.local.json"));
		expect(settings["foo"]).toBe("bar");
	});
});

// ---------------------------------------------------------------------------
// setStatusline
// ---------------------------------------------------------------------------

describe("setStatusline", () => {
	it("sets statusLine in settings.local.json via `setStatusline`", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(settingsFile, JSON.stringify({ hooks: {} }));

		await adapter.setStatusline(targetPath, "bun run hud.ts");

		const settings = await readJsonFile(settingsFile);
		const statusLine = settings["statusLine"] as Record<string, unknown>;
		expect(statusLine["type"]).toBe("command");
		expect(statusLine["command"]).toBe("bun run hud.ts");
	});

	it("creates settings.local.json and applies statusLine when file is absent via `setStatusline`", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.local.json");

		await adapter.setStatusline(targetPath, "bun run hud.ts");

		const settings = await readJsonFile(settingsFile);
		const statusLine = settings["statusLine"] as Record<string, unknown>;
		expect(statusLine["type"]).toBe("command");
		expect(statusLine["command"]).toBe("bun run hud.ts");
	});
});

// ---------------------------------------------------------------------------
// settings.local.json 목적지 이전 — 양성/음성 테스트
// ---------------------------------------------------------------------------

describe("settings.local.json 목적지 이전 — 양성", () => {
	it("syncConfig는 .claude/settings.local.json에 기록함", async () => {
		await adapter.syncConfig(targetPath, { permissions: { deny: ["Bash(rm -rf *)"] } });

		const localFile = path.join(targetPath, ".claude", "settings.local.json");
		const settings = await readJsonFile(localFile);
		expect((settings["permissions"] as Record<string, unknown>)["deny"]).toEqual([
			"Bash(rm -rf *)",
		]);
	});

	it("setStatusline은 .claude/settings.local.json에 statusLine을 기록함", async () => {
		const localFile = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(localFile, "{}");

		await adapter.setStatusline(targetPath, "bun run hud.ts");

		const settings = await readJsonFile(localFile);
		const statusLine = settings["statusLine"] as Record<string, unknown>;
		expect(statusLine["type"]).toBe("command");
		expect(statusLine["command"]).toBe("bun run hud.ts");
	});

	it("updateSettings는 hooks를 .claude/settings.local.json에 기록함", async () => {
		const hooksEntries = {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "/bin/pre-tool-enforcer.sh", timeout: 10 }],
				},
			],
		};

		await adapter.updateSettings(targetPath, hooksEntries);

		const localFile = path.join(targetPath, ".claude", "settings.local.json");
		const settings = await readJsonFile(localFile);
		expect(settings["hooks"]).toEqual(hooksEntries);
	});
});

describe("settings.local.json 목적지 이전 — 음성 (.claude/settings.json 불변)", () => {
	it("syncConfig 실행 후 .claude/settings.json 내용이 바이트 단위로 동일함", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.json");
		const original = JSON.stringify({ model: "claude-sonnet-4-6", customField: 123 });
		await writeFile(settingsFile, original);

		await adapter.syncConfig(targetPath, { newKey: "managed" });

		const after = await fs.readFile(settingsFile, "utf8");
		expect(after).toBe(original);
	});

	it("setStatusline 실행 후 .claude/settings.json 내용이 바이트 단위로 동일함", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.json");
		const original = JSON.stringify({ model: "claude-sonnet-4-6", customField: 123 });
		await writeFile(settingsFile, original);
		const localFile = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(localFile, "{}");

		await adapter.setStatusline(targetPath, "bun run hud.ts");

		const after = await fs.readFile(settingsFile, "utf8");
		expect(after).toBe(original);
	});

	it("updateSettings 실행 후 .claude/settings.json 내용이 바이트 단위로 동일함", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.json");
		const original = JSON.stringify({ model: "claude-sonnet-4-6", customField: 123 });
		await writeFile(settingsFile, original);

		await adapter.updateSettings(targetPath, { PreToolUse: [] });

		const after = await fs.readFile(settingsFile, "utf8");
		expect(after).toBe(original);
	});

	it(".claude/settings.json에 statusLine 키가 추가되지 않음", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.json");
		await writeFile(settingsFile, JSON.stringify({ model: "claude-opus-4" }));
		const localFile = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(localFile, "{}");

		await adapter.setStatusline(targetPath, "bun run hud.ts");

		const settings = await readJsonFile(settingsFile);
		expect(settings["statusLine"]).toBeUndefined();
	});

	it(".claude/settings.json에 hooks 키가 추가되지 않음", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.json");
		await writeFile(settingsFile, JSON.stringify({ model: "claude-opus-4" }));

		await adapter.updateSettings(targetPath, { PreToolUse: [] });

		const settings = await readJsonFile(settingsFile);
		expect(settings["hooks"]).toBeUndefined();
	});
});

describe("settings.local.json 딥 머지 — 기존 내용 보존", () => {
	it("syncConfig는 .claude/settings.local.json의 기존 내용과 딥 머지함", async () => {
		const localFile = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(localFile, JSON.stringify({ existing: "value", nested: { a: 1 } }));

		await adapter.syncConfig(targetPath, { newKey: "hello", nested: { b: 2 } });

		const settings = await readJsonFile(localFile);
		expect(settings["existing"]).toBe("value");
		expect(settings["newKey"]).toBe("hello");
		expect((settings["nested"] as Record<string, unknown>)["a"]).toBe(1);
		expect((settings["nested"] as Record<string, unknown>)["b"]).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// syncAgentsDirect — file copy
// ---------------------------------------------------------------------------

describe("syncAgentsDirect - 파일 복사", () => {
	it("copies agent file to .claude/agents/ via `syncAgentsDirect`", async () => {
		const sourceFile = path.join(tmpDir, "oracle.md");
		await writeFile(sourceFile, "---\nname: oracle\n---\n\n# Oracle\n");

		await adapter.syncAgentsDirect(targetPath, "oracle", sourceFile);

		expect(await exists(path.join(targetPath, ".claude", "agents", "oracle.md"))).toBe(true);
	});

	it("logs warning and returns without error when source file missing via `syncAgentsDirect`", async () => {
		await adapter.syncAgentsDirect(targetPath, "missing", "/nonexistent/missing.md");
	});

	it("skips file copy in dry-run mode via `syncAgentsDirect`", async () => {
		const sourceFile = path.join(tmpDir, "agent.md");
		await writeFile(sourceFile, "---\nname: agent\n---\n\nbody");

		await adapter.syncAgentsDirect(targetPath, "agent", sourceFile, [], [], true);

		expect(await exists(path.join(targetPath, ".claude", "agents", "agent.md"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// syncAgentsDirect — add-skills frontmatter injection
// ---------------------------------------------------------------------------

describe("syncAgentsDirect - add-skills 프론트매터 주입", () => {
	it("injects add-skills into agent frontmatter via `syncAgentsDirect`", async () => {
		const sourceFile = path.join(tmpDir, "oracle.md");
		await writeFile(
			sourceFile,
			"---\nname: oracle\nskills:\n  - existing-skill\n---\n\n# Oracle body\n",
		);

		await adapter.syncAgentsDirect(targetPath, "oracle", sourceFile, ["testing", "prometheus"]);

		const agentFile = path.join(targetPath, ".claude", "agents", "oracle.md");
		const content = await fs.readFile(agentFile, "utf8");
		expect(content).toContain("testing");
		expect(content).toContain("prometheus");
		expect(content).toContain("existing-skill");
	});

	it("deduplicates skills in agent frontmatter via `syncAgentsDirect`", async () => {
		const sourceFile = path.join(tmpDir, "oracle.md");
		await writeFile(sourceFile, "---\nname: oracle\nskills:\n  - testing\n---\n\nbody\n");

		await adapter.syncAgentsDirect(targetPath, "oracle", sourceFile, ["testing", "new-skill"]);

		const agentFile = path.join(targetPath, ".claude", "agents", "oracle.md");
		const content = await fs.readFile(agentFile, "utf8");
		const skillMatches = content.match(/testing/g);
		// "testing" should appear exactly once in the skills list
		expect(skillMatches).toHaveLength(1);
	});

	it("preserves body --- separators after add-skills injection (regression P2-4)", async () => {
		const sourceFile = path.join(tmpDir, "agent.md");
		const originalContent = [
			"---",
			"name: agent",
			"---",
			"",
			"## Section A",
			"",
			"Content A.",
			"",
			"---",
			"",
			"## Section B",
			"",
			"Content B.",
		].join("\n");
		await writeFile(sourceFile, originalContent);

		await adapter.syncAgentsDirect(targetPath, "agent", sourceFile, ["my-skill"]);

		const agentFile = path.join(targetPath, ".claude", "agents", "agent.md");
		const content = await fs.readFile(agentFile, "utf8");

		// Body's horizontal rule must survive
		expect(content).toContain("Content A.");
		expect(content).toContain("Content B.");

		// Count --- in body (after the closing frontmatter ---)
		const lines = content.split("\n");
		// Find closing --- index
		let closingIdx = -1;
		for (let i = 1; i < lines.length; i++) {
			if (lines[i] === "---") {
				closingIdx = i;
				break;
			}
		}
		const bodyLines = lines.slice(closingIdx + 1);
		const hrCount = bodyLines.filter((l) => l === "---").length;
		expect(hrCount).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// syncAgentsDirect — add-hooks frontmatter injection
// ---------------------------------------------------------------------------

describe("syncAgentsDirect - add-hooks 프론트매터 주입", () => {
	it("injects add-hooks into agent frontmatter via `syncAgentsDirect`", async () => {
		const sourceFile = path.join(tmpDir, "agent.md");
		await writeFile(sourceFile, "---\nname: agent\n---\n\n# Agent\n");

		const addHooks = [
			{
				event: "SubagentStop",
				matcher: "*",
				type: "command",
				command: "$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh",
				timeout: 60,
				display_name: "my-hook.sh",
			},
		];

		await adapter.syncAgentsDirect(targetPath, "agent", sourceFile, [], addHooks);

		const agentFile = path.join(targetPath, ".claude", "agents", "agent.md");
		const content = await fs.readFile(agentFile, "utf8");
		expect(content).toContain("SubagentStop");
		expect(content).toContain("my-hook.sh");
	});

	it("preserves body --- separators after add-hooks injection (regression P2-4)", async () => {
		const sourceFile = path.join(tmpDir, "agent.md");
		const originalContent = [
			"---",
			"name: agent",
			"---",
			"",
			"## Phase 1",
			"",
			"Content here.",
			"",
			"---",
			"",
			"## Phase 2",
			"",
			"More content.",
		].join("\n");
		await writeFile(sourceFile, originalContent);

		const addHooks = [
			{
				event: "SubagentStop",
				matcher: "*",
				type: "command",
				command: "$CLAUDE_PROJECT_DIR/.claude/hooks/hook.sh",
				timeout: 30,
				display_name: "hook.sh",
			},
		];

		await adapter.syncAgentsDirect(targetPath, "agent", sourceFile, [], addHooks);

		const agentFile = path.join(targetPath, ".claude", "agents", "agent.md");
		const content = await fs.readFile(agentFile, "utf8");

		expect(content).toContain("Content here.");
		expect(content).toContain("More content.");

		// Body's horizontal rule must survive
		const lines = content.split("\n");
		let closingIdx = -1;
		for (let i = 1; i < lines.length; i++) {
			if (lines[i] === "---") {
				closingIdx = i;
				break;
			}
		}
		const bodyLines = lines.slice(closingIdx + 1);
		const hrCount = bodyLines.filter((l) => l === "---").length;
		expect(hrCount).toBe(1);
	});

	it("preserves prompt text for prompt-type hooks via `syncAgentsDirect` (P2-2)", async () => {
		const sourceFile = path.join(tmpDir, "agent.md");
		await writeFile(sourceFile, "---\nname: agent\n---\n\n# Agent\n");

		const addHooks = [
			{
				event: "Stop",
				matcher: "*",
				type: "prompt",
				prompt: "Please summarize what you did.",
				timeout: 30,
				display_name: "stop-prompt",
			},
		];

		await adapter.syncAgentsDirect(targetPath, "agent", sourceFile, [], addHooks);

		const agentFile = path.join(targetPath, ".claude", "agents", "agent.md");
		const content = await fs.readFile(agentFile, "utf8");
		expect(content).toContain("prompt");
		expect(content).toContain("Please summarize what you did.");
	});

	// Regression: a quoted numeric-string `timeout: "60"` in sync.yaml (legacy
	// add-hooks entries) must still resolve to 60, not silently fall back to the
	// `?? 10` default.
	it('resolves a numeric-string timeout ("60") to 60, not the default (regression)', async () => {
		const sourceFile = path.join(tmpDir, "agent.md");
		await writeFile(sourceFile, "---\nname: agent\n---\n\n# Agent\n");

		const addHooks = [
			{
				event: "SubagentStop",
				matcher: "*",
				type: "command",
				command: "$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh",
				timeout: "60",
				display_name: "my-hook.sh",
			},
		];

		await adapter.syncAgentsDirect(targetPath, "agent", sourceFile, [], addHooks);

		const agentFile = path.join(targetPath, ".claude", "agents", "agent.md");
		const content = await fs.readFile(agentFile, "utf8");
		const parsed = parseFrontmatter(content);
		const hooks = (parsed.frontmatter["hooks"] as Record<string, unknown>)[
			"SubagentStop"
		] as Array<{ hooks: Array<{ timeout: number }> }>;
		expect(hooks[0]!.hooks[0]!.timeout).toBe(60);
	});
});

// ---------------------------------------------------------------------------
// syncCommandsDirect
// ---------------------------------------------------------------------------

describe("syncCommandsDirect", () => {
	it("copies command file to .claude/commands/ via `syncCommandsDirect`", async () => {
		const src = path.join(tmpDir, "my-command.md");
		await writeFile(src, "# My Command\n");

		await adapter.syncCommandsDirect(targetPath, "my-command", src);

		expect(await exists(path.join(targetPath, ".claude", "commands", "my-command.md"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// syncHooksDirect
// ---------------------------------------------------------------------------

describe("syncHooksDirect", () => {
	it("copies hook file to .claude/hooks/ and sets +x permission via `syncHooksDirect`", async () => {
		const src = path.join(tmpDir, "my-hook.sh");
		await writeFile(src, "#!/bin/bash\necho hi", 0o644);

		await adapter.syncHooksDirect(targetPath, "my-hook.sh", src);

		const tgt = path.join(targetPath, ".claude", "hooks", "my-hook.sh");
		expect(await exists(tgt)).toBe(true);
		const stat = await fs.stat(tgt);
		expect(stat.mode & 0o111).toBeTruthy();
	});

	it("syncs hook directory to .claude/hooks/<name>/ via `syncHooksDirect`", async () => {
		const srcDir = path.join(tmpDir, "persistent-mode");
		await writeFile(path.join(srcDir, "index.ts"), "export {}");
		await writeFile(path.join(srcDir, "index.test.ts"), "test content");

		await adapter.syncHooksDirect(targetPath, "persistent-mode", srcDir);

		const tgtDir = path.join(targetPath, ".claude", "hooks", "persistent-mode");
		expect(await exists(path.join(tgtDir, "index.ts"))).toBe(true);
		// *.test.ts should be excluded
		expect(await exists(path.join(tgtDir, "index.test.ts"))).toBe(false);
	});

	it("target에 직접 놓인 *.local.yaml 오버레이 파일을 orphan-delete로부터 보호한다", async () => {
		// codex.ts:414의 config.local.yaml 보호와 동일 메커니즘(exclude 리스트)을
		// claude.ts에도 미러: sample.local.yaml처럼 소스에는 없고 타겟에만
		// 직접 배치된 개인 오버레이 파일이 다음 sync의 orphan-delete에서 삭제되면 안 된다.
		const srcDir = path.join(tmpDir, "sample-gate");
		await writeFile(path.join(srcDir, "sample.yaml"), "base: true");

		// 개인이 이전에 타겟에 직접 배치한 오버레이 파일 (소스에는 없음)
		const targetOverlay = path.join(
			targetPath,
			".claude",
			"hooks",
			"sample-gate",
			"sample.local.yaml",
		);
		await writeFile(targetOverlay, "local: true");

		await adapter.syncHooksDirect(targetPath, "sample-gate", srcDir);

		expect(await exists(targetOverlay)).toBe(true);
	});

	it("파일 훅의 shell 의존성을 target에 복사한다", async () => {
		// hooks/ 구조: my-hook.sh (source 문 포함) + lib/shared.sh
		const hooksDir = path.join(tmpDir, "hooks");
		const libDir = path.join(hooksDir, "lib");
		await writeFile(
			path.join(hooksDir, "my-hook.sh"),
			'#!/bin/bash\nsource "$HOOKS_DIR/lib/shared.sh"\necho hook\n',
			0o644,
		);
		await writeFile(path.join(libDir, "shared.sh"), "#!/bin/bash\necho shared\n", 0o644);

		await adapter.syncHooksDirect(targetPath, "my-hook.sh", path.join(hooksDir, "my-hook.sh"));

		const targetLib = path.join(targetPath, ".claude", "hooks", "lib", "shared.sh");
		expect(await exists(targetLib)).toBe(true);
	});

	it("디렉토리 훅의 외부 의존성을 base dir 기반으로 resolve한다", async () => {
		// hooks/ 구조: my-dir-hook/entry.sh (hooks/ 루트 기준 source) + lib/shared.sh
		// hooksSourceDir = path.dirname(dirHookDir) = hooks/
		// syncShellDepsForDir copies deps into targetHookDir = .claude/hooks/my-dir-hook/
		const hooksDir = path.join(tmpDir, "hooks");
		const dirHookDir = path.join(hooksDir, "my-dir-hook");
		const libDir = path.join(hooksDir, "lib");
		await writeFile(
			path.join(dirHookDir, "entry.sh"),
			'#!/bin/bash\nsource "$HOOKS_DIR/lib/shared.sh"\necho entry\n',
			0o644,
		);
		await writeFile(path.join(libDir, "shared.sh"), "#!/bin/bash\necho shared\n", 0o644);

		await adapter.syncHooksDirect(targetPath, "my-dir-hook", dirHookDir);

		// deps are copied into the targetHookDir, not the parent hooks/ dir
		const targetLib = path.join(targetPath, ".claude", "hooks", "my-dir-hook", "lib", "shared.sh");
		expect(await exists(targetLib)).toBe(true);
	});

	it("`# omt-hook-dep:` 디렉티브로 참조된 companion 파일을 함께 복사한다", async () => {
		// session-start.sh references omt-ledger.sh only inside an injected string
		// (not a `source` statement), so the plain scanner would miss it without
		// the explicit companion-dependency directive.
		const hooksDir = path.join(tmpDir, "hooks");
		await writeFile(
			path.join(hooksDir, "session-start.sh"),
			'#!/bin/bash\n# omt-hook-dep: omt-ledger.sh\necho "run .claude/hooks/omt-ledger.sh append Foo"\n',
			0o644,
		);
		await writeFile(
			path.join(hooksDir, "omt-ledger.sh"),
			"#!/bin/bash\necho ledger\n",
			0o644,
		);

		await adapter.syncHooksDirect(
			targetPath,
			"session-start.sh",
			path.join(hooksDir, "session-start.sh"),
		);

		expect(await exists(path.join(targetPath, ".claude", "hooks", "session-start.sh"))).toBe(true);
		expect(await exists(path.join(targetPath, ".claude", "hooks", "omt-ledger.sh"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// syncSkillsDirect
// ---------------------------------------------------------------------------

describe("syncSkillsDirect", () => {
	it("copies skill directory to .claude/skills/<name>/ via `syncSkillsDirect`", async () => {
		const srcDir = path.join(tmpDir, "prometheus");
		await writeFile(path.join(srcDir, "SKILL.md"), "# Prometheus");

		await adapter.syncSkillsDirect(targetPath, "prometheus", srcDir);

		expect(await exists(path.join(targetPath, ".claude", "skills", "prometheus", "SKILL.md"))).toBe(
			true,
		);
	});
});

// ---------------------------------------------------------------------------
// syncScriptsDirect
// ---------------------------------------------------------------------------

describe("syncScriptsDirect", () => {
	it("copies script file to .claude/scripts/ via `syncScriptsDirect`", async () => {
		const src = path.join(tmpDir, "script.sh");
		await writeFile(src, "#!/bin/bash\necho hi");

		await adapter.syncScriptsDirect(targetPath, "script.sh", src);

		expect(await exists(path.join(targetPath, ".claude", "scripts", "script.sh"))).toBe(true);
	});

	it("copies script directory to .claude/scripts/<name>/ via `syncScriptsDirect`", async () => {
		const srcDir = path.join(tmpDir, "hud");
		await writeFile(path.join(srcDir, "index.ts"), "export {}");
		await writeFile(path.join(srcDir, "index.test.ts"), "test");

		await adapter.syncScriptsDirect(targetPath, "hud", srcDir);

		expect(await exists(path.join(targetPath, ".claude", "scripts", "hud", "index.ts"))).toBe(true);
		expect(await exists(path.join(targetPath, ".claude", "scripts", "hud", "index.test.ts"))).toBe(
			false,
		);
	});
});

// ---------------------------------------------------------------------------
// syncRulesDirect
// ---------------------------------------------------------------------------

describe("syncRulesDirect", () => {
	it("copies rule file to .claude/rules/ via `syncRulesDirect`", async () => {
		const src = path.join(tmpDir, "coding-discipline.md");
		await writeFile(src, "# Coding Discipline\n");

		await adapter.syncRulesDirect(targetPath, "coding-discipline", src);

		expect(await exists(path.join(targetPath, ".claude", "rules", "coding-discipline.md"))).toBe(
			true,
		);
	});
});

// ---------------------------------------------------------------------------
// Plugin install — DI pattern
// ---------------------------------------------------------------------------

describe("Plugin install (DI 패턴)", () => {
	it("invokes plugin installer via `syncPlatformYaml`", async () => {
		const installedPlugins: string[] = [];
		const mockInstaller = async (name: string) => {
			installedPlugins.push(name);
		};

		const adapterWithMock = new ClaudeAdapter(mockInstaller);
		// syncPlatformYaml needs to not fail on hooks/config (no hooks/config provided)
		await adapterWithMock.syncPlatformYaml(
			targetPath,
			{
				plugins: { items: ["my-plugin", "another-plugin"] },
			},
			false,
		);

		expect(installedPlugins).toContain("my-plugin");
		expect(installedPlugins).toContain("another-plugin");
	});

	it("continues without error when plugin install throws via `syncPlatformYaml`", async () => {
		const failingInstaller = async (_name: string) => {
			throw new Error("install failed");
		};

		const adapterWithMock = new ClaudeAdapter(failingInstaller);
		// Should not throw
		await adapterWithMock.syncPlatformYaml(
			targetPath,
			{
				plugins: { items: ["bad-plugin"] },
			},
			false,
		);
	});

	it("logs warning and continues when plugin installer returns non-zero exit code via `syncPlatformYaml`", async () => {
		const failingInstaller = async (_name: string, _targetPath: string) => {
			throw new Error("claude plugin install bad-plugin exited with code 1");
		};

		const adapterWithMock = new ClaudeAdapter(failingInstaller);
		// Should not throw — _installPluginSafe catches and warns
		expect(
			adapterWithMock.syncPlatformYaml(
				targetPath,
				{
					plugins: { items: ["bad-plugin"] },
				},
				false,
			),
		).resolves.toBeDefined();
	});

	it("skips plugin install in dry-run mode via `syncPlatformYaml`", async () => {
		const installedPlugins: string[] = [];
		const mockInstaller = async (name: string) => {
			installedPlugins.push(name);
		};

		const adapterWithMock = new ClaudeAdapter(mockInstaller);
		await adapterWithMock.syncPlatformYaml(
			targetPath,
			{
				plugins: { items: ["dry-plugin"] },
			},
			true,
		);

		expect(installedPlugins).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Plugin scope 및 object format
// ---------------------------------------------------------------------------

describe("plugin scope 및 object format", () => {
	it("passes 'user' scope to plugin installer", async () => {
		const capturedScopes: string[] = [];
		const mockInstaller = async (_name: string, _targetPath: string, scope: string) => {
			capturedScopes.push(scope);
		};

		const adapterWithMock = new ClaudeAdapter(mockInstaller);
		await adapterWithMock.syncPlatformYaml(
			targetPath,
			{
				plugins: { items: ["my-plugin"] },
			},
			false,
			"user",
		);

		expect(capturedScopes).toEqual(["user"]);
	});

	it("passes 'project' scope to plugin installer", async () => {
		const capturedScopes: string[] = [];
		const mockInstaller = async (_name: string, _targetPath: string, scope: string) => {
			capturedScopes.push(scope);
		};

		const adapterWithMock = new ClaudeAdapter(mockInstaller);
		await adapterWithMock.syncPlatformYaml(
			targetPath,
			{
				plugins: { items: ["my-plugin"] },
			},
			false,
			"project",
		);

		expect(capturedScopes).toEqual(["project"]);
	});

	it("defaults to 'user' scope when scope not provided", async () => {
		const capturedScopes: string[] = [];
		const mockInstaller = async (_name: string, _targetPath: string, scope: string) => {
			capturedScopes.push(scope);
		};

		const adapterWithMock = new ClaudeAdapter(mockInstaller);
		await adapterWithMock.syncPlatformYaml(
			targetPath,
			{
				plugins: { items: ["my-plugin"] },
			},
			false,
		);

		expect(capturedScopes).toEqual(["user"]);
	});

	it("processes object-format plugin with name field", async () => {
		const installedNames: string[] = [];
		const mockInstaller = async (name: string) => {
			installedNames.push(name);
		};
		const mockCommandRunner = async (_cmd: string, _cwd: string) => ({ exitCode: 1 });

		const adapterWithMock = new ClaudeAdapter(mockInstaller, mockCommandRunner);
		await adapterWithMock.syncPlatformYaml(
			targetPath,
			{
				plugins: { items: [{ name: "my-plugin@marketplace" }] },
			},
			false,
		);

		expect(installedNames).toContain("my-plugin@marketplace");
	});

	it("skips install when check command succeeds", async () => {
		const installedNames: string[] = [];
		const mockInstaller = async (name: string) => {
			installedNames.push(name);
		};
		const mockCommandRunner = async (_cmd: string, _cwd: string) => ({ exitCode: 0 });

		const adapterWithMock = new ClaudeAdapter(mockInstaller, mockCommandRunner);
		await adapterWithMock.syncPlatformYaml(
			targetPath,
			{
				plugins: { items: [{ name: "my-plugin", check: "which my-plugin" }] },
			},
			false,
		);

		expect(installedNames).toHaveLength(0);
	});

	it("runs pre-commands before install", async () => {
		const callOrder: string[] = [];
		const mockInstaller = async (name: string) => {
			callOrder.push(`install:${name}`);
		};
		const mockCommandRunner = async (cmd: string, _cwd: string) => {
			callOrder.push(`run:${cmd}`);
			// check command fails (exit 1), pre-commands succeed (exit 0)
			if (cmd === "which my-plugin") return { exitCode: 1 };
			return { exitCode: 0 };
		};

		const adapterWithMock = new ClaudeAdapter(mockInstaller, mockCommandRunner);
		await adapterWithMock.syncPlatformYaml(
			targetPath,
			{
				plugins: {
					items: [
						{
							name: "my-plugin",
							check: "which my-plugin",
							"pre-commands": ["brew install dep1", "brew install dep2"],
						},
					],
				},
			},
			false,
		);

		const preCmd1Idx = callOrder.indexOf("run:brew install dep1");
		const preCmd2Idx = callOrder.indexOf("run:brew install dep2");
		const installIdx = callOrder.indexOf("install:my-plugin");

		expect(preCmd1Idx).toBeGreaterThanOrEqual(0);
		expect(preCmd2Idx).toBeGreaterThanOrEqual(0);
		expect(installIdx).toBeGreaterThanOrEqual(0);
		expect(preCmd1Idx).toBeLessThan(installIdx);
		expect(preCmd2Idx).toBeLessThan(installIdx);
	});

	it("skips object item without name", async () => {
		const installedNames: string[] = [];
		const mockInstaller = async (name: string) => {
			installedNames.push(name);
		};

		const adapterWithMock = new ClaudeAdapter(mockInstaller);
		// Should not throw
		await adapterWithMock.syncPlatformYaml(
			targetPath,
			{
				plugins: { items: [{ check: "true" } as any] },
			},
			false,
		);

		expect(installedNames).toHaveLength(0);
	});

	it("handles install failure gracefully", async () => {
		const throwingInstaller = async (_name: string) => {
			throw new Error("installation failed badly");
		};

		const adapterWithMock = new ClaudeAdapter(throwingInstaller);
		// Should not throw
		expect(
			adapterWithMock.syncPlatformYaml(
				targetPath,
				{
					plugins: { items: [{ name: "failing-plugin" }] },
				},
				false,
			),
		).resolves.toBeDefined();
	});

	it("dry-run does not invoke installer", async () => {
		const installedNames: string[] = [];
		const mockInstaller = async (name: string) => {
			installedNames.push(name);
		};

		const adapterWithMock = new ClaudeAdapter(mockInstaller);
		await adapterWithMock.syncPlatformYaml(
			targetPath,
			{
				plugins: { items: ["my-plugin", { name: "object-plugin" }] },
			},
			true,
		);

		expect(installedNames).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// syncMcpsMerge
// ---------------------------------------------------------------------------

describe("syncMcpsMerge", () => {
	let claudeConfigFile: string;
	const origClaudeUserConfig = process.env["CLAUDE_USER_CONFIG"];

	beforeEach(() => {
		claudeConfigFile = path.join(tmpDir, ".claude.json");
		process.env["CLAUDE_USER_CONFIG"] = claudeConfigFile;
	});

	afterEach(() => {
		if (origClaudeUserConfig === undefined) {
			delete process.env["CLAUDE_USER_CONFIG"];
		} else {
			process.env["CLAUDE_USER_CONFIG"] = origClaudeUserConfig;
		}
	});

	it("writes user-scope MCP to mcpServers in ~/.claude.json via `syncMcpsMerge`", async () => {
		await adapter.syncMcpsMerge(targetPath, "my-server", { command: "npx my-server" });

		const config = await readJsonFile(claudeConfigFile);
		const mcpServers = config["mcpServers"] as Record<string, unknown>;
		expect(mcpServers).toBeDefined();
		expect(mcpServers["my-server"]).toEqual({ command: "npx my-server" });
	});

	it("merges new server into existing mcpServers without overwriting others via `syncMcpsMerge`", async () => {
		await fs.writeFile(
			claudeConfigFile,
			JSON.stringify({ mcpServers: { "existing-server": { command: "npx existing" } } }),
			"utf8",
		);

		await adapter.syncMcpsMerge(targetPath, "new-server", { command: "npx new-server" });

		const config = await readJsonFile(claudeConfigFile);
		const mcpServers = config["mcpServers"] as Record<string, unknown>;
		expect(mcpServers["existing-server"]).toEqual({ command: "npx existing" });
		expect(mcpServers["new-server"]).toEqual({ command: "npx new-server" });
	});

	it("writes local-scope MCP to projects[targetPath].mcpServers in ~/.claude.json via `syncMcpsMerge`", async () => {
		await adapter.syncMcpsMerge(
			targetPath,
			"local-server",
			{ command: "npx local" },
			false,
			"local",
		);

		const derivedKey = deriveClaudeProjectKey(targetPath);
		const config = await readJsonFile(claudeConfigFile);
		const projects = config["projects"] as Record<string, unknown>;
		const projectEntry = projects[derivedKey] as Record<string, unknown>;
		const mcpServers = projectEntry["mcpServers"] as Record<string, unknown>;
		expect(mcpServers["local-server"]).toEqual({ command: "npx local" });
	});

	it("local mcp derived key", async () => {
		// Create a git repo with a linked worktree.
		// deriveClaudeProjectKey(worktreeDir) returns the repo root (branch a),
		// which is different from worktreeDir — proving the key is git-derived, not raw targetPath.
		const gitEnv = {
			...process.env,
			GIT_AUTHOR_NAME: "test",
			GIT_AUTHOR_EMAIL: "t@t.com",
			GIT_COMMITTER_NAME: "test",
			GIT_COMMITTER_EMAIL: "t@t.com",
		};
		const repoDir = path.join(tmpDir, "main-repo");
		await fs.mkdir(repoDir, { recursive: true });
		execFileSync("git", ["init", repoDir]);
		execFileSync("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "init"], { env: gitEnv });
		const worktreeDir = path.join(tmpDir, "linked-worktree");
		execFileSync("git", ["-C", repoDir, "worktree", "add", "-b", "wt-branch", worktreeDir]);

		const derivedKey = deriveClaudeProjectKey(worktreeDir);
		// derivedKey = repoDir (branch a: basename(.git) === ".git" → dirname)
		// worktreeDir ≠ derivedKey
		expect(derivedKey).not.toBe(worktreeDir);

		await adapter.syncMcpsMerge(worktreeDir, "wt-server", { command: "npx wt" }, false, "local");

		const config = await readJsonFile(claudeConfigFile);
		const projects = config["projects"] as Record<string, unknown>;

		// The key must be derivedKey (repo root), NOT the raw worktreeDir
		expect(projects[derivedKey]).toBeDefined();
		const projectEntry = projects[derivedKey] as Record<string, unknown>;
		const mcpServers = projectEntry["mcpServers"] as Record<string, unknown>;
		expect(mcpServers["wt-server"]).toEqual({ command: "npx wt" });

		// The raw worktreeDir path must NOT appear as a key
		expect(projects[worktreeDir]).toBeUndefined();
	});

	it("container e2e bare key", async () => {
		// Build a CONTAINER-layout bare+worktree fixture:
		//   <container>/
		//     .bare/       ← actual bare repo (git common-dir)
		//     .git         ← text file: "gitdir: ./.bare"
		// so that `git -C <container> rev-parse --path-format=absolute --git-common-dir`
		// returns `<container>/.bare`.
		//
		// Note: on macOS mkdtemp returns /var/... but git resolves via realpath
		// to /private/var/... — use realpathSync on tmpDir to stay consistent.
		const gitEnv = {
			...process.env,
			GIT_AUTHOR_NAME: "test",
			GIT_AUTHOR_EMAIL: "t@t.com",
			GIT_COMMITTER_NAME: "test",
			GIT_COMMITTER_EMAIL: "t@t.com",
		};
		const { realpathSync } = await import("node:fs");
		const realTmpDir = realpathSync(tmpDir);
		const containerDir = path.join(realTmpDir, "container");
		const bareDir = path.join(containerDir, ".bare");
		await fs.mkdir(containerDir, { recursive: true });
		// Init a bare repo in .bare/
		execFileSync("git", ["init", "--bare", bareDir]);
		// Write the .git file pointing to .bare so git treats container as a worktree
		await fs.writeFile(path.join(containerDir, ".git"), "gitdir: ./.bare\n", "utf8");
		// Create an initial commit in the bare repo so worktree add can work
		const worktreeDir = path.join(tmpDir, "wt");
		execFileSync(
			"git",
			["-C", containerDir, "worktree", "add", "--orphan", "-b", "main", worktreeDir],
			{ env: gitEnv },
		);
		execFileSync("git", ["-C", worktreeDir, "commit", "--allow-empty", "-m", "init"], {
			env: gitEnv,
		});

		// Verify the fixture: git -C <container> rev-parse --git-common-dir must return <container>/.bare
		const commonDir = execFileSync("git", [
			"-C",
			containerDir,
			"rev-parse",
			"--path-format=absolute",
			"--git-common-dir",
		])
			.toString()
			.trim();
		expect(commonDir).toBe(bareDir);

		// Drive the adapter with targetPath = containerDir, scope = local
		await adapter.syncMcpsMerge(
			containerDir,
			"notion",
			{ url: "https://mcp.notion.com/sse" },
			false,
			"local",
		);

		// Assert: the key in projects[] ends with "/.bare"
		const config = await readJsonFile(claudeConfigFile);
		const projects = config["projects"] as Record<string, unknown>;
		const matchingKey = Object.keys(projects).find((k) => k.endsWith("/.bare"));
		expect(matchingKey).toBeDefined();
		expect(matchingKey).toBe(bareDir);
		const projectEntry = projects[matchingKey!] as Record<string, unknown>;
		const mcpServers = projectEntry["mcpServers"] as Record<string, unknown>;
		expect(mcpServers["notion"]).toEqual({ url: "https://mcp.notion.com/sse" });
	});

	it("user scope unchanged", async () => {
		await adapter.syncMcpsMerge(
			targetPath,
			"user-server",
			{ command: "npx user" },
			false,
			undefined,
		);

		const config = await readJsonFile(claudeConfigFile);
		const mcpServers = config["mcpServers"] as Record<string, unknown>;
		expect(mcpServers["user-server"]).toEqual({ command: "npx user" });
		// No projects key should be written for user-scope
		expect(config["projects"]).toBeUndefined();
	});

	it("dry-run logs local MCP key line via `syncMcpsMerge`", async () => {
		const stderrChunks: string[] = [];
		const stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
			stderrChunks.push(String(chunk));
			return true;
		});
		try {
			const derivedKey = deriveClaudeProjectKey(targetPath);
			await adapter.syncMcpsMerge(targetPath, "dry-server", { command: "npx dry" }, true, "local");
			const combined = stderrChunks.join("");
			expect(combined).toContain("local MCP key:");
			expect(combined).toContain(derivedKey);
		} finally {
			stderrSpy.mockRestore();
		}
	});

	it("skips file write in dry-run mode via `syncMcpsMerge`", async () => {
		await adapter.syncMcpsMerge(targetPath, "my-server", { command: "npx my-server" }, true);

		expect(await exists(claudeConfigFile)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// syncPlatformYaml — processed sections
// ---------------------------------------------------------------------------

describe("syncPlatformYaml - processedSections", () => {
	it("includes 'config' in processedSections after processing config section via `syncPlatformYaml`", async () => {
		const result = await adapter.syncPlatformYaml(
			targetPath,
			{
				config: { foo: "bar" },
			},
			false,
		);

		expect(result.processedSections).toContain("config");
	});

	it("includes 'hooks' in processedSections after processing hooks section via `syncPlatformYaml`", async () => {
		const result = await adapter.syncPlatformYaml(
			targetPath,
			{
				hooks: {
					PreToolUse: [
						{
							command: "$CLAUDE_PROJECT_DIR/.claude/hooks/test.sh",
							timeout: 10,
							matcher: "*",
						},
					],
				},
			} as unknown as PlatformYaml,
			false,
		);

		expect(result.processedSections).toContain("hooks");
	});

	it("includes 'plugins' in processedSections after processing plugins section via `syncPlatformYaml`", async () => {
		const noop = async () => {};
		const a = new ClaudeAdapter(noop);
		const result = await a.syncPlatformYaml(
			targetPath,
			{
				plugins: { items: ["test-plugin"] },
			},
			false,
		);

		expect(result.processedSections).toContain("plugins");
	});

	it("includes 'statusLine' in processedSections after processing statusLine section via `syncPlatformYaml`", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(settingsFile, "{}");

		const result = await adapter.syncPlatformYaml(
			targetPath,
			{
				statusLine: "bun run hud.ts",
			},
			false,
		);

		expect(result.processedSections).toContain("statusLine");
	});

	it("always returns undefined for modelMap (claude does not support model-map) via `syncPlatformYaml`", async () => {
		const result = await adapter.syncPlatformYaml(targetPath, {}, false);
		expect(result.modelMap).toBeUndefined();
	});

	it("returns empty processedSections for empty yaml via `syncPlatformYaml`", async () => {
		const result = await adapter.syncPlatformYaml(targetPath, {}, false);
		expect(result.processedSections).toHaveLength(0);
	});

	it("clears existing hooks and saves empty hooks to settings.local.json when hooks: {} via `syncPlatformYaml`", async () => {
		const settingsFile = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(
			settingsFile,
			JSON.stringify({
				hooks: {
					PreToolUse: [
						{ matcher: "*", hooks: [{ type: "command", command: "/old", timeout: 10 }] },
					],
				},
				otherKey: "keep",
			}),
		);

		await adapter.syncPlatformYaml(targetPath, { hooks: {} }, false);

		const settings = await readJsonFile(settingsFile);
		// hooks must be cleared to empty object
		expect(settings["hooks"]).toEqual({});
		// unrelated keys must be preserved
		expect(settings["otherKey"]).toBe("keep");
	});

	it("returns processedSections normally in dry-run mode via `syncPlatformYaml`", async () => {
		const result = await adapter.syncPlatformYaml(
			targetPath,
			{
				config: { foo: "bar" },
			},
			true,
		);

		expect(result.processedSections).toContain("config");
	});

	it("extracts displayName via `path.basename()` from absolute component path and copies hook via `syncPlatformYaml`", async () => {
		// Create a real hook file at an absolute path (simulates pre-resolved path from orchestrator)
		const hookFile = path.join(tmpDir, "keyword-detector.sh");
		await writeFile(hookFile, "#!/bin/bash\necho hi\n", 0o644);

		const result = await adapter.syncPlatformYaml(
			targetPath,
			{
				hooks: {
					UserPromptSubmit: [
						{
							component: hookFile,
							timeout: 10,
							matcher: "*",
						},
					],
				},
			},
			false,
		);

		expect(result.processedSections).toContain("hooks");

		// Hook should be copied under its basename, not full path or colon-split name
		const hookDest = path.join(targetPath, ".claude", "hooks", "keyword-detector.sh");
		expect(await exists(hookDest)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// syncPlatformYaml — mcps scope integration
// ---------------------------------------------------------------------------

describe("syncPlatformYaml - mcps scope", () => {
	let claudeConfigFile: string;
	const origClaudeUserConfig = process.env["CLAUDE_USER_CONFIG"];

	beforeEach(() => {
		claudeConfigFile = path.join(tmpDir, ".claude.json");
		process.env["CLAUDE_USER_CONFIG"] = claudeConfigFile;
	});

	afterEach(() => {
		if (origClaudeUserConfig === undefined) {
			delete process.env["CLAUDE_USER_CONFIG"];
		} else {
			process.env["CLAUDE_USER_CONFIG"] = origClaudeUserConfig;
		}
	});

	it("scope='project' 전달 시 projects[targetPath].mcpServers에 기록 via `syncPlatformYaml`", async () => {
		await adapter.syncPlatformYaml(
			targetPath,
			{
				mcps: { "project-server": { command: "npx project-server" } },
			},
			false,
			"project",
		);

		const derivedKey = deriveClaudeProjectKey(targetPath);
		const config = await readJsonFile(claudeConfigFile);
		const projects = config["projects"] as Record<string, unknown>;
		const projectEntry = projects[derivedKey] as Record<string, unknown>;
		const mcpServers = projectEntry["mcpServers"] as Record<string, unknown>;
		expect(mcpServers["project-server"]).toEqual({ command: "npx project-server" });
	});

	it("scope 미전달 시 최상위 mcpServers에 기록 via `syncPlatformYaml`", async () => {
		await adapter.syncPlatformYaml(
			targetPath,
			{
				mcps: { "user-server": { command: "npx user-server" } },
			},
			false,
		);

		const config = await readJsonFile(claudeConfigFile);
		const mcpServers = config["mcpServers"] as Record<string, unknown>;
		expect(mcpServers["user-server"]).toEqual({ command: "npx user-server" });
	});

	it('scope="user" 명시적 전달 시 최상위 mcpServers에 기록 via `syncPlatformYaml`', async () => {
		await adapter.syncPlatformYaml(
			targetPath,
			{
				mcps: { "explicit-user-server": { command: "npx explicit-user-server" } },
			},
			false,
			"user",
		);

		const config = await readJsonFile(claudeConfigFile);
		const mcpServers = config["mcpServers"] as Record<string, unknown>;
		expect(mcpServers["explicit-user-server"]).toEqual({ command: "npx explicit-user-server" });
	});
});

// ---------------------------------------------------------------------------
// isGlobalSync 분기 — 글로벌 sync (path = homedir)
// ---------------------------------------------------------------------------
//
// 격리 전략: spyOn(os, "homedir")으로 fakeHome tmpdir을 반환하도록 mock.
// 어댑터 내부의 os.homedir() 호출이 모두 fakeHome을 반환하므로
// isGlobalSync(globalTarget) === true 분기가 활성화되고
// 실제 사용자 ~/.claude에는 전혀 write하지 않는다.

describe("isGlobalSync 분기 — 글로벌 sync (path = homedir)", () => {
	let fakeHome: string;
	let homeSpy: ReturnType<typeof spyOn>;
	let globalTarget: string;
	let claudeDir: string;
	let settingsFile: string;
	let agentsDir: string;

	beforeEach(async () => {
		fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "claude-test-home-"));
		homeSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);
		globalTarget = os.homedir(); // = fakeHome (mocked)
		claudeDir = path.join(globalTarget, ".claude");
		settingsFile = path.join(claudeDir, "settings.json");
		agentsDir = path.join(claudeDir, "agents");
	});

	afterEach(async () => {
		homeSpy.mockRestore();
		await fs.rm(fakeHome, { recursive: true, force: true });
	});

	// AC-3: syncAgentsDirect — agent frontmatter hook command uses $HOME prefix
	it("AC-3: `syncAgentsDirect`가 글로벌 path에서 frontmatter hook command를 $HOME 경로로 emit", async () => {
		const sourceFile = path.join(tmpDir, "oracle-global.md");
		await writeFile(sourceFile, "---\nname: oracle-global\n---\n\n# Oracle\n");

		const addHooks = [
			{
				event: "SubagentStop",
				matcher: "*",
				type: "command",
				command: "",
				display_name: "my-hook.sh",
				timeout: 10,
			},
		];

		await adapter.syncAgentsDirect(globalTarget, "oracle-global", sourceFile, [], addHooks);

		const agentFile = path.join(agentsDir, "oracle-global.md");
		const content = await fs.readFile(agentFile, "utf8");
		expect(content).toContain("$HOME/.claude/hooks/my-hook.sh");
		expect(content).not.toContain("$CLAUDE_PROJECT_DIR");
	});

	// AC-4: syncPlatformYaml — directory hook with index.ts uses $HOME prefix
	it("AC-4: `syncPlatformYaml`이 글로벌 path에서 index.ts hook command를 bun run $HOME 경로로 emit", async () => {
		// Create hook directory with index.ts (triggers AC-4 branch)
		const hookDir = path.join(tmpDir, "pin-up");
		await fs.mkdir(hookDir, { recursive: true });
		await writeFile(path.join(hookDir, "index.ts"), "export {}");

		await adapter.syncPlatformYaml(
			globalTarget,
			{
				hooks: {
					Stop: [
						{
							component: hookDir,
							timeout: 60,
							matcher: "*",
						},
					],
				},
			},
			false,
		);

		const settings = await readJsonFile(settingsFile);
		const stopHooks = (settings["hooks"] as Record<string, unknown>)["Stop"] as Array<
			Record<string, unknown>
		>;
		const hookEntries = stopHooks.flatMap((h) => h["hooks"] as Array<Record<string, unknown>>);
		const commands = hookEntries.map((e) => e["command"] as string);
		expect(commands.some((c) => c.startsWith("bun run $HOME/.claude/hooks/"))).toBe(true);
		expect(commands.some((c) => c.includes("$CLAUDE_PROJECT_DIR"))).toBe(false);
	});

	// AC-5: syncPlatformYaml — directory hook with index.sh uses $HOME prefix
	it("AC-5: `syncPlatformYaml`이 글로벌 path에서 index.sh hook command를 bash $HOME 경로로 emit", async () => {
		// Create hook directory with index.sh only (triggers AC-5 branch)
		const hookDir = path.join(tmpDir, "keyword-detector");
		await fs.mkdir(hookDir, { recursive: true });
		await writeFile(path.join(hookDir, "index.sh"), "#!/bin/bash\necho hi\n", 0o755);

		await adapter.syncPlatformYaml(
			globalTarget,
			{
				hooks: {
					UserPromptSubmit: [
						{
							component: hookDir,
							timeout: 10,
							matcher: "*",
						},
					],
				},
			},
			false,
		);

		const settings = await readJsonFile(settingsFile);
		const eventHooks = (settings["hooks"] as Record<string, unknown>)["UserPromptSubmit"] as Array<
			Record<string, unknown>
		>;
		const hookEntries = eventHooks.flatMap((h) => h["hooks"] as Array<Record<string, unknown>>);
		const commands = hookEntries.map((e) => e["command"] as string);
		expect(commands.some((c) => c.startsWith("bash $HOME/.claude/hooks/"))).toBe(true);
		expect(commands.some((c) => c.includes("$CLAUDE_PROJECT_DIR"))).toBe(false);
	});

	// AC-6: syncPlatformYaml — direct file hook uses $HOME prefix
	it("AC-6: `syncPlatformYaml`이 글로벌 path에서 직접 파일 hook command를 $HOME 경로로 emit", async () => {
		// Create a plain hook file (triggers AC-6 direct path branch)
		const hookFile = path.join(tmpDir, "session-start.sh");
		await writeFile(hookFile, "#!/bin/bash\necho start\n", 0o755);

		await adapter.syncPlatformYaml(
			globalTarget,
			{
				hooks: {
					PreToolUse: [
						{
							component: hookFile,
							timeout: 10,
							matcher: "*",
						},
					],
				},
			},
			false,
		);

		const settings = await readJsonFile(settingsFile);
		const eventHooks = (settings["hooks"] as Record<string, unknown>)["PreToolUse"] as Array<
			Record<string, unknown>
		>;
		const hookEntries = eventHooks.flatMap((h) => h["hooks"] as Array<Record<string, unknown>>);
		const commands = hookEntries.map((e) => e["command"] as string);
		expect(commands.some((c) => c.startsWith("$HOME/.claude/hooks/"))).toBe(true);
		expect(commands.some((c) => c.includes("$CLAUDE_PROJECT_DIR"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// AC-7: byte-equal regression — 프로젝트 분기 emit이 pre-fix baseline과 동일
// ---------------------------------------------------------------------------

describe("AC-7: 프로젝트 분기 hook command가 pre-fix baseline과 byte-equal", () => {
	const hookDisplayName = "test-hook.sh";

	// AC-7a: syncAgentsDirect (L138 site)
	it("AC-7a: `syncAgentsDirect` 프로젝트 분기 hook command가 baseline.syncAgentsDirect_L138과 byte-equal", async () => {
		const sourceFile = path.join(tmpDir, "agent.md");
		await writeFile(sourceFile, "---\nname: agent\n---\n\n# Agent\n");

		const addHooks = [
			{
				event: "SubagentStop",
				matcher: "*",
				type: "command",
				command: "",
				display_name: hookDisplayName,
				timeout: 10,
			},
		];

		// targetPath = mkdtemp/target (not homedir) → isGlobalSync false → project branch
		await adapter.syncAgentsDirect(targetPath, "agent", sourceFile, [], addHooks);

		const agentFile = path.join(targetPath, ".claude", "agents", "agent.md");
		const content = await fs.readFile(agentFile, "utf8");

		const expected = (baseline.syncAgentsDirect_L138 as string).replace(
			"${displayName}",
			hookDisplayName,
		);
		expect(content).toContain(expected);
	});

	// AC-7b: syncPlatformYaml direct file (L442 site)
	it("AC-7b: `syncPlatformYaml` 직접 파일 hook command가 baseline.syncPlatformYaml_L442_direct와 byte-equal", async () => {
		const hookFile = path.join(tmpDir, "test-hook.sh");
		await writeFile(hookFile, "#!/bin/bash\necho hi\n", 0o755);

		await adapter.syncPlatformYaml(
			targetPath,
			{
				hooks: {
					PreToolUse: [
						{
							component: hookFile,
							timeout: 10,
							matcher: "*",
						},
					],
				},
			},
			false,
		);

		const settingsFile = path.join(targetPath, ".claude", "settings.local.json");
		const settings = await readJsonFile(settingsFile);
		const eventHooks = (settings["hooks"] as Record<string, unknown>)["PreToolUse"] as Array<
			Record<string, unknown>
		>;
		const hookEntries = eventHooks.flatMap((h) => h["hooks"] as Array<Record<string, unknown>>);
		const command = hookEntries[0]?.["command"] as string;

		const expected = (baseline.syncPlatformYaml_L442_direct as string).replace(
			"${displayName}",
			hookDisplayName,
		);
		expect(command).toBe(expected);
	});

	// AC-7c: syncPlatformYaml index.ts (L434 site)
	it("AC-7c: `syncPlatformYaml` index.ts hook command가 baseline.syncPlatformYaml_L434_indexTs와 byte-equal", async () => {
		const hookDir = path.join(tmpDir, "test-hook.sh");
		await fs.mkdir(hookDir, { recursive: true });
		await writeFile(path.join(hookDir, "index.ts"), "export {}");

		await adapter.syncPlatformYaml(
			targetPath,
			{
				hooks: {
					Stop: [
						{
							component: hookDir,
							timeout: 60,
							matcher: "*",
						},
					],
				},
			},
			false,
		);

		const settingsFile = path.join(targetPath, ".claude", "settings.local.json");
		const settings = await readJsonFile(settingsFile);
		const stopHooks = (settings["hooks"] as Record<string, unknown>)["Stop"] as Array<
			Record<string, unknown>
		>;
		const hookEntries = stopHooks.flatMap((h) => h["hooks"] as Array<Record<string, unknown>>);
		const command = hookEntries[0]?.["command"] as string;

		const expected = (baseline.syncPlatformYaml_L434_indexTs as string).replace(
			"${displayName}",
			hookDisplayName,
		);
		expect(command).toBe(expected);
	});

	// AC-7d: syncPlatformYaml index.sh (L436 site)
	it("AC-7d: `syncPlatformYaml` index.sh hook command가 baseline.syncPlatformYaml_L436_indexSh와 byte-equal", async () => {
		const hookDir = path.join(tmpDir, "test-hook.sh");
		await fs.mkdir(hookDir, { recursive: true });
		await writeFile(path.join(hookDir, "index.sh"), "#!/bin/bash\necho hi\n", 0o755);

		await adapter.syncPlatformYaml(
			targetPath,
			{
				hooks: {
					UserPromptSubmit: [
						{
							component: hookDir,
							timeout: 10,
							matcher: "*",
						},
					],
				},
			},
			false,
		);

		const settingsFile = path.join(targetPath, ".claude", "settings.local.json");
		const settings = await readJsonFile(settingsFile);
		const eventHooks = (settings["hooks"] as Record<string, unknown>)["UserPromptSubmit"] as Array<
			Record<string, unknown>
		>;
		const hookEntries = eventHooks.flatMap((h) => h["hooks"] as Array<Record<string, unknown>>);
		const command = hookEntries[0]?.["command"] as string;

		const expected = (baseline.syncPlatformYaml_L436_indexSh as string).replace(
			"${displayName}",
			hookDisplayName,
		);
		expect(command).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// destination-branching — 3 사이트 × {global,project} × {fresh,existing} = 12 testcase
// ---------------------------------------------------------------------------
//
// global 분기: spyOn(os, "homedir") → targetPath = os.homedir() = fakeHome
// project 분기: targetPath = mkdtemp/target (비-홈, 기존 패턴)

describe("destination-branching: updateSettings", () => {
	let fakeHome: string;
	let homeSpy: ReturnType<typeof spyOn>;
	let globalTarget: string;

	beforeEach(async () => {
		fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "claude-dest-home-"));
		homeSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);
		globalTarget = os.homedir(); // = fakeHome (mocked)
	});

	afterEach(async () => {
		homeSpy.mockRestore();
		await fs.rm(fakeHome, { recursive: true, force: true });
	});

	// AC-3a
	it("updateSettings global fresh", async () => {
		const hooksEntries = {
			Stop: [{ matcher: "*", hooks: [{ type: "command", command: "/bin/hook.sh", timeout: 10 }] }],
		};

		await adapter.updateSettings(globalTarget, hooksEntries);

		// settings.json created with hooks
		const settingsJson = path.join(globalTarget, ".claude", "settings.json");
		const settings = await readJsonFile(settingsJson);
		expect(settings["hooks"]).toEqual(hooksEntries);

		// settings.local.json NOT created
		const localJson = path.join(globalTarget, ".claude", "settings.local.json");
		expect(await exists(localJson)).toBe(false);
	});

	// AC-3b
	it("updateSettings global existing", async () => {
		const settingsJson = path.join(globalTarget, ".claude", "settings.json");
		await writeFile(settingsJson, JSON.stringify({ model: "x", hooks: { old: [] } }));

		const hooksEntries = {
			Stop: [{ matcher: "*", hooks: [{ type: "command", command: "/bin/hook.sh", timeout: 10 }] }],
		};

		await adapter.updateSettings(globalTarget, hooksEntries);

		const settings = await readJsonFile(settingsJson);
		expect(settings["hooks"]).toEqual(hooksEntries);
		expect(settings["model"]).toBe("x");
	});

	// AC-3c
	it("updateSettings project fresh", async () => {
		const hooksEntries = {
			Stop: [{ matcher: "*", hooks: [{ type: "command", command: "/bin/hook.sh", timeout: 10 }] }],
		};

		await adapter.updateSettings(targetPath, hooksEntries);

		// settings.local.json created
		const localJson = path.join(targetPath, ".claude", "settings.local.json");
		const settings = await readJsonFile(localJson);
		expect(settings["hooks"]).toEqual(hooksEntries);

		// settings.json NOT created
		const settingsJson = path.join(targetPath, ".claude", "settings.json");
		expect(await exists(settingsJson)).toBe(false);
	});

	// AC-3d
	it("updateSettings project existing", async () => {
		const localJson = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(localJson, JSON.stringify({ userLocalKey: "kept", hooks: { old: [] } }));

		const hooksEntries = {
			Stop: [{ matcher: "*", hooks: [{ type: "command", command: "/bin/hook.sh", timeout: 10 }] }],
		};

		await adapter.updateSettings(targetPath, hooksEntries);

		const settings = await readJsonFile(localJson);
		expect(settings["hooks"]).toEqual(hooksEntries);
		expect(settings["userLocalKey"]).toBe("kept");
	});
});

describe("destination-branching: setStatusline", () => {
	let fakeHome: string;
	let homeSpy: ReturnType<typeof spyOn>;
	let globalTarget: string;

	beforeEach(async () => {
		fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "claude-dest-home-"));
		homeSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);
		globalTarget = os.homedir(); // = fakeHome (mocked)
	});

	afterEach(async () => {
		homeSpy.mockRestore();
		await fs.rm(fakeHome, { recursive: true, force: true });
	});

	// AC-4a
	it("setStatusline global fresh", async () => {
		await adapter.setStatusline(globalTarget, "bun run $HOME/.claude/scripts/hud/index.ts");

		const settingsJson = path.join(globalTarget, ".claude", "settings.json");
		const settings = await readJsonFile(settingsJson);
		const statusLine = settings["statusLine"] as Record<string, unknown>;
		expect(statusLine["type"]).toBe("command");
		expect(statusLine["command"]).toBe("bun run $HOME/.claude/scripts/hud/index.ts");

		const localJson = path.join(globalTarget, ".claude", "settings.local.json");
		expect(await exists(localJson)).toBe(false);
	});

	// AC-4b
	it("setStatusline global existing", async () => {
		const settingsJson = path.join(globalTarget, ".claude", "settings.json");
		await writeFile(settingsJson, JSON.stringify({ model: "x" }));

		await adapter.setStatusline(globalTarget, "bun run $HOME/.claude/scripts/hud/index.ts");

		const settings = await readJsonFile(settingsJson);
		const statusLine = settings["statusLine"] as Record<string, unknown>;
		expect(statusLine["type"]).toBe("command");
		expect(statusLine["command"]).toBe("bun run $HOME/.claude/scripts/hud/index.ts");
		expect(settings["model"]).toBe("x");
	});

	// AC-4c
	it("setStatusline project fresh", async () => {
		await adapter.setStatusline(
			targetPath,
			"bun run $CLAUDE_PROJECT_DIR/.claude/scripts/hud/index.ts",
		);

		const localJson = path.join(targetPath, ".claude", "settings.local.json");
		const settings = await readJsonFile(localJson);
		const statusLine = settings["statusLine"] as Record<string, unknown>;
		expect(statusLine["type"]).toBe("command");
		expect(statusLine["command"]).toBe("bun run $CLAUDE_PROJECT_DIR/.claude/scripts/hud/index.ts");

		const settingsJson = path.join(targetPath, ".claude", "settings.json");
		expect(await exists(settingsJson)).toBe(false);
	});

	// AC-4d
	it("setStatusline project existing", async () => {
		const localJson = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(localJson, JSON.stringify({ existingUserKey: "preserved" }));

		await adapter.setStatusline(
			targetPath,
			"bun run $CLAUDE_PROJECT_DIR/.claude/scripts/hud/index.ts",
		);

		const settings = await readJsonFile(localJson);
		const statusLine = settings["statusLine"] as Record<string, unknown>;
		expect(statusLine["type"]).toBe("command");
		expect(statusLine["command"]).toBe("bun run $CLAUDE_PROJECT_DIR/.claude/scripts/hud/index.ts");
		expect(settings["existingUserKey"]).toBe("preserved");
	});
});

describe("destination-branching: syncConfig", () => {
	let fakeHome: string;
	let homeSpy: ReturnType<typeof spyOn>;
	let globalTarget: string;

	beforeEach(async () => {
		fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "claude-dest-home-"));
		homeSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);
		globalTarget = os.homedir(); // = fakeHome (mocked)
	});

	afterEach(async () => {
		homeSpy.mockRestore();
		await fs.rm(fakeHome, { recursive: true, force: true });
	});

	// AC-5a
	it("syncConfig global fresh", async () => {
		await adapter.syncConfig(globalTarget, { permissions: { deny: ["Bash(rm -rf *)"] } });

		const settingsJson = path.join(globalTarget, ".claude", "settings.json");
		const settings = await readJsonFile(settingsJson);
		expect((settings["permissions"] as Record<string, unknown>)["deny"]).toEqual([
			"Bash(rm -rf *)",
		]);

		const localJson = path.join(globalTarget, ".claude", "settings.local.json");
		expect(await exists(localJson)).toBe(false);
	});

	// AC-5b — Conflict semantics: sync overrides same key, user-only key preserved
	it("syncConfig global existing", async () => {
		const settingsJson = path.join(globalTarget, ".claude", "settings.json");
		await writeFile(
			settingsJson,
			JSON.stringify({
				userOnlyKey: "usersValue",
				permissions: { deny: ["Bash(userDeny)"] },
			}),
		);

		const syncProvidedDenyArray = ["Bash(rm -rf *)"];
		await adapter.syncConfig(globalTarget, { permissions: { deny: syncProvidedDenyArray } });

		const settings = await readJsonFile(settingsJson);
		// sync key overrides user's same key
		expect((settings["permissions"] as Record<string, unknown>)["deny"]).toEqual(
			syncProvidedDenyArray,
		);
		// user-only key preserved
		expect(settings["userOnlyKey"]).toBe("usersValue");
	});

	// AC-5c
	it("syncConfig project fresh", async () => {
		await adapter.syncConfig(targetPath, { permissions: { deny: ["Bash(rm -rf *)"] } });

		const localJson = path.join(targetPath, ".claude", "settings.local.json");
		const settings = await readJsonFile(localJson);
		expect((settings["permissions"] as Record<string, unknown>)["deny"]).toEqual([
			"Bash(rm -rf *)",
		]);

		const settingsJson = path.join(targetPath, ".claude", "settings.json");
		expect(await exists(settingsJson)).toBe(false);
	});

	// AC-5d
	it("syncConfig project existing", async () => {
		const localJson = path.join(targetPath, ".claude", "settings.local.json");
		await writeFile(localJson, JSON.stringify({ userLocalKey: "kept", env: { FOO: "bar" } }));

		await adapter.syncConfig(targetPath, { env: { NEW: "value" } });

		const settings = await readJsonFile(localJson);
		expect(settings["userLocalKey"]).toBe("kept");
		expect((settings["env"] as Record<string, unknown>)["FOO"]).toBe("bar");
		expect((settings["env"] as Record<string, unknown>)["NEW"]).toBe("value");
	});
});

// ---------------------------------------------------------------------------
// AC-11 — dryRun destination 단언 (3 사이트 × {global,project})
// ---------------------------------------------------------------------------

describe("dryRun destination — 3 사이트 파일명 분기 단언", () => {
	let fakeHome: string;
	let homeSpy: ReturnType<typeof spyOn>;
	let globalTarget: string;
	let stderrChunks: string[];
	let stderrSpy: ReturnType<typeof spyOn>;

	beforeEach(async () => {
		fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "claude-dest-home-"));
		homeSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);
		globalTarget = os.homedir(); // = fakeHome (mocked)
		stderrChunks = [];
		stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
			stderrChunks.push(String(chunk));
			return true;
		});
	});

	afterEach(async () => {
		homeSpy.mockRestore();
		stderrSpy.mockRestore();
		await fs.rm(fakeHome, { recursive: true, force: true });
	});

	it("dryRun destination: updateSettings global → settings.json", async () => {
		await adapter.updateSettings(globalTarget, { Stop: [] }, true);
		const combined = stderrChunks.join("");
		expect(combined.includes("settings.json")).toBe(true);
		expect(combined.includes("settings.local.json")).toBe(false);
	});

	it("dryRun destination: updateSettings project → settings.local.json", async () => {
		await adapter.updateSettings(targetPath, { Stop: [] }, true);
		const combined = stderrChunks.join("");
		expect(combined.includes("settings.local.json")).toBe(true);
	});

	it("dryRun destination: setStatusline global → settings.json", async () => {
		await adapter.setStatusline(globalTarget, "bun run hud.ts", true);
		const combined = stderrChunks.join("");
		expect(combined.includes("settings.json")).toBe(true);
		expect(combined.includes("settings.local.json")).toBe(false);
	});

	it("dryRun destination: setStatusline project → settings.local.json", async () => {
		await adapter.setStatusline(targetPath, "bun run hud.ts", true);
		const combined = stderrChunks.join("");
		expect(combined.includes("settings.local.json")).toBe(true);
	});

	it("dryRun destination: syncConfig global → settings.json", async () => {
		await adapter.syncConfig(globalTarget, { env: {} }, true);
		const combined = stderrChunks.join("");
		expect(combined.includes("settings.json")).toBe(true);
		expect(combined.includes("settings.local.json")).toBe(false);
	});

	it("dryRun destination: syncConfig project → settings.local.json", async () => {
		await adapter.syncConfig(targetPath, { env: {} }, true);
		const combined = stderrChunks.join("");
		expect(combined.includes("settings.local.json")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC-6 — Project path SHA256 byte-equal (settings.local.json vs baseline fixture)
// AC-8 — User-level sync: settings.local.json SHA256 불변 (미생성 또는 동일)
// ---------------------------------------------------------------------------

import { createHash } from "crypto";
import settingsBaseline from "./__fixtures__/claude-project-settings-baseline.json";

describe("AC-6: project path settings.local.json SHA256 = baseline fixture", () => {
	it("AC-6: syncConfig + setStatusline + updateSettings 순서 실행 후 settings.local.json이 baseline과 byte-equal", async () => {
		// Reproduce the fixture generation sequence:
		// 1. syncConfig with permissions
		await adapter.syncConfig(targetPath, { permissions: { deny: ["Bash(rm -rf *)"] } });
		// 2. setStatusline
		await adapter.setStatusline(
			targetPath,
			"bun run $CLAUDE_PROJECT_DIR/.claude/scripts/hud/index.ts",
		);
		// 3. updateSettings with hooks
		const hookEntry = [
			{
				matcher: "*",
				hooks: [
					{
						type: "command",
						command: "bun run $CLAUDE_PROJECT_DIR/.claude/hooks/persistent-mode/index.ts",
						timeout: 60,
					},
				],
			},
		];
		await adapter.updateSettings(targetPath, { Stop: hookEntry });

		const producedFile = path.join(targetPath, ".claude", "settings.local.json");
		const producedContent = await fs.readFile(producedFile, "utf8");
		const producedObj = JSON.parse(producedContent) as Record<string, unknown>;

		// Compare structure to baseline fixture (loaded as JSON object — byte-equal via JSON roundtrip)
		expect(producedObj["hooks"]).toEqual((settingsBaseline as Record<string, unknown>)["hooks"]);
		expect(producedObj["statusLine"]).toEqual(
			(settingsBaseline as Record<string, unknown>)["statusLine"],
		);
		expect(producedObj["permissions"]).toEqual(
			(settingsBaseline as Record<string, unknown>)["permissions"],
		);
	});
});

describe("AC-8: user-level sync does not touch settings.local.json", () => {
	let fakeHome: string;
	let homeSpy: ReturnType<typeof spyOn>;
	let globalTarget: string;

	beforeEach(async () => {
		fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "claude-dest-home-"));
		homeSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);
		globalTarget = os.homedir(); // = fakeHome (mocked)
	});

	afterEach(async () => {
		homeSpy.mockRestore();
		await fs.rm(fakeHome, { recursive: true, force: true });
	});

	it("AC-8: user-level sync 전후 settings.local.json SHA256 불변 (또는 미생성)", async () => {
		const localJson = path.join(globalTarget, ".claude", "settings.local.json");
		const claudeDir = path.join(globalTarget, ".claude");
		await fs.mkdir(claudeDir, { recursive: true });

		// Pre-place a settings.local.json with known content
		const originalContent = JSON.stringify({ userOnly: "preserved" });
		await fs.writeFile(localJson, originalContent, "utf8");
		const beforeHash = createHash("sha256")
			.update(Buffer.from(originalContent, "utf8"))
			.digest("hex");

		// Run all 3 sync operations on global target
		await adapter.updateSettings(globalTarget, { Stop: [] });
		await adapter.setStatusline(globalTarget, "bun run $HOME/.claude/scripts/hud/index.ts");
		await adapter.syncConfig(globalTarget, { permissions: { deny: [] } });

		// settings.local.json must remain untouched
		const afterContent = await fs.readFile(localJson, "utf8");
		const afterHash = createHash("sha256").update(Buffer.from(afterContent, "utf8")).digest("hex");
		expect(afterHash).toBe(beforeHash);
	});
});

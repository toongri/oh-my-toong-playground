#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn, execSync } from "child_process";

import type {
	JobConfig,
	CmdResultsHooks,
	ResumeMemberOpts,
	OrphanJob,
	PgidSnapshot,
} from "./generic-job.ts";
import type { RunOneTurnOpts } from "./worker-utils.ts";
import { splitCommand } from "./worker-utils.ts";
import * as JobUtils from "./job-utils.ts";

// Snapshot the real bindings before any test mocks "./job-utils" — mock.module mutates the
// shared module namespace object in place, so restoring via `() => JobUtils` after a mock
// would hand back the already-mutated object. This pristine copy is the real restore target.
const realJobUtils = { ...JobUtils };
import {
	detectCliType,
	buildAugmentedCommand,
	gcStaleJobs,
	computeStatus,
	buildUiPayload,
	buildManifest,
	spawnWorkers,
	cmdWait,
	cmdResults,
	cmdStop,
	cmdClean,
	cmdCollect,
	COLLECT_MAX_WAIT_MS,
	resolveCollectWaitMs,
	resolveCollectNextAction,
	cmdResumeMember,
	assertMembersOrExit,
	assertDenyEnforceable,
	assertDenyShape,
	extractDenySkills,
	extractDenySubagents,
	assertMcpAllowShape,
	enumerateConfiguredMcpServers,
	computeMcpBlockList,
	prepareMcpEntities,
	findOrphanJobs,
	reapOrphanJobs,
	doctorOrphanJobs,
	judgePgidSignal,
	pgidVerdictReason,
	findActiveMembers,
} from "./generic-job.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "generic-job-test-"));
}

const chunkReviewConfig: JobConfig = {
	entitySingular: "member",
	entityPlural: "members",
	entityDirName: "members",
	jobPrefix: "chunk-review-",
	uiLabel: "[Chunk Review]",
	configTopLevelKey: "chunk-review",
};

const councilConfig: JobConfig = {
	entitySingular: "member",
	entityPlural: "members",
	entityDirName: "members",
	jobPrefix: "council-",
	uiLabel: "[Council]",
	configTopLevelKey: "council",
};

const specReviewConfig: JobConfig = {
	entitySingular: "member",
	entityPlural: "members",
	entityDirName: "members",
	jobPrefix: "spec-review-",
	uiLabel: "[Spec Review]",
	configTopLevelKey: "spec-review",
};

// ---------------------------------------------------------------------------
// exports presence
// ---------------------------------------------------------------------------

describe("module exports", () => {
	test("exports detectCliType", () => {
		expect(typeof detectCliType).toBe("function");
	});

	test("exports buildAugmentedCommand", () => {
		expect(typeof buildAugmentedCommand).toBe("function");
	});

	test("exports gcStaleJobs", () => {
		expect(typeof gcStaleJobs).toBe("function");
	});

	test("exports computeStatus", () => {
		expect(typeof computeStatus).toBe("function");
	});

	test("exports buildUiPayload", () => {
		expect(typeof buildUiPayload).toBe("function");
	});

	test("exports buildManifest", () => {
		expect(typeof buildManifest).toBe("function");
	});

	test("exports spawnWorkers", () => {
		expect(typeof spawnWorkers).toBe("function");
	});

	test("exports cmdWait", () => {
		expect(typeof cmdWait).toBe("function");
	});

	test("exports cmdResults", () => {
		expect(typeof cmdResults).toBe("function");
	});

	test("exports cmdStop", () => {
		expect(typeof cmdStop).toBe("function");
	});

	test("exports cmdClean", () => {
		expect(typeof cmdClean).toBe("function");
	});

	test("exports cmdCollect", () => {
		expect(typeof cmdCollect).toBe("function");
	});

	test("exports cmdResumeMember", () => {
		expect(typeof cmdResumeMember).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// detectCliType
// ---------------------------------------------------------------------------

describe("detectCliType", () => {
	test('returns "claude" for "claude -p"', () => {
		expect(detectCliType("claude -p")).toBe("claude");
	});

	test('returns "codex" for "codex exec"', () => {
		expect(detectCliType("codex exec")).toBe("codex");
	});

	test('returns "gemini" for bare "gemini"', () => {
		expect(detectCliType("gemini")).toBe("gemini");
	});

	test('returns "unknown" for unrecognized command', () => {
		expect(detectCliType("my-script")).toBe("unknown");
	});

	test('returns "unknown" for null', () => {
		expect(detectCliType(null)).toBe("unknown");
	});

	test('returns "unknown" for empty string', () => {
		expect(detectCliType("")).toBe("unknown");
	});

	test('returns "unknown" for undefined', () => {
		expect(detectCliType(undefined)).toBe("unknown");
	});

	test('returns "claude" when command has leading whitespace', () => {
		expect(detectCliType("  claude --model opus")).toBe("claude");
	});

	test('returns "claude" for "npx claude --model opus"', () => {
		expect(detectCliType("npx claude --model opus")).toBe("claude");
	});

	test('returns "gemini" for "bunx gemini"', () => {
		expect(detectCliType("bunx gemini")).toBe("gemini");
	});

	test('returns "codex" for "pnpm dlx codex"', () => {
		expect(detectCliType("pnpm dlx codex")).toBe("codex");
	});

	test('returns "unknown" when cli name appears after the 3rd token', () => {
		expect(detectCliType("echo hello claude")).toBe("unknown");
	});

	test("detects opencode", () => {
		expect(detectCliType("opencode run --agent foo")).toBe("opencode");
	});

	test("detects opencode via package runner", () => {
		expect(detectCliType("bunx opencode run")).toBe("opencode");
	});

	test("detectCliType env-prefix returns unknown", () => {
		expect(detectCliType("env FOO=bar opencode run --agent foo")).toBe("unknown");
	});
});

// ---------------------------------------------------------------------------
// buildAugmentedCommand
// ---------------------------------------------------------------------------

describe("buildAugmentedCommand", () => {
	test("claude: appends --model and --output-format, sets env for effort_level", () => {
		const result = buildAugmentedCommand(
			{ command: "claude -p", model: "opus", effort_level: "high", output_format: "json" },
			"claude",
		);
		expect(result.command).toBe("claude -p --model opus --output-format json");
		expect(result.env).toEqual({ CLAUDECODE: "", CLAUDE_CODE_EFFORT_LEVEL: "high" });
	});

	test("codex: appends -m, -c for effort, --json for output_format", () => {
		const result = buildAugmentedCommand(
			{ command: "codex exec", model: "o3", effort_level: "high", output_format: "json" },
			"codex",
		);
		expect(result.command).toBe("codex exec -m o3 -c model_reasoning_effort=high --json");
		expect(result.env).toEqual({});
	});

	test("gemini: appends --model, ignores effort_level", () => {
		const result = buildAugmentedCommand(
			{ command: "gemini", model: "gemini-2.5-pro", effort_level: "high" },
			"gemini",
		);
		expect(result.command).toBe("gemini --model gemini-2.5-pro");
		expect(result.env).toEqual({});
	});

	test("gemini: appends --output-format for json", () => {
		const result = buildAugmentedCommand({ command: "gemini", output_format: "json" }, "gemini");
		expect(result.command).toBe("gemini --output-format json");
		expect(result.env).toEqual({});
	});

	test("claude: no fields — returns command unchanged with CLAUDECODE guard", () => {
		const result = buildAugmentedCommand({ command: "claude -p" }, "claude");
		expect(result.command).toBe("claude -p");
		expect(result.env).toEqual({ CLAUDECODE: "" });
	});

	test("claude: falsy values (empty string, null) treated as absent", () => {
		const result = buildAugmentedCommand(
			{ command: "claude -p", model: "", effort_level: null },
			"claude",
		);
		expect(result.command).toBe("claude -p");
		expect(result.env).toEqual({ CLAUDECODE: "" });
	});

	test("claude: falsy values (undefined) treated as absent", () => {
		const result = buildAugmentedCommand(
			{ command: "claude -p", model: undefined, effort_level: undefined, output_format: undefined },
			"claude",
		);
		expect(result.command).toBe("claude -p");
		expect(result.env).toEqual({ CLAUDECODE: "" });
	});

	test("unknown CLI type: only appends --model, ignores effort and output_format", () => {
		const result = buildAugmentedCommand(
			{ command: "my-script", model: "gpt-4", effort_level: "high", output_format: "json" },
			"unknown",
		);
		expect(result.command).toBe("my-script --model gpt-4");
		expect(result.env).toEqual({});
	});

	test('output_format "text" is ignored (no flag appended)', () => {
		const result = buildAugmentedCommand({ command: "claude -p", output_format: "text" }, "claude");
		expect(result.command).toBe("claude -p");
		expect(result.env).toEqual({ CLAUDECODE: "" });
	});

	test("codex output_format non-json still appends --json", () => {
		const result = buildAugmentedCommand(
			{ command: "codex exec", output_format: "stream" },
			"codex",
		);
		expect(result.command).toBe("codex exec --json");
		expect(result.env).toEqual({});
	});

	test("claude: unsets CLAUDECODE env to prevent nested session error", () => {
		const result = buildAugmentedCommand({ command: "claude -p" }, "claude");
		expect(result.env.CLAUDECODE).toBe("");
	});

	test("non-claude: does not include CLAUDECODE in env", () => {
		const result = buildAugmentedCommand({ command: "gemini" }, "gemini");
		expect(result.env.CLAUDECODE as string | undefined).toBe(undefined);
	});

	test("opencode appends --variant for effort_level", () => {
		const result = buildAugmentedCommand(
			{ command: "opencode run", model: "openai/gpt-5.5", effort_level: "high" },
			"opencode",
		);
		expect(result.command).toBe("opencode run --model openai/gpt-5.5 --variant high");
		expect(result.env).toEqual({});
	});

	test("opencode without effort_level has no --variant", () => {
		const result = buildAugmentedCommand(
			{ command: "opencode run", model: "openai/gpt-5.5" },
			"opencode",
		);
		expect(result.command).toBe("opencode run --model openai/gpt-5.5");
	});

	test("buildAugmentedCommand entity.env merge", () => {
		const result = buildAugmentedCommand(
			{ command: "opencode run", env: { OPENSEARCH_DISABLED_TOOLS: "CountTool" } },
			"opencode",
		);
		expect(result.env.OPENSEARCH_DISABLED_TOOLS).toBe("CountTool");
	});

	test("buildAugmentedCommand framework env precedence", () => {
		const result = buildAugmentedCommand(
			{ command: "claude -p", env: { CLAUDECODE: "evil" } },
			"claude",
		);
		expect(result.env.CLAUDECODE).toBe("");
	});

	test("buildAugmentedCommand env optional", () => {
		const resultUndefined = buildAugmentedCommand({ command: "claude -p" }, "claude");
		expect(resultUndefined.env.CLAUDECODE).toBe("");

		const resultEmpty = buildAugmentedCommand({ command: "claude -p", env: {} }, "claude");
		expect(resultEmpty.env.CLAUDECODE).toBe("");
	});

	test("codex: deny translates to -c skills.config with enabled=false entries (quotes escaped for transport)", () => {
		const result = buildAugmentedCommand({ command: "codex exec", deny: ["a", "b"] }, "codex");
		expect(result.command).toContain(
			'-c skills.config=[{name=\\"a\\",enabled=false},{name=\\"b\\",enabled=false}]',
		);
	});

	test("claude: deny translates to --settings skillOverrides off (quotes escaped for transport)", () => {
		const result = buildAugmentedCommand({ command: "claude -p", deny: ["a"] }, "claude");
		expect(result.command).toContain('--settings {\\"skillOverrides\\":{\\"a\\":\\"off\\"}}');
	});

	// ---------------------------------------------------------------------------
	// Round-trip identity: buildAugmentedCommand's output must survive splitCommand
	// re-tokenization unchanged, because spawnWorkers hands augmented.command to a
	// worker as a --command argv, and the worker re-tokenizes it with splitCommand
	// before spawning (no second shell parse exists anywhere in this pipeline).
	// ---------------------------------------------------------------------------

	test("round-trip: codex deny -c token survives splitCommand with quotes intact", () => {
		const result = buildAugmentedCommand({ command: "codex exec", deny: ["a", "b"] }, "codex");
		const tokens = splitCommand(result.command);
		expect(tokens).not.toBeNull();
		const cIndex = tokens!.indexOf("-c");
		expect(cIndex).toBeGreaterThanOrEqual(0);
		expect(tokens![cIndex + 1]).toBe(
			'skills.config=[{name="a",enabled=false},{name="b",enabled=false}]',
		);
	});

	test("round-trip: claude deny --settings token survives splitCommand as valid JSON", () => {
		const result = buildAugmentedCommand({ command: "claude -p", deny: ["a"] }, "claude");
		const tokens = splitCommand(result.command);
		expect(tokens).not.toBeNull();
		const settingsIndex = tokens!.indexOf("--settings");
		expect(settingsIndex).toBeGreaterThanOrEqual(0);
		const parsed = JSON.parse(tokens![settingsIndex + 1]);
		expect(parsed.skillOverrides.a).toBe("off");
	});

	test("round-trip: codex deny with 2+ names has every quote pair escaped, not partial", () => {
		const result = buildAugmentedCommand(
			{ command: "codex exec", deny: ["alpha", "beta", "gamma"] },
			"codex",
		);
		const tokens = splitCommand(result.command);
		expect(tokens).not.toBeNull();
		const cIndex = tokens!.indexOf("-c");
		expect(tokens![cIndex + 1]).toBe(
			'skills.config=[{name="alpha",enabled=false},{name="beta",enabled=false},{name="gamma",enabled=false}]',
		);
	});

	test("round-trip: claude deny with 2+ names has every quote pair escaped, not partial", () => {
		const result = buildAugmentedCommand(
			{ command: "claude -p", deny: ["alpha", "beta"] },
			"claude",
		);
		const tokens = splitCommand(result.command);
		expect(tokens).not.toBeNull();
		const settingsIndex = tokens!.indexOf("--settings");
		const parsed = JSON.parse(tokens![settingsIndex + 1]);
		expect(parsed.skillOverrides).toEqual({ alpha: "off", beta: "off" });
	});

	test("round-trip: opencode deny bypasses splitCommand entirely — env-only, no command trace", () => {
		const result = buildAugmentedCommand({ command: "opencode run", deny: ["a"] }, "opencode");
		expect(result.command).toBe("opencode run");
		expect(result.command).not.toContain("a");
		expect(result.env.OPENCODE_CONFIG_CONTENT).toBeTruthy();
		const tokens = splitCommand(result.command);
		expect(tokens).toEqual(["opencode", "run"]);
	});

	test("round-trip: no deny leaves splitCommand output unchanged from pre-escaping behavior", () => {
		const result = buildAugmentedCommand({ command: "claude -p", model: "opus" }, "claude");
		expect(splitCommand(result.command)).toEqual(["claude", "-p", "--model", "opus"]);
	});

	test("opencode: deny translates to OPENCODE_CONFIG_CONTENT env with permission.skill deny + wildcard allow", () => {
		const result = buildAugmentedCommand({ command: "opencode run", deny: ["a"] }, "opencode");
		expect(result.env.OPENCODE_CONFIG_CONTENT).toBeTruthy();
		const parsed = JSON.parse(result.env.OPENCODE_CONFIG_CONTENT);
		expect(parsed.permission.skill.a).toBe("deny");
		expect(parsed.permission.skill["*"]).toBe("allow");
	});

	// OPENCODE_CONFIG_CONTENT carries opencode's whole inline config, not just permissions,
	// and reaches the CLI from two independent inputs. A bare assignment silently drops the
	// member's provider/model/mcp settings, so both inputs are covered here — checking only
	// the `env:` axis would leave the ambient-environment axis unmeasured.
	describe("opencode deny preserves an inherited OPENCODE_CONFIG_CONTENT", () => {
		const originalInherited = process.env.OPENCODE_CONFIG_CONTENT;
		afterEach(() => {
			if (originalInherited === undefined) delete process.env.OPENCODE_CONFIG_CONTENT;
			else process.env.OPENCODE_CONFIG_CONTENT = originalInherited;
		});

		test("member `env:` axis — provider/model and other permission keys survive", () => {
			const result = buildAugmentedCommand(
				{
					command: "opencode run",
					deny: ["orchestrate-review"],
					env: {
						OPENCODE_CONFIG_CONTENT: JSON.stringify({
							provider: { anthropic: { apiKey: "x" } },
							model: "opencode-go/glm-5.2",
							permission: { bash: "ask", skill: { "existing-skill": "allow" } },
						}),
					},
				},
				"opencode",
			);
			const parsed = JSON.parse(result.env.OPENCODE_CONFIG_CONTENT);
			expect(parsed.provider).toEqual({ anthropic: { apiKey: "x" } });
			expect(parsed.model).toBe("opencode-go/glm-5.2");
			expect(parsed.permission.bash).toBe("ask");
			expect(parsed.permission.skill["existing-skill"]).toBe("allow");
			expect(parsed.permission.skill["orchestrate-review"]).toBe("deny");
		});

		test("ambient process.env axis — workerEnv wins at spawn, so it must merge here too", () => {
			process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: "ambient/model" });
			const result = buildAugmentedCommand(
				{ command: "opencode run", deny: ["agent-council"] },
				"opencode",
			);
			const parsed = JSON.parse(result.env.OPENCODE_CONFIG_CONTENT);
			expect(parsed.model).toBe("ambient/model");
			expect(parsed.permission.skill["agent-council"]).toBe("deny");
		});

		test("an inherited '*: deny' default is not widened to allow", () => {
			const result = buildAugmentedCommand(
				{
					command: "opencode run",
					deny: ["orchestrate-review"],
					env: {
						OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { skill: { "*": "deny" } } }),
					},
				},
				"opencode",
			);
			const parsed = JSON.parse(result.env.OPENCODE_CONFIG_CONTENT);
			expect(parsed.permission.skill["*"]).toBe("deny");
			expect(parsed.permission.skill["orchestrate-review"]).toBe("deny");
		});

		test("unparseable inherited config still enforces deny", () => {
			process.env.OPENCODE_CONFIG_CONTENT = "{not json";
			const result = buildAugmentedCommand(
				{ command: "opencode run", deny: ["agent-council"] },
				"opencode",
			);
			const parsed = JSON.parse(result.env.OPENCODE_CONFIG_CONTENT);
			expect(parsed.permission.skill["agent-council"]).toBe("deny");
			expect(parsed.permission.skill["*"]).toBe("allow");
		});
	});

	// A plain object literal ({}) has Object.prototype as its prototype, so assigning
	// a key literally named "__proto__" hits the inherited accessor instead of creating
	// an own data property — the name silently vanishes from JSON.stringify. claude's
	// skillOverrides and opencode's permission.skill must build on a null-prototype
	// object (Object.create(null)) so a "__proto__"-named deny entry survives as a real key.
	test("deny with a __proto__-named skill survives as an own key for claude and opencode", () => {
		const claudeResult = buildAugmentedCommand(
			{ command: "claude -p", deny: ["__proto__", "normal-skill"] },
			"claude",
		);
		const claudeTokens = splitCommand(claudeResult.command);
		expect(claudeTokens).not.toBeNull();
		const settingsIndex = claudeTokens!.indexOf("--settings");
		const claudeParsed = JSON.parse(claudeTokens![settingsIndex + 1]);
		expect(Object.prototype.hasOwnProperty.call(claudeParsed.skillOverrides, "__proto__")).toBe(
			true,
		);
		expect(claudeParsed.skillOverrides.__proto__).toBe("off");
		expect(claudeParsed.skillOverrides["normal-skill"]).toBe("off");

		const opencodeResult = buildAugmentedCommand(
			{ command: "opencode run", deny: ["__proto__", "normal-skill"] },
			"opencode",
		);
		const opencodeParsed = JSON.parse(opencodeResult.env.OPENCODE_CONFIG_CONTENT);
		expect(Object.prototype.hasOwnProperty.call(opencodeParsed.permission.skill, "__proto__")).toBe(
			true,
		);
		expect(opencodeParsed.permission.skill.__proto__).toBe("deny");
		expect(opencodeParsed.permission.skill["normal-skill"]).toBe("deny");
		expect(opencodeParsed.permission.skill["*"]).toBe("allow");
	});

	test("deny absent or empty is byte-identical to not passing deny at all (codex/claude/opencode)", () => {
		for (const [command, cliType] of [
			["codex exec", "codex"],
			["claude -p", "claude"],
			["opencode run", "opencode"],
		] as const) {
			const withoutDeny = buildAugmentedCommand({ command }, cliType);
			const withUndefinedDeny = buildAugmentedCommand({ command, deny: undefined }, cliType);
			const withEmptyDeny = buildAugmentedCommand({ command, deny: [] }, cliType);
			expect(withUndefinedDeny).toEqual(withoutDeny);
			expect(withEmptyDeny).toEqual(withoutDeny);
		}
	});

	// ---------------------------------------------------------------------------
	// denySubagents — the subagent axis of settings.deny. Same "declarable =
	// enforceable" shape as deny.skills, but a different lever per CLI: codex
	// strips the spawn tools from the session, claude denies the spawn tool by
	// name, opencode denies the `task` permission.
	// ---------------------------------------------------------------------------

	test("codex: denySubagents translates to -c agents.enabled=false", () => {
		const result = buildAugmentedCommand({ command: "codex exec", denySubagents: true }, "codex");
		expect(result.command).toContain("-c agents.enabled=false");
	});

	test("claude: denySubagents translates to --settings permissions.deny of the spawn tool", () => {
		const result = buildAugmentedCommand({ command: "claude -p", denySubagents: true }, "claude");
		const tokens = splitCommand(result.command);
		expect(tokens).not.toBeNull();
		const settingsIndex = tokens!.indexOf("--settings");
		expect(settingsIndex).toBeGreaterThanOrEqual(0);
		const parsed = JSON.parse(tokens![settingsIndex + 1]);
		// Both names: the spawn tool is `Agent` on current claude, `Task` on older builds.
		expect(parsed.permissions.deny).toEqual(["Agent", "Task"]);
	});

	// claude accepts a single --settings argument; a second one replaces the first rather
	// than merging, so emitting one token per axis would silently drop the skill deny.
	test("claude: denySubagents + deny skills share ONE --settings token", () => {
		const result = buildAugmentedCommand(
			{ command: "claude -p", deny: ["a"], denySubagents: true },
			"claude",
		);
		const tokens = splitCommand(result.command);
		expect(tokens!.filter((t) => t === "--settings").length).toBe(1);
		const settingsIndex = tokens!.indexOf("--settings");
		const parsed = JSON.parse(tokens![settingsIndex + 1]);
		expect(parsed.skillOverrides.a).toBe("off");
		expect(parsed.permissions.deny).toEqual(["Agent", "Task"]);
	});

	test("opencode: denySubagents translates to OPENCODE_CONFIG_CONTENT permission.task deny", () => {
		const result = buildAugmentedCommand(
			{ command: "opencode run", denySubagents: true },
			"opencode",
		);
		expect(result.command).toBe("opencode run");
		const parsed = JSON.parse(result.env.OPENCODE_CONFIG_CONTENT);
		expect(parsed.permission.task).toBe("deny");
	});

	test("opencode: denySubagents + deny skills land in the same permission object", () => {
		const result = buildAugmentedCommand(
			{ command: "opencode run", deny: ["a"], denySubagents: true },
			"opencode",
		);
		const parsed = JSON.parse(result.env.OPENCODE_CONFIG_CONTENT);
		expect(parsed.permission.task).toBe("deny");
		expect(parsed.permission.skill.a).toBe("deny");
		expect(parsed.permission.skill["*"]).toBe("allow");
	});

	test("opencode: denySubagents preserves an inherited OPENCODE_CONFIG_CONTENT", () => {
		const result = buildAugmentedCommand(
			{
				command: "opencode run",
				denySubagents: true,
				env: {
					OPENCODE_CONFIG_CONTENT: JSON.stringify({
						model: "provider/model",
						permission: { bash: "allow" },
					}),
				},
			},
			"opencode",
		);
		const parsed = JSON.parse(result.env.OPENCODE_CONFIG_CONTENT);
		expect(parsed.model).toBe("provider/model");
		expect(parsed.permission.bash).toBe("allow");
		expect(parsed.permission.task).toBe("deny");
	});

	test("gemini/unknown: denySubagents is a no-op (no lever — enforceability is the start gate's job)", () => {
		for (const [command, cliType] of [
			["gemini", "gemini"],
			["mycli run", "unknown"],
		] as const) {
			const result = buildAugmentedCommand({ command, denySubagents: true }, cliType);
			expect(result).toEqual(buildAugmentedCommand({ command }, cliType));
		}
	});

	test("denySubagents absent or false is byte-identical to not passing it (codex/claude/opencode)", () => {
		for (const [command, cliType] of [
			["codex exec", "codex"],
			["claude -p", "claude"],
			["opencode run", "opencode"],
		] as const) {
			const without = buildAugmentedCommand({ command }, cliType);
			expect(buildAugmentedCommand({ command, denySubagents: undefined }, cliType)).toEqual(without);
			expect(buildAugmentedCommand({ command, denySubagents: false }, cliType)).toEqual(without);
		}
	});

	test("codex: mcpBlock translates to -c mcp_servers.<name>.enabled=false per blocked name", () => {
		const result = buildAugmentedCommand(
			{ command: "codex exec", mcpBlock: ["linear", "slack"] },
			"codex",
		);
		expect(result.command).toBe(
			"codex exec -c mcp_servers.linear.enabled=false -c mcp_servers.slack.enabled=false",
		);
	});

	test("claude: mcpBlock is ignored (negative control — codex-only lever)", () => {
		const result = buildAugmentedCommand(
			{ command: "claude -p", mcpBlock: ["linear", "slack"] },
			"claude",
		);
		expect(result.command).toBe("claude -p");
		expect(result.command).not.toContain("mcp_servers");
	});

	test("codex: mcpBlock absent or empty leaves command unchanged", () => {
		const withoutMcpBlock = buildAugmentedCommand({ command: "codex exec" }, "codex");
		const withEmptyMcpBlock = buildAugmentedCommand(
			{ command: "codex exec", mcpBlock: [] },
			"codex",
		);
		expect(withoutMcpBlock.command).toBe("codex exec");
		expect(withEmptyMcpBlock.command).toBe("codex exec");
	});
});

// ---------------------------------------------------------------------------
// assertMcpAllowShape — settings.mcps.allow format validation
// ---------------------------------------------------------------------------

describe("assertMcpAllowShape", () => {
	let originalExit: typeof process.exit;
	let originalStderrWrite: typeof process.stderr.write;
	let stderrOutput: string;

	beforeEach(() => {
		originalExit = process.exit;
		originalStderrWrite = process.stderr.write;
		stderrOutput = "";
		(process as any).exit = (code?: number) => {
			throw new Error(`process.exit(${code})`);
		};
		(process.stderr.write as any) = (chunk: string) => {
			stderrOutput += chunk;
			return true;
		};
	});

	afterEach(() => {
		process.exit = originalExit;
		process.stderr.write = originalStderrWrite;
	});

	test("mcps 미지정(undefined)이면 통과한다", () => {
		expect(() => assertMcpAllowShape({}, councilConfig, "/path/to/config.yaml")).not.toThrow();
	});

	test("mcps가 null이면 통과한다", () => {
		expect(() =>
			assertMcpAllowShape({ mcps: null }, councilConfig, "/path/to/config.yaml"),
		).not.toThrow();
	});

	test("mcps가 배열이면 exit 1이다", () => {
		expect(() =>
			assertMcpAllowShape({ mcps: ["codegraph"] }, councilConfig, "/path/to/config.yaml"),
		).toThrow("process.exit(1)");
		expect(stderrOutput).toContain("council.settings.mcps");
		expect(stderrOutput).toContain("must be a mapping/object");
	});

	test("mcps.allow 미지정(undefined)이면 통과한다", () => {
		expect(() =>
			assertMcpAllowShape({ mcps: {} }, councilConfig, "/path/to/config.yaml"),
		).not.toThrow();
	});

	test("mcps.allow가 null이면 통과한다", () => {
		expect(() =>
			assertMcpAllowShape({ mcps: { allow: null } }, councilConfig, "/path/to/config.yaml"),
		).not.toThrow();
	});

	test("mcps.allow가 문자열이면 exit 1이다", () => {
		expect(() =>
			assertMcpAllowShape(
				{ mcps: { allow: "codegraph" } },
				councilConfig,
				"/path/to/config.yaml",
			),
		).toThrow("process.exit(1)");
		expect(stderrOutput).toContain("council.settings.mcps.allow");
		expect(stderrOutput).toContain("must be a list/array of non-empty strings");
	});

	test("mcps.allow 원소에 '.'이 섞이면 exit 1이다", () => {
		expect(() =>
			assertMcpAllowShape(
				{ mcps: { allow: ["mcp_servers.nutrition-tools"] } },
				councilConfig,
				"/path/to/config.yaml",
			),
		).toThrow("process.exit(1)");
		expect(stderrOutput).toContain("must contain only [a-zA-Z0-9_-] MCP server names");
	});

	test("mcps.allow 원소에 '/'가 섞이면 exit 1이다", () => {
		expect(() =>
			assertMcpAllowShape(
				{ mcps: { allow: ["codegraph/evil"] } },
				councilConfig,
				"/path/to/config.yaml",
			),
		).toThrow("process.exit(1)");
	});

	test("유효한 mcps.allow 배열은 통과한다", () => {
		expect(() =>
			assertMcpAllowShape(
				{ mcps: { allow: ["codegraph", "linear-mcp", "slack_bot"] } },
				councilConfig,
				"/path/to/config.yaml",
			),
		).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// enumerateConfiguredMcpServers — parse [mcp_servers.<name>] headers from
// codexHome/config.toml
// ---------------------------------------------------------------------------

describe("enumerateConfiguredMcpServers", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// Regression test for the sub-table trap: a config may contain
	// [mcp_servers.nutrition-tools] followed by [mcp_servers.nutrition-tools.env]
	// — the .env suffix is a nested table (env vars for the nutrition-tools
	// server), not a second server named "nutrition-tools.env". A looser
	// `^\[mcp_servers\.(.+)\]$` regex would capture "nutrition-tools.env" as its
	// own server name.
	test("하위 테이블([mcp_servers.nutrition-tools.env])을 서버로 오인하지 않는다", () => {
		fs.writeFileSync(
			path.join(tmpDir, "config.toml"),
			[
				"[mcp_servers.nutrition-tools]",
				'command = "npx"',
				"",
				"[mcp_servers.nutrition-tools.env]",
				'FOO = "bar"',
				"",
			].join("\n"),
		);

		const result = enumerateConfiguredMcpServers(tmpDir);

		expect(result).toEqual(["nutrition-tools"]);
		expect(result).not.toContain("nutrition-tools.env");
	});

	test("여러 서버를 정렬된 중복없는 배열로 열거한다", () => {
		fs.writeFileSync(
			path.join(tmpDir, "config.toml"),
			[
				"[mcp_servers.slack]",
				'command = "npx"',
				"",
				"[mcp_servers.codegraph]",
				'command = "npx"',
				"",
				"[mcp_servers.linear]",
				'command = "npx"',
				"",
			].join("\n"),
		);

		expect(enumerateConfiguredMcpServers(tmpDir)).toEqual(["codegraph", "linear", "slack"]);
	});

	test("따옴표 붙은 헤더는 열거하지 않는다", () => {
		fs.writeFileSync(
			path.join(tmpDir, "config.toml"),
			['[mcp_servers."weird name"]', 'command = "npx"', "", "[mcp_servers.codegraph]", ""].join(
				"\n",
			),
		);

		expect(enumerateConfiguredMcpServers(tmpDir)).toEqual(["codegraph"]);
	});

	test("config.toml이 없으면 빈 배열을 반환한다 (fail-open)", () => {
		expect(enumerateConfiguredMcpServers(path.join(tmpDir, "does-not-exist"))).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// computeMcpBlockList — configuredNames minus settings.mcps.allow
// ---------------------------------------------------------------------------

describe("computeMcpBlockList", () => {
	test("fail-closed: settings.mcps가 없으면 configuredNames 전부가 차단목록이다", () => {
		expect(computeMcpBlockList({}, ["codegraph", "linear", "slack"])).toEqual([
			"codegraph",
			"linear",
			"slack",
		]);
	});

	test("fail-closed: mcps.allow가 빈 배열이어도 전부 차단된다", () => {
		expect(computeMcpBlockList({ mcps: { allow: [] } }, ["codegraph", "linear"])).toEqual([
			"codegraph",
			"linear",
		]);
	});

	test("화이트리스트 동작: allow에 없는 이름만 차단된다", () => {
		expect(
			computeMcpBlockList({ mcps: { allow: ["codegraph"] } }, ["codegraph", "linear", "slack"]),
		).toEqual(["linear", "slack"]);
	});

	// Regression test for the subset invariant: an allow entry with no matching
	// configured server ("ghost") must never leak into the block list. Passing
	// `-c mcp_servers.ghost.enabled=false` for a server codex never declared in
	// config.toml makes codex fail to boot with "Error loading config.toml:
	// invalid transport" — the block list must always be built by filtering
	// configuredNames, never by iterating `allow`.
	test("차단목록은 항상 configuredNames의 부분집합이다 (allow의 ghost 항목이 새어나오지 않는다)", () => {
		const result = computeMcpBlockList(
			{ mcps: { allow: ["codegraph", "ghost"] } },
			["codegraph", "linear"],
		);
		expect(result).toEqual(["linear"]);
		expect(result).not.toContain("ghost");
		for (const name of result) {
			expect(["codegraph", "linear"]).toContain(name);
		}
	});
});

describe("prepareMcpEntities", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = makeTmpDir();
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("malformed mcps.allow is rejected through assertMcpAllowShape", () => {
		const settings = { mcps: { allow: ["bad.name"] } };
		const originalExit = process.exit;
		try {
			(process as any).exit = (code?: number) => {
				throw new Error(`process.exit(${code})`);
			};
			expect(() =>
				prepareMcpEntities(settings, [], councilConfig, "/tmp/config.yaml", tmpDir),
			).toThrow("process.exit(1)");
		} finally {
			process.exit = originalExit;
		}
	});

	test("computes blocks per member CODEX_HOME and preserves input", () => {
		const homeA = path.join(tmpDir, "a");
		const homeB = path.join(tmpDir, "b");
		fs.mkdirSync(homeA);
		fs.mkdirSync(homeB);
		fs.writeFileSync(path.join(homeA, "config.toml"), "[mcp_servers.alpha]\n[mcp_servers.shared]\n");
		fs.writeFileSync(path.join(homeB, "config.toml"), "[mcp_servers.beta]\n[mcp_servers.shared]\n");
		const settings = { mcps: { allow: ["shared"] } };
		const entities = [
			{ name: "a", command: "codex exec", env: { CODEX_HOME: homeA } },
			{ name: "b", command: "codex exec", env: { CODEX_HOME: homeB } },
			{ name: "c", command: "claude -p" },
		];
		const snapshot = structuredClone(entities);
		const result = prepareMcpEntities(settings, entities, councilConfig, "/tmp/config.yaml", tmpDir);
		expect(result).toEqual([
			{ ...entities[0], mcpBlock: ["alpha"] },
			{ ...entities[1], mcpBlock: ["beta"] },
			{ ...entities[2], mcpBlock: [] },
		]);
		expect(entities).toEqual(snapshot);
	});

	test("uses conductor fallback for codex members without CODEX_HOME", () => {
		fs.writeFileSync(path.join(tmpDir, "config.toml"), "[mcp_servers.alpha]\n");
		const result = prepareMcpEntities(
			{ mcps: { allow: [] } },
			[{ name: "a", command: "codex exec" }],
			councilConfig,
			"/tmp/config.yaml",
			tmpDir,
		);
		expect(result[0].mcpBlock).toEqual(["alpha"]);
	});
});

// ---------------------------------------------------------------------------
// gcStaleJobs — parameterized by jobPrefix
// ---------------------------------------------------------------------------

describe("gcStaleJobs", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("deletes chunk-review-* directories older than 1 hour (chunk-review prefix)", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const staleDir = path.join(jobsDir, "chunk-review-stale-001");
		fs.mkdirSync(staleDir, { recursive: true });
		const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
		fs.writeFileSync(
			path.join(staleDir, "job.json"),
			JSON.stringify({ id: "chunk-review-stale-001", createdAt: twoHoursAgo }),
		);

		gcStaleJobs(jobsDir, chunkReviewConfig);

		expect(fs.existsSync(staleDir)).toBe(false);
	});

	test("preserves chunk-review-* directories younger than 1 hour", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const freshDir = path.join(jobsDir, "chunk-review-fresh-001");
		fs.mkdirSync(freshDir, { recursive: true });
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
		fs.writeFileSync(
			path.join(freshDir, "job.json"),
			JSON.stringify({ id: "chunk-review-fresh-001", createdAt: fiveMinutesAgo }),
		);

		gcStaleJobs(jobsDir, chunkReviewConfig);

		expect(fs.existsSync(freshDir)).toBe(true);
	});

	test("skips directories with missing job.json", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const noJsonDir = path.join(jobsDir, "chunk-review-nojson-001");
		fs.mkdirSync(noJsonDir, { recursive: true });

		gcStaleJobs(jobsDir, chunkReviewConfig);

		expect(fs.existsSync(noJsonDir)).toBe(true);
	});

	test("skips directories with malformed job.json", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const badJsonDir = path.join(jobsDir, "chunk-review-badjson-001");
		fs.mkdirSync(badJsonDir, { recursive: true });
		fs.writeFileSync(path.join(badJsonDir, "job.json"), "{{not valid json}}");

		gcStaleJobs(jobsDir, chunkReviewConfig);

		expect(fs.existsSync(badJsonDir)).toBe(true);
	});

	test("skips non-matching-prefix directories using chunk-review prefix", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const otherDir = path.join(jobsDir, "council-other-001");
		fs.mkdirSync(otherDir, { recursive: true });
		const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
		fs.writeFileSync(
			path.join(otherDir, "job.json"),
			JSON.stringify({ id: "council-other-001", createdAt: twoHoursAgo }),
		);

		gcStaleJobs(jobsDir, chunkReviewConfig);

		// council- prefix is NOT matched by chunk-review- filter, so dir preserved
		expect(fs.existsSync(otherDir)).toBe(true);
	});

	test("GC uses council- prefix (council config)", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		// council- prefixed directory that is stale → should be deleted
		const staleCouncilDir = path.join(jobsDir, "council-stale-001");
		fs.mkdirSync(staleCouncilDir, { recursive: true });
		const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
		fs.writeFileSync(
			path.join(staleCouncilDir, "job.json"),
			JSON.stringify({ id: "council-stale-001", createdAt: twoHoursAgo }),
		);

		// chunk-review- prefixed stale directory → should NOT be deleted
		const staleChunkDir = path.join(jobsDir, "chunk-review-stale-001");
		fs.mkdirSync(staleChunkDir, { recursive: true });
		fs.writeFileSync(
			path.join(staleChunkDir, "job.json"),
			JSON.stringify({ id: "chunk-review-stale-001", createdAt: twoHoursAgo }),
		);

		gcStaleJobs(jobsDir, councilConfig);

		expect(fs.existsSync(staleCouncilDir)).toBe(false);
		expect(fs.existsSync(staleChunkDir)).toBe(true);
	});

	test("path traversal guard prevents deletion outside jobsDir", () => {
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const outsideDir = path.join(tmpDir, "outside-target");
		fs.mkdirSync(outsideDir, { recursive: true });
		const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
		fs.writeFileSync(
			path.join(outsideDir, "job.json"),
			JSON.stringify({ id: "chunk-review-symlink", createdAt: twoHoursAgo }),
		);

		const symlinkPath = path.join(jobsDir, "chunk-review-symlink");
		fs.symlinkSync(outsideDir, symlinkPath);

		gcStaleJobs(jobsDir, chunkReviewConfig);

		expect(fs.existsSync(outsideDir)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// computeStatus — parameterized by entityDirName
// ---------------------------------------------------------------------------

describe("computeStatus", () => {
	let tmpDir: string;

	function setupJob(
		jobDir: string,
		jobJson: Record<string, unknown>,
		entities: Record<string, unknown>,
		config: JobConfig,
	) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(jobJson));
		const entitiesDir = path.join(jobDir, config.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		for (const [name, status] of Object.entries(entities)) {
			const dir = path.join(entitiesDir, name);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));
		}
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("returns done overallState when all entities are terminal (reviewer config)", async () => {
		const jobDir = path.join(tmpDir, "job1");
		setupJob(
			jobDir,
			{ id: "test-1" },
			{
				alice: { member: "alice", state: "done", exitCode: 0 },
				bob: { member: "bob", state: "done", exitCode: 0 },
			},
			chunkReviewConfig,
		);
		const result = await computeStatus(jobDir, chunkReviewConfig);
		expect(result.overallState).toBe("done");
		expect(result.counts.total).toBe(2);
		expect(result.counts.done).toBe(2);
		expect(result.counts.running).toBe(0);
	});

	test("keeps an initializing zero-member job non-terminal", async () => {
		const jobDir = makeTmpDir();
		fs.mkdirSync(path.join(jobDir, "members"), { recursive: true });
		fs.writeFileSync(
			path.join(jobDir, "job.json"),
			JSON.stringify({ id: "initializing", state: "initializing", members: [] }),
		);
		const result = await computeStatus(jobDir, chunkReviewConfig);
		expect(result.overallState).toBe("initializing");
		expect(result.counts.total).toBe(0);
	});

	test("recovers initializing jobs only after every declared member has a recognized status", async () => {
		const jobDir = path.join(tmpDir, "job-initializing-recovery");
		setupJob(
			jobDir,
			{ id: "recover-1", state: "initializing", members: [{ name: "alice" }, { name: "bob" }] },
			{
				alice: { member: "alice", state: "done" },
				bob: { member: "bob", state: "running" },
			},
			chunkReviewConfig,
		);
		const result = await computeStatus(jobDir, chunkReviewConfig);
		expect(result.overallState).toBe("running");
	});

	test("keeps initializing when declared and observed member sets are incomplete or invalid", async () => {
		const cases = [
			{
				name: "missing member",
				meta: { members: [{ name: "alice" }, { name: "bob" }] },
				entities: { alice: { member: "alice", state: "done" } },
			},
			{
				name: "unknown state",
				meta: { members: [{ name: "alice" }] },
				entities: { alice: { member: "alice", state: "mystery" } },
			},
			{
				name: "malformed status",
				meta: { members: [{ name: "alice" }] },
				entities: { alice: "not-json-record" },
			},
			{
				name: "duplicate expected names",
				meta: { members: [{ name: "alice" }, { name: "alice" }] },
				entities: { alice: { member: "alice", state: "done" } },
			},
		];
		for (const testCase of cases) {
			const jobDir = path.join(tmpDir, `job-init-${testCase.name.replace(/ /g, "-")}`);
			setupJob(jobDir, { id: testCase.name, state: "initializing", ...testCase.meta }, testCase.entities, chunkReviewConfig);
			const result = await computeStatus(jobDir, chunkReviewConfig);
			expect(result.overallState).toBe("initializing");
		}
	});

	test("returns running overallState when some entities are running", async () => {
		const jobDir = path.join(tmpDir, "job2");
		setupJob(
			jobDir,
			{ id: "test-2" },
			{
				alice: { member: "alice", state: "done", exitCode: 0 },
				bob: { member: "bob", state: "running" },
			},
			chunkReviewConfig,
		);
		const result = await computeStatus(jobDir, chunkReviewConfig);
		expect(result.overallState).toBe("running");
		expect(result.counts.running).toBe(1);
		expect(result.counts.done).toBe(1);
	});

	test("returns queued overallState when only queued (no running)", async () => {
		const jobDir = path.join(tmpDir, "job3");
		setupJob(
			jobDir,
			{ id: "test-3" },
			{
				alice: { member: "alice", state: "queued" },
			},
			chunkReviewConfig,
		);
		const result = await computeStatus(jobDir, chunkReviewConfig);
		expect(result.overallState).toBe("queued");
		expect(result.counts.queued).toBe(1);
	});

	test("awaiting_resume 멤버는 done이 아니라 awaiting_resume으로 보고됨", async () => {
		const jobDir = path.join(tmpDir, "job-awaiting-resume");
		setupJob(
			jobDir,
			{ id: "test-ar" },
			{
				alice: { member: "alice", state: "awaiting_resume" },
			},
			chunkReviewConfig,
		);
		const result = await computeStatus(jobDir, chunkReviewConfig);
		expect(result.overallState).not.toBe("done");
		expect(result.overallState).toBe("awaiting_resume");
	});

	test("counts error states correctly", async () => {
		const jobDir = path.join(tmpDir, "job4");
		setupJob(
			jobDir,
			{ id: "test-4" },
			{
				alice: { member: "alice", state: "error", exitCode: 1 },
				bob: { member: "bob", state: "done", exitCode: 0 },
				carol: { member: "carol", state: "missing_cli" },
			},
			chunkReviewConfig,
		);
		const result = await computeStatus(jobDir, chunkReviewConfig);
		expect(result.overallState).toBe("done");
		expect(result.counts.error).toBe(1);
		expect(result.counts.missing_cli).toBe(1);
		expect(result.counts.done).toBe(1);
	});

	test("uses members/ directory with council config", async () => {
		const jobDir = path.join(tmpDir, "job-council");
		setupJob(
			jobDir,
			{ id: "council-test" },
			{
				alice: { member: "alice", state: "done", exitCode: 0 },
			},
			councilConfig,
		);
		const result = await computeStatus(jobDir, councilConfig);
		expect(result.overallState).toBe("done");
		expect(result.counts.total).toBe(1);
	});

	test("transitions stale queued entity to error when queuedAt exceeds threshold", async () => {
		const jobDir = path.join(tmpDir, "job-stale");
		const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
		setupJob(
			jobDir,
			{ id: "test-stale", settings: { timeoutSec: 30 } },
			{
				alice: { member: "alice", state: "queued", queuedAt: staleTime },
				bob: { member: "bob", state: "done", exitCode: 0 },
			},
			chunkReviewConfig,
		);
		// threshold = Math.max(2 * 30, 120) = 120s; 200s > 120s → stale
		const result = await computeStatus(jobDir, chunkReviewConfig);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("error");
		expect(result.counts.error).toBe(1);
		expect(result.counts.queued).toBe(0);
	});

	test("does not transition queued entity within staleness threshold", async () => {
		const jobDir = path.join(tmpDir, "job-fresh");
		const freshTime = new Date(Date.now() - 10_000).toISOString(); // 10s ago
		setupJob(
			jobDir,
			{ id: "test-fresh", settings: { timeoutSec: 30 } },
			{
				alice: { member: "alice", state: "queued", queuedAt: freshTime },
			},
			chunkReviewConfig,
		);
		// threshold = Math.max(2 * 30, 120) = 120s; 10s < 120s → not stale
		const result = await computeStatus(jobDir, chunkReviewConfig);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("queued");
		expect(result.counts.queued).toBe(1);
	});

	test("uses 120s minimum threshold when timeoutSec is 0", async () => {
		const jobDir = path.join(tmpDir, "job-zero-timeout");
		const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago
		setupJob(
			jobDir,
			{ id: "test-zero", settings: { timeoutSec: 0 } },
			{
				alice: { member: "alice", state: "queued", queuedAt: staleTime },
			},
			chunkReviewConfig,
		);
		// threshold = Math.max(2 * 0, 120) = 120s; 200s > 120s → stale
		const result = await computeStatus(jobDir, chunkReviewConfig);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("error");
	});

	test("transitions stale running entity to error when startedAt exceeds threshold", async () => {
		const jobDir = path.join(tmpDir, "job-run-stale");
		const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
		setupJob(
			jobDir,
			{ id: "test-run-stale", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running", startedAt: staleStart },
				bob: { member: "bob", state: "done", exitCode: 0 },
			},
			chunkReviewConfig,
		);
		// no heartbeat: grace period = HEARTBEAT_GRACE_PERIOD_MS (120s); 200s > 120s → stale
		const result = await computeStatus(jobDir, chunkReviewConfig);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("error");
		expect(result.counts.error).toBe(1);
		expect(result.counts.running).toBe(0);
	});

	test("preserves normal running entity within running threshold", async () => {
		const jobDir = path.join(tmpDir, "job-run-fresh");
		const recentHeartbeat = new Date(Date.now() - 10_000).toISOString(); // 10s ago
		setupJob(
			jobDir,
			{ id: "test-run-fresh", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running", lastHeartbeat: recentHeartbeat },
			},
			chunkReviewConfig,
		);
		// heartbeat 10s ago: HEARTBEAT_STALE_THRESHOLD_MS = 60s; 10s < 60s → not stale
		const result = await computeStatus(jobDir, chunkReviewConfig);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("running");
		expect(result.counts.running).toBe(1);
		expect(result.counts.error).toBe(0);
	});

	test("writes error details to status.json on queued staleness transition", async () => {
		const jobDir = path.join(tmpDir, "job-stale-write");
		const staleTime = new Date(Date.now() - 200_000).toISOString();
		setupJob(
			jobDir,
			{ id: "test-write", settings: { timeoutSec: 30 } },
			{
				alice: { member: "alice", state: "queued", queuedAt: staleTime },
			},
			chunkReviewConfig,
		);
		await computeStatus(jobDir, chunkReviewConfig);
		const statusPath = path.join(jobDir, chunkReviewConfig.entityDirName, "alice", "status.json");
		const written = JSON.parse(fs.readFileSync(statusPath, "utf8"));
		expect(written.state).toBe("error");
		expect(written.error.includes("stale")).toBe(true);
	});

	test("writes error details to status.json on running staleness transition", async () => {
		const jobDir = path.join(tmpDir, "job-run-stale-write");
		const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
		setupJob(
			jobDir,
			{ id: "test-run-stale-write", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running", startedAt: staleStart },
			},
			chunkReviewConfig,
		);
		await computeStatus(jobDir, chunkReviewConfig);
		const statusPath = path.join(jobDir, chunkReviewConfig.entityDirName, "alice", "status.json");
		const written = JSON.parse(fs.readFileSync(statusPath, "utf8"));
		expect(written.state).toBe("error");
		expect(written.error).toContain("heartbeat");
		expect(written.error).toContain("seconds");
	});

	test("CAS guard: does not transition if running worker changed state during re-read", async () => {
		const jobDir = path.join(tmpDir, "job-run-cas");
		const staleStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
		setupJob(
			jobDir,
			{ id: "test-run-cas", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running", startedAt: staleStart },
			},
			chunkReviewConfig,
		);
		// no heartbeat: grace period = HEARTBEAT_GRACE_PERIOD_MS (120s); 200s > 120s → stale
		const statusPath = path.join(jobDir, chunkReviewConfig.entityDirName, "alice", "status.json");
		const donePayload = JSON.stringify({
			member: "alice",
			state: "done",
			startedAt: staleStart,
			exitCode: 0,
		});
		Bun.spawn(["bash", "-c", `sleep 0.1 && printf '%s' '${donePayload}' > "${statusPath}"`]);
		const result = await computeStatus(jobDir, chunkReviewConfig);
		const alice = result.members.find((r) => r.member === "alice");
		// CAS re-read sees 'done' → preserves 'done', does NOT overwrite with error
		expect(alice.state).toBe("done");
		expect(result.counts.error).toBe(0);
	});

	test("transitions running entity to error using mtime fallback when startedAt is missing", async () => {
		const jobDir = path.join(tmpDir, "job-run-mtime-stale");
		setupJob(
			jobDir,
			{ id: "test-run-mtime", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running" }, // no startedAt, no heartbeat
			},
			chunkReviewConfig,
		);
		// Set file mtime to 200s ago (stale)
		const statusPath = path.join(jobDir, chunkReviewConfig.entityDirName, "alice", "status.json");
		const staleMtime = new Date(Date.now() - 200_000); // 200s ago
		fs.utimesSync(statusPath, staleMtime, staleMtime);
		// no heartbeat, no startedAt: mtime fallback, grace period = HEARTBEAT_GRACE_PERIOD_MS (120s); 200s > 120s → stale
		const result = await computeStatus(jobDir, chunkReviewConfig);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("error");
		expect(result.counts.error).toBe(1);
		expect(result.counts.running).toBe(0);
	});

	test("running entity with recent lastHeartbeat is not stale", async () => {
		const jobDir = path.join(tmpDir, "job-run-hb-fresh");
		const recentHeartbeat = new Date(Date.now() - 5_000).toISOString(); // 5s ago
		setupJob(
			jobDir,
			{ id: "test-run-hb-fresh", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running", lastHeartbeat: recentHeartbeat },
			},
			chunkReviewConfig,
		);
		// heartbeat 5s ago: HEARTBEAT_STALE_THRESHOLD_MS = 60s; 5s < 60s → not stale
		const result = await computeStatus(jobDir, chunkReviewConfig);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("running");
		expect(result.counts.running).toBe(1);
		expect(result.counts.error).toBe(0);
	});

	test("running entity with old lastHeartbeat is stale", async () => {
		const jobDir = path.join(tmpDir, "job-run-hb-old");
		const oldHeartbeat = new Date(Date.now() - 90_000).toISOString(); // 90s ago
		setupJob(
			jobDir,
			{ id: "test-run-hb-old", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running", lastHeartbeat: oldHeartbeat },
			},
			chunkReviewConfig,
		);
		// heartbeat 90s ago: HEARTBEAT_STALE_THRESHOLD_MS = 60s; 90s > 60s → stale
		const result = await computeStatus(jobDir, chunkReviewConfig);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("error");
		expect(result.counts.error).toBe(1);
		expect(result.counts.running).toBe(0);
	});

	test("running entity without heartbeat within grace period is not stale", async () => {
		const jobDir = path.join(tmpDir, "job-run-no-hb-grace");
		const recentStart = new Date(Date.now() - 60_000).toISOString(); // 60s ago
		setupJob(
			jobDir,
			{ id: "test-run-no-hb-grace", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running", startedAt: recentStart },
			},
			chunkReviewConfig,
		);
		// no heartbeat, startedAt 60s ago: HEARTBEAT_GRACE_PERIOD_MS = 120s; 60s < 120s → not stale
		const result = await computeStatus(jobDir, chunkReviewConfig);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("running");
		expect(result.counts.running).toBe(1);
		expect(result.counts.error).toBe(0);
	});

	test("running entity without heartbeat beyond grace period is stale", async () => {
		const jobDir = path.join(tmpDir, "job-run-no-hb-stale");
		const oldStart = new Date(Date.now() - 200_000).toISOString(); // 200s ago
		setupJob(
			jobDir,
			{ id: "test-run-no-hb-stale", settings: { timeoutSec: 60 } },
			{
				alice: { member: "alice", state: "running", startedAt: oldStart },
			},
			chunkReviewConfig,
		);
		// no heartbeat, startedAt 200s ago: HEARTBEAT_GRACE_PERIOD_MS = 120s; 200s > 120s → stale
		const result = await computeStatus(jobDir, chunkReviewConfig);
		const alice = result.members.find((r) => r.member === "alice");
		expect(alice.state).toBe("error");
		expect(result.counts.error).toBe(1);
		expect(result.counts.running).toBe(0);
	});

	test("counts json-mode terminal states: permanent_error, transient_error, empty_output", async () => {
		const jobDir = path.join(tmpDir, "job-json-mode-states");
		setupJob(
			jobDir,
			{ id: "test-json-mode" },
			{
				alice: { member: "alice", state: "permanent_error" },
				bob: { member: "bob", state: "transient_error" },
				carol: { member: "carol", state: "empty_output" },
			},
			chunkReviewConfig,
		);
		const result = await computeStatus(jobDir, chunkReviewConfig);
		expect(result.counts.permanent_error).toBe(1);
		expect(result.counts.transient_error).toBe(1);
		expect(result.counts.empty_output).toBe(1);
	});

	test("computeStatus totals 13 keys", async () => {
		const jobDir = path.join(tmpDir, "job-12keys");
		setupJob(
			jobDir,
			{ id: "test-12keys" },
			{
				alice: { member: "alice", state: "done", exitCode: 0 },
			},
			chunkReviewConfig,
		);
		const result = await computeStatus(jobDir, chunkReviewConfig);
		const expectedKeys = [
			"queued",
			"running",
			"retrying",
			"done",
			"error",
			"missing_cli",
			"timed_out",
			"canceled",
			"non_retryable",
			"empty_output",
			"transient_error",
			"permanent_error",
			"awaiting_resume",
		];
		for (const key of expectedKeys) {
			expect(key in result.counts).toBe(true);
		}
		// Exactly 13 keys (excluding 'total' which is added separately)
		const countKeys = Object.keys(result.counts).filter((k) => k !== "total");
		expect(countKeys.length).toBe(13);
		expect("max_turns_exceeded" in result.counts).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// buildUiPayload — parameterized by uiLabel
// ---------------------------------------------------------------------------

describe("buildUiPayload", () => {
	test("returns progress, codex, and claude keys", () => {
		const payload = {
			overallState: "done",
			counts: { total: 1, done: 1, queued: 0, running: 0, error: 0 },
			members: [{ member: "alice", state: "done", exitCode: 0 }],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		expect(result.progress).toBeTruthy();
		expect(result.codex).toBeTruthy();
		expect(result.claude).toBeTruthy();
	});

	test("reports correct progress done/total", () => {
		const payload = {
			overallState: "running",
			counts: {
				total: 3,
				done: 1,
				error: 1,
				queued: 0,
				running: 1,
				missing_cli: 0,
				timed_out: 0,
				canceled: 0,
			},
			members: [
				{ member: "alice", state: "done" },
				{ member: "bob", state: "error" },
				{ member: "carol", state: "running" },
			],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		expect(result.progress.done).toBe(2);
		expect(result.progress.total).toBe(3);
	});

	test("reviewer labels contain [Chunk Review] prefix when using chunk-review config", () => {
		const payload = {
			overallState: "running",
			counts: { total: 1, done: 0, queued: 0, running: 1 },
			members: [{ member: "alice", state: "running" }],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		const reviewerStep = result.codex.update_plan.plan[1];
		expect(reviewerStep.step.startsWith("[Chunk Review]")).toBeTruthy();
	});

	test("reviewer labels contain [Council] prefix when using council config", () => {
		const payload = {
			overallState: "running",
			counts: { total: 1, done: 0, queued: 0, running: 1 },
			members: [{ member: "alice", state: "running" }],
		};
		const result = buildUiPayload(payload, councilConfig);
		const reviewerStep = result.codex.update_plan.plan[1];
		expect(reviewerStep.step.startsWith("[Council]")).toBeTruthy();
	});

	test("reviewer labels contain [Spec Review] prefix when using spec-review config", () => {
		const payload = {
			overallState: "running",
			counts: { total: 1, done: 0, queued: 0, running: 1 },
			members: [{ member: "alice", state: "running" }],
		};
		const result = buildUiPayload(payload, specReviewConfig);
		const reviewerStep = result.codex.update_plan.plan[1];
		expect(reviewerStep.step.startsWith("[Spec Review]")).toBeTruthy();
	});

	test("marks dispatch as completed when no queued reviewers", () => {
		const payload = {
			overallState: "running",
			counts: { total: 2, done: 1, queued: 0, running: 1 },
			members: [
				{ member: "alice", state: "done" },
				{ member: "bob", state: "running" },
			],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		expect(result.codex.update_plan.plan[0].status).toBe("completed");
	});

	test("marks dispatch as in_progress when queued reviewers exist", () => {
		const payload = {
			overallState: "running",
			counts: { total: 2, done: 0, queued: 1, running: 1 },
			members: [
				{ member: "alice", state: "running" },
				{ member: "bob", state: "queued" },
			],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		expect(result.codex.update_plan.plan[0].status).toBe("in_progress");
	});

	test("marks terminal-state reviewers as completed", () => {
		const payload = {
			overallState: "done",
			counts: { total: 3, done: 1, error: 1, missing_cli: 1, queued: 0, running: 0 },
			members: [
				{ member: "alice", state: "done" },
				{ member: "bob", state: "error" },
				{ member: "carol", state: "missing_cli" },
			],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
		for (const step of reviewerSteps) {
			expect(step.status).toBe("completed");
		}
	});

	test("all reviewers done sets synth to in_progress", () => {
		const payload = {
			overallState: "done",
			counts: {
				total: 2,
				done: 2,
				queued: 0,
				running: 0,
				error: 0,
				missing_cli: 0,
				timed_out: 0,
				canceled: 0,
			},
			members: [
				{ member: "alice", state: "done" },
				{ member: "bob", state: "done" },
			],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		const plan = result.codex.update_plan.plan;
		const synthStep = plan[plan.length - 1];
		expect(synthStep.status).toBe("in_progress");
	});

	test("synth is pending when not all done", () => {
		const payload = {
			overallState: "running",
			counts: { total: 2, done: 1, queued: 0, running: 1 },
			members: [
				{ member: "alice", state: "done" },
				{ member: "bob", state: "running" },
			],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		const plan = result.codex.update_plan.plan;
		const synthStep = plan[plan.length - 1];
		expect(synthStep.status).toBe("pending");
	});

	test("claude todos have content, status, and activeForm fields", () => {
		const payload = {
			overallState: "done",
			counts: { total: 1, done: 1, queued: 0, running: 0 },
			members: [{ member: "alice", state: "done" }],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		for (const todo of result.claude.todo_write.todos) {
			expect("content" in todo).toBeTruthy();
			expect("status" in todo).toBeTruthy();
			expect("activeForm" in todo).toBeTruthy();
		}
	});

	test("sorts reviewers alphabetically", () => {
		const payload = {
			overallState: "running",
			counts: { total: 3, done: 0, queued: 0, running: 3 },
			members: [
				{ member: "carol", state: "running" },
				{ member: "alice", state: "running" },
				{ member: "bob", state: "running" },
			],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
		expect(reviewerSteps[0].step.includes("alice")).toBeTruthy();
		expect(reviewerSteps[1].step.includes("bob")).toBeTruthy();
		expect(reviewerSteps[2].step.includes("carol")).toBeTruthy();
	});

	test("filters out reviewers with null/empty entity", () => {
		const payload = {
			overallState: "done",
			counts: { total: 2, done: 1, queued: 0, running: 0 },
			members: [
				{ member: "alice", state: "done" },
				{ member: null, state: "done" },
			],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		const reviewerSteps = result.codex.update_plan.plan.slice(1, -1);
		expect(reviewerSteps.length).toBe(1);
	});

	test("handles missing counts gracefully", () => {
		const payload = {
			overallState: "done",
			members: [],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		expect(result.progress.done).toBe(0);
		expect(result.progress.total).toBe(0);
	});

	test("handles missing reviewers gracefully", () => {
		const payload = {
			overallState: "done",
			counts: { total: 0 },
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		expect(result.codex.update_plan.plan.length).toBe(2);
	});

	test("overallState is propagated in progress", () => {
		const payload = {
			overallState: "running",
			counts: { total: 1, done: 0, queued: 0, running: 1 },
			members: [{ member: "alice", state: "running" }],
		};
		const result = buildUiPayload(payload, chunkReviewConfig);
		expect(result.progress.overallState).toBe("running");
	});
});

// ---------------------------------------------------------------------------
// buildManifest — parameterized by entityDirName and entitySingular
// ---------------------------------------------------------------------------

describe("buildManifest", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function setupManifestJob(
		jobDir: string,
		config: JobConfig,
		entities: Record<string, { status: unknown; hasOutput: boolean }>,
	) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({ id: "test-manifest-job" }));
		const entitiesDir = path.join(jobDir, config.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		for (const [name, { status, hasOutput }] of Object.entries(entities)) {
			const dir = path.join(entitiesDir, name);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));
			if (hasOutput) {
				fs.writeFileSync(path.join(dir, "output.txt"), `output from ${name}`);
			}
		}
	}

	test("returns id and members array with chunk-review config", () => {
		const jobDir = path.join(tmpDir, "job-manifest");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: { status: { member: "alice", state: "done" }, hasOutput: true },
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.id).toBe("test-manifest-job");
		expect(Array.isArray(result.members)).toBeTruthy();
		expect(result.members.length).toBe(1);
	});

	test("returns outputFilePath when output.txt exists", () => {
		const jobDir = path.join(tmpDir, "job-manifest-output");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: { status: { member: "alice", state: "done" }, hasOutput: true },
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBeTruthy();
		expect(result.members[0].errorMessage).toBe(null);
	});

	test("returns errorMessage when no output.txt", () => {
		const jobDir = path.join(tmpDir, "job-manifest-err");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: { status: { member: "alice", state: "error", message: "failed" }, hasOutput: false },
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBe(null);
		expect(result.members[0].errorMessage).toBeTruthy();
	});

	test("sorts members alphabetically", () => {
		const jobDir = path.join(tmpDir, "job-manifest-sort");
		setupManifestJob(jobDir, chunkReviewConfig, {
			carol: { status: { member: "carol", state: "done" }, hasOutput: true },
			alice: { status: { member: "alice", state: "done" }, hasOutput: true },
			bob: { status: { member: "bob", state: "done" }, hasOutput: true },
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].member).toBe("alice");
		expect(result.members[1].member).toBe("bob");
		expect(result.members[2].member).toBe("carol");
	});

	test("uses members directory with council config", () => {
		const jobDir = path.join(tmpDir, "job-manifest-council");
		setupManifestJob(jobDir, councilConfig, {
			alice: { status: { member: "alice", state: "done" }, hasOutput: true },
		});
		const result = buildManifest(jobDir, councilConfig);
		expect(result.id).toBe("test-manifest-job");
		expect(result.members.length).toBe(1);
	});

	test("buildManifest: json-mode empty_output → outputFilePath null", () => {
		const jobDir = path.join(tmpDir, "job-manifest-json-empty-output");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: { status: { member: "alice", state: "empty_output", size_bytes: 0 }, hasOutput: true },
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBe(null);
		expect(result.members[0].errorMessage).toBe("empty_output");
	});

	test("buildManifest: json-mode done with size_bytes=0 → outputFilePath null", () => {
		const jobDir = path.join(tmpDir, "job-manifest-json-done-zero");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: { status: { member: "alice", state: "done", size_bytes: 0 }, hasOutput: true },
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBe(null);
		expect(result.members[0].errorMessage).toBe("done");
	});

	test("buildManifest: text-mode state=done → outputFilePath non-null, errorMessage null", () => {
		const jobDir = path.join(tmpDir, "job-manifest-text-done");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: { status: { member: "alice", state: "done" }, hasOutput: true },
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).not.toBe(null);
		expect(result.members[0].errorMessage).toBe(null);
	});

	test("buildManifest: text-mode state=error → outputFilePath null, errorMessage=state", () => {
		// state='error' is not 'done' → new predicate treats it as unreadable
		const jobDir = path.join(tmpDir, "job-manifest-text-error");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: { status: { member: "alice", state: "error", message: "timeout" }, hasOutput: true },
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBe(null);
		expect(result.members[0].errorMessage).toBe("timeout");
	});

	test("buildManifest: text-mode state=non_retryable + output.txt exists → outputFilePath null, errorMessage from error.type", () => {
		// Sentinel fires and writes state='non_retryable'; even though output.txt exists (possibly empty),
		// buildManifest must return null outputFilePath and surface the error.type.
		const jobDir = path.join(tmpDir, "job-manifest-text-non-retryable-with-output");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: {
				status: {
					member: "alice",
					state: "non_retryable",
					error: { type: "model_not_found", message: "Model not found: gpt-5" },
				},
				hasOutput: true, // output.txt exists but should be ignored
			},
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBe(null);
		expect(result.members[0].errorMessage).toBe("model_not_found");
	});

	test("buildManifest: json-mode permanent_error → outputFilePath null", () => {
		const jobDir = path.join(tmpDir, "job-manifest-json-perm-error");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: {
				status: { member: "alice", state: "permanent_error", size_bytes: 42 },
				hasOutput: true,
			},
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBe(null);
		expect(result.members[0].errorMessage).toBe("permanent_error");
	});

	test("empty output.txt (0 bytes) classifies as outputFilePath !== null, errorMessage === null", () => {
		const jobDir = path.join(tmpDir, "job-manifest-empty-output");
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({ id: "test-manifest-job" }));
		const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		const memberDir = path.join(entitiesDir, "alice");
		fs.mkdirSync(memberDir, { recursive: true });
		fs.writeFileSync(
			path.join(memberDir, "status.json"),
			JSON.stringify({ member: "alice", state: "done" }),
		);
		// Write empty (0-byte) output.txt
		fs.writeFileSync(path.join(memberDir, "output.txt"), "");
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).not.toBe(null);
		expect(result.members[0].errorMessage).toBe(null);
	});

	test('buildManifest: json-mode permanent_error with error.type=context_window → errorMessage === "context_window"', () => {
		const jobDir = path.join(tmpDir, "job-manifest-json-perm-context-window");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: {
				status: {
					member: "alice",
					state: "permanent_error",
					attempts: 3,
					size_bytes: 0,
					error: {
						type: "context_window",
						message: "AI_APICallError",
						raw_message: "AI_APICallError",
					},
				},
				hasOutput: false,
			},
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBe(null);
		expect(result.members[0].errorMessage).toBe("context_window");
	});

	test('buildManifest: json-mode empty_output without error → errorMessage === "empty_output"', () => {
		const jobDir = path.join(tmpDir, "job-manifest-json-empty-no-error");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: {
				status: {
					member: "alice",
					state: "empty_output",
					attempts: 3,
					size_bytes: 0,
				},
				hasOutput: false,
			},
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBe(null);
		expect(result.members[0].errorMessage).toBe("empty_output");
	});

	test('buildManifest: text-mode timed_out with status.message → errorMessage === "Timed out after 480s"', () => {
		const jobDir = path.join(tmpDir, "job-manifest-text-timed-out");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: {
				status: {
					member: "alice",
					state: "timed_out",
					attempts: 3,
					message: "Timed out after 480s",
				},
				hasOutput: false,
			},
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBe(null);
		expect(result.members[0].errorMessage).toBe("Timed out after 480s");
	});

	test('buildManifest: text-mode without message and error → errorMessage === "non_retryable"', () => {
		const jobDir = path.join(tmpDir, "job-manifest-text-non-retryable-synthetic");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: {
				status: {
					member: "alice",
					state: "non_retryable",
					attempts: 3,
				},
				hasOutput: false,
			},
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBe(null);
		expect(result.members[0].errorMessage).toBe("non_retryable");
	});

	test('buildManifest: prompt_too_large (text-mode-style) → errorMessage === "prompt_too_large"', () => {
		const jobDir = path.join(tmpDir, "job-manifest-prompt-too-large");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: {
				status: {
					member: "alice",
					state: "permanent_error",
					attempts: 0,
					error: { type: "prompt_too_large", bytes: 100000, limit: 81920 },
				},
				hasOutput: false,
			},
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBe(null);
		expect(result.members[0].errorMessage).toBe("prompt_too_large");
	});

	test("buildManifest: error.message without error.type → errorMessage === error.message (link 3)", () => {
		const jobDir = path.join(tmpDir, "job-manifest-link3-error-message");
		setupManifestJob(jobDir, chunkReviewConfig, {
			alice: {
				status: {
					member: "alice",
					state: "permanent_error",
					attempts: 3,
					error: { message: "Unknown API failure" },
				},
				hasOutput: false,
			},
		});
		const result = buildManifest(jobDir, chunkReviewConfig);
		expect(result.members[0].outputFilePath).toBe(null);
		expect(result.members[0].errorMessage).toBe("Unknown API failure");
	});
});

// ---------------------------------------------------------------------------
// spawnWorkers — name validation (whitelist regex)
// ---------------------------------------------------------------------------

describe("spawnWorkers 이름 유효성 검사", () => {
	let tmpDir: string;
	let originalExit: typeof process.exit;
	beforeEach(() => {
		tmpDir = makeTmpDir();
		// exitWithError calls process.exit(1) — intercept it
		originalExit = process.exit;
		(process as any).exit = (code?: number) => {
			throw new Error(`process.exit(${code})`);
		};
	});

	afterEach(() => {
		process.exit = originalExit;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function trySpawn(name: string): string | null {
		try {
			spawnWorkers({
				entities: [{ name, command: "echo test" }],
				workerPath: "/nonexistent/worker.ts",
				jobDir: tmpDir,
				entitiesDir: path.join(tmpDir, "members"),
				timeoutSec: 30,
				config: councilConfig,
			});
			return null;
		} catch (e: any) {
			return String(e.message || e);
		}
	}

	test('"." 은 화이트리스트 거부', () => {
		const err = trySpawn(".");
		expect(err).not.toBeNull();
	});

	test('".." 은 화이트리스트 거부', () => {
		const err = trySpawn("..");
		expect(err).not.toBeNull();
	});

	test('"a b" (공백 포함) 은 화이트리스트 거부', () => {
		const err = trySpawn("a b");
		expect(err).not.toBeNull();
	});

	test('"test!" (특수문자 포함) 은 화이트리스트 거부', () => {
		const err = trySpawn("test!");
		expect(err).not.toBeNull();
	});

	test('"valid-name" 은 허용 (하이픈)', () => {
		fs.mkdirSync(path.join(tmpDir, "members"), { recursive: true });
		const err = trySpawn("valid-name");
		expect(err).toBeNull();
	});

	test('"valid_name" 은 허용 (언더스코어)', () => {
		fs.mkdirSync(path.join(tmpDir, "members"), { recursive: true });
		const err = trySpawn("valid_name");
		expect(err).toBeNull();
	});

	test('"validName123" 은 허용 (영문+숫자)', () => {
		fs.mkdirSync(path.join(tmpDir, "members"), { recursive: true });
		const err = trySpawn("validName123");
		expect(err).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// `spawnWorkers` — worker PGID 반환 (회수 앵커의 생산 측)
// ---------------------------------------------------------------------------

describe("`spawnWorkers`", () => {
	let tmpDir: string;
	let spawnedPgids: number[];

	beforeEach(() => {
		tmpDir = makeTmpDir();
		spawnedPgids = [];
	});

	afterEach(() => {
		for (const pgid of spawnedPgids) {
			try {
				process.kill(-pgid, "SIGKILL");
			} catch {
				// already exited — nothing to clean up
			}
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("detached spawn된 자식은 자기 PGID의 리더다 (`ps`로 실측)", () => {
		const child = spawn("sleep", ["5"], { detached: true, stdio: "ignore" });
		const pid = child.pid;
		if (pid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(pid);

		const pgidOutput = execSync(`ps -o pgid= -p ${pid}`, { encoding: "utf-8" });
		expect(Number(pgidOutput.trim())).toBe(pid);
	});

	test("entities 순서대로 각 워커의 `name`과 `workerPgid`를 반환한다", () => {
		const fakeWorkerPath = path.join(tmpDir, "fake-worker.js");
		fs.writeFileSync(fakeWorkerPath, "process.exit(0);\n");
		const entitiesDir = path.join(tmpDir, "members");
		fs.mkdirSync(entitiesDir, { recursive: true });

		const result = spawnWorkers({
			entities: [
				{ name: "alice", command: "echo hi" },
				{ name: "bob", command: "echo hi" },
			],
			workerPath: fakeWorkerPath,
			jobDir: tmpDir,
			entitiesDir,
			timeoutSec: 30,
			config: councilConfig,
		});

		expect(result.length).toBe(2);
		expect(result[0].name).toBe("alice");
		expect(result[1].name).toBe("bob");
		for (const worker of result) {
			expect(typeof worker.workerPgid).toBe("number");
			expect(worker.workerPgid as number).toBeGreaterThan(0);
			spawnedPgids.push(worker.workerPgid as number);
		}
	});

	test("각 워커의 workerPgid에 대해 spawn 시각 증인(workerPgidStartedAt)을 함께 반환한다", () => {
		const fakeWorkerPath = path.join(tmpDir, "fake-worker.js");
		fs.writeFileSync(fakeWorkerPath, "process.exit(0);\n");
		const entitiesDir = path.join(tmpDir, "members");
		fs.mkdirSync(entitiesDir, { recursive: true });

		const result = spawnWorkers({
			entities: [{ name: "alice", command: "echo hi" }],
			workerPath: fakeWorkerPath,
			jobDir: tmpDir,
			entitiesDir,
			timeoutSec: 30,
			config: councilConfig,
		});

		expect(result.length).toBe(1);
		spawnedPgids.push(result[0].workerPgid as number);
		// 증인은 그 PGID를 지금 소유한 프로세스가 우리가 방금 스폰한 그 프로세스인지
		// 대조할 유일한 근거다 — 부재/불일치 시 회수 판정 자체가 신호를 보내지 않는다
		// (오살보다 미회수). production ps 출력 형식과 동일하게 문자열이어야 한다.
		expect(typeof result[0].workerPgidStartedAt).toBe("string");
		expect((result[0].workerPgidStartedAt as string).length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// cmdCollect — timeout-ms 0 is infinite wait
// ---------------------------------------------------------------------------

describe("cmdCollect", () => {
	let tmpDir: string;

	function setupCollectJob(jobDir: string, entities: Record<string, unknown>) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({ id: "collect-test" }));
		const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		for (const [name, status] of Object.entries(entities)) {
			const dir = path.join(entitiesDir, name);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));
		}
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("--timeout-ms 0은 즉시 종료하지 않고 done 상태까지 대기함", async () => {
		const jobDir = path.join(tmpDir, "job-collect-timeout0");
		// Start with running state
		setupCollectJob(jobDir, {
			alice: { member: "alice", state: "running" },
		});

		const aliceStatusPath = path.join(
			jobDir,
			chunkReviewConfig.entityDirName,
			"alice",
			"status.json",
		);

		// Transition to done after COLLECT_POLL_INTERVAL_MS (5000ms) so the second poll sees 'done'
		const donePayload = JSON.stringify({ member: "alice", state: "done", exitCode: 0 });
		Bun.spawn(["bash", "-c", `sleep 1 && printf '%s' '${donePayload}' > "${aliceStatusPath}"`]);

		const output: string[] = [];
		const origWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = (chunk: string | Uint8Array, ..._args: unknown[]) => {
			if (typeof chunk === "string") output.push(chunk);
			return origWrite(chunk as any);
		};

		try {
			await cmdCollect({ "timeout-ms": 0 }, jobDir, chunkReviewConfig);
		} finally {
			process.stdout.write = origWrite;
		}

		expect(output.length).toBeGreaterThan(0);
		const result = JSON.parse(output[0]);
		expect(result.overallState).toBe("done");
	}, 15000);

	test("initializing job with a complete terminal set returns done", async () => {
		const jobDir = path.join(tmpDir, "job-collect-initializing-done");
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(
			path.join(jobDir, "job.json"),
			JSON.stringify({ id: "collect-init-done", state: "initializing", members: [{ name: "alice" }, { name: "bob" }] }),
		);
		const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		for (const [name, status] of Object.entries({ alice: { state: "done" }, bob: { state: "error" } })) {
			const dir = path.join(entitiesDir, name);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ member: name, ...status }));
		}
		const output: string[] = [];
		const origWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = (chunk: string | Uint8Array, ..._args: unknown[]) => {
			if (typeof chunk === "string") output.push(chunk);
			return true;
		};
		try {
			await cmdCollect({ "timeout-ms": 100 }, jobDir, chunkReviewConfig);
		} finally {
			process.stdout.write = origWrite;
		}
		expect(JSON.parse(output[0]).overallState).toBe("done");
	});

});

// ---------------------------------------------------------------------------
// resolveCollectWaitMs — no collect call may outlive a host's output-snapshot window
// ---------------------------------------------------------------------------

describe("resolveCollectWaitMs", () => {
	test("스냅샷 창을 넘는 요청은 상한으로 클램프됨", () => {
		expect(resolveCollectWaitMs(540000)).toBe(COLLECT_MAX_WAIT_MS);
		expect(resolveCollectWaitMs(150000)).toBe(COLLECT_MAX_WAIT_MS);
	});

	test("0(무한 대기)도 상한으로 클램프됨 — 무한 블로킹은 출력이 영영 안 보이는 경로", () => {
		expect(resolveCollectWaitMs(0)).toBe(COLLECT_MAX_WAIT_MS);
	});

	test("상한 이하 요청은 그대로 통과", () => {
		expect(resolveCollectWaitMs(5000)).toBe(5000);
	});

	test("누락·비수치 요청은 상한으로 수렴", () => {
		expect(resolveCollectWaitMs(undefined)).toBe(COLLECT_MAX_WAIT_MS);
		expect(resolveCollectWaitMs(Number.NaN)).toBe(COLLECT_MAX_WAIT_MS);
	});

	test("상한은 codex exec 스냅샷 창(30s)보다 확실히 작음", () => {
		expect(COLLECT_MAX_WAIT_MS).toBeLessThan(30000);
	});
});

// ---------------------------------------------------------------------------
// resolveCollectNextAction — the poll budget lives in the script, not in a prompt counter
// ---------------------------------------------------------------------------

describe("resolveCollectNextAction", () => {
	const createdAt = "2026-08-06T00:00:00.000Z";
	const deadlineSec = 600;

	test("데드라인 이전이면 계속 폴", () => {
		const now = Date.parse(createdAt) + 100_000;
		expect(resolveCollectNextAction({ createdAt, timeoutSec: deadlineSec }, now)).toEqual({
			nextAction: "poll_again",
			elapsedSec: 100,
			deadlineSec,
		});
	});

	test("데드라인 도달이면 stop 신호", () => {
		const now = Date.parse(createdAt) + 600_000;
		expect(resolveCollectNextAction({ createdAt, timeoutSec: deadlineSec }, now).nextAction).toBe(
			"stop_and_degrade",
		);
	});

	test("메타데이터가 없으면 폴 계속 — 데드라인 없음이 조기 중단을 뜻하지 않음", () => {
		const now = Date.parse(createdAt) + 100_000;
		expect(resolveCollectNextAction({}, now)).toEqual({
			nextAction: "poll_again",
			elapsedSec: null,
			deadlineSec: null,
		});
	});
});

// ---------------------------------------------------------------------------
// cmdResults
// ---------------------------------------------------------------------------

describe("cmdResults", () => {
	let tmpDir: string;

	function captureStdout(fn: () => void): string {
		let captured = "";
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: any) => {
			captured += String(chunk);
			return true;
		}) as any;
		try {
			fn();
		} finally {
			process.stdout.write = orig;
		}
		return captured;
	}

	function setupResultsFixture(
		jobDir: string,
		members: Record<
			string,
			{ member: string; state: string; exitCode: number; output: string; stderr: string }
		>,
		jobMeta?: Record<string, any>,
	) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(jobMeta || { id: "test" }));
		const membersDir = path.join(jobDir, "members");
		fs.mkdirSync(membersDir, { recursive: true });
		for (const [name, data] of Object.entries(members)) {
			const dir = path.join(membersDir, name);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				path.join(dir, "status.json"),
				JSON.stringify({ member: data.member, state: data.state, exitCode: data.exitCode }),
			);
			fs.writeFileSync(path.join(dir, "output.txt"), data.output);
			fs.writeFileSync(path.join(dir, "error.txt"), data.stderr);
		}
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("--json 기본 출력 구조 검증", () => {
		const jobDir = path.join(tmpDir, "job-results-basic");
		setupResultsFixture(jobDir, {
			alice: { member: "alice", state: "done", exitCode: 0, output: "hello", stderr: "" },
		});

		const raw = captureStdout(() => {
			cmdResults({ json: true }, jobDir, chunkReviewConfig);
		});

		const result = JSON.parse(raw);
		expect(result.jobDir).toBeDefined();
		expect(result.id).toBe("test");
		expect(Array.isArray(result.members)).toBe(true);
		const member = result.members[0];
		expect(member.member).toBe("alice");
		expect(member.state).toBe("done");
		expect(member.exitCode).toBe(0);
		expect(member.message).toBeNull();
		expect(member.output).toBe("hello");
		expect(member.stderr).toBeUndefined();
	});

	test("hooks.extraTopLevel 커스텀 필드 추가", () => {
		const jobDir = path.join(tmpDir, "job-results-extratop");
		setupResultsFixture(jobDir, {
			alice: { member: "alice", state: "done", exitCode: 0, output: "", stderr: "" },
		});

		const hooks: CmdResultsHooks = {
			extraTopLevel: () => ({ specName: "test-spec", prompt: "test prompt" }),
		};

		const raw = captureStdout(() => {
			cmdResults({ json: true }, jobDir, chunkReviewConfig, hooks);
		});

		const result = JSON.parse(raw);
		expect(result.specName).toBe("test-spec");
		expect(result.prompt).toBe("test prompt");
	});

	test("hooks.extraMemberFields per-member 필드 추가", () => {
		const jobDir = path.join(tmpDir, "job-results-extramember");
		setupResultsFixture(jobDir, {
			alice: { member: "alice", state: "done", exitCode: 0, output: "", stderr: "some error" },
		});

		const hooks: CmdResultsHooks = {
			extraMemberFields: (r) => ({ stderr: r.stderr }),
		};

		const raw = captureStdout(() => {
			cmdResults({ json: true }, jobDir, chunkReviewConfig, hooks);
		});

		const result = JSON.parse(raw);
		expect(result.members[0].stderr).toBe("some error");
	});

	test("ANSI 코드가 output에서 제거됨", () => {
		const jobDir = path.join(tmpDir, "job-results-ansi-output");
		setupResultsFixture(jobDir, {
			alice: {
				member: "alice",
				state: "done",
				exitCode: 0,
				output: "\x1b[31mred\x1b[0m",
				stderr: "",
			},
		});

		const raw = captureStdout(() => {
			cmdResults({ json: true }, jobDir, chunkReviewConfig);
		});

		const result = JSON.parse(raw);
		expect(result.members[0].output).toBe("red");
	});

	test("hooks 미전달 시 기존 동작 유지", () => {
		const jobDir = path.join(tmpDir, "job-results-nohooks");
		setupResultsFixture(jobDir, {
			alice: { member: "alice", state: "done", exitCode: 0, output: "out", stderr: "err" },
		});

		const raw = captureStdout(() => {
			cmdResults({ json: true }, jobDir, chunkReviewConfig);
		});

		const result = JSON.parse(raw);
		const member = result.members[0];
		expect(member.member).toBe("alice");
		expect(member.output).toBe("out");
		expect(member.stderr).toBeUndefined();
		expect(member.specName).toBeUndefined();
	});

	test("ANSI 코드가 stderr에서도 제거됨", () => {
		const jobDir = path.join(tmpDir, "job-results-ansi-stderr");
		setupResultsFixture(jobDir, {
			alice: {
				member: "alice",
				state: "done",
				exitCode: 0,
				output: "",
				stderr: "\x1b[32mgreen\x1b[0m",
			},
		});

		const hooks: CmdResultsHooks = {
			extraMemberFields: (r) => ({ stderr: r.stderr }),
		};

		const raw = captureStdout(() => {
			cmdResults({ json: true }, jobDir, chunkReviewConfig, hooks);
		});

		const result = JSON.parse(raw);
		expect(result.members[0].stderr).toBe("green");
	});
});

// ---------------------------------------------------------------------------
// opencode output_format branch
// ---------------------------------------------------------------------------

describe("buildAugmentedCommand opencode output_format", () => {
	test("opencode json: appends --format json", () => {
		const result = buildAugmentedCommand(
			{ command: "opencode run", output_format: "json" },
			"opencode",
		);
		expect(result.command).toContain("--format");
		expect(result.command).toContain("json");
	});

	test("opencode without output_format: does not append --format json", () => {
		const result = buildAugmentedCommand({ command: "opencode run" }, "opencode");
		expect(result.command).not.toContain("--format");
	});

	test("기존 claude 브랜치 회귀: `--output-format json` 유지", () => {
		const result = buildAugmentedCommand({ command: "claude -p", output_format: "json" }, "claude");
		expect(result.command).toContain("--output-format");
		expect(result.command).toContain("json");
	});

	test("기존 codex 브랜치 회귀: `--json` 유지", () => {
		const result = buildAugmentedCommand({ command: "codex exec", output_format: "json" }, "codex");
		expect(result.command).toContain("--json");
	});
});

// ---------------------------------------------------------------------------
// assertMembersOrExit
// ---------------------------------------------------------------------------

describe("assertMembersOrExit", () => {
	let originalExit: typeof process.exit;

	beforeEach(() => {
		originalExit = process.exit;
		(process as any).exit = (code?: number) => {
			throw new Error(`process.exit(${code})`);
		};
	});

	afterEach(() => {
		process.exit = originalExit;
	});

	test("빈 배열이면 exitWithError 호출 (process.exit(1))", () => {
		expect(() => assertMembersOrExit([], councilConfig, "/path/to/config.yaml")).toThrow(
			"process.exit(1)",
		);
	});

	test("비어 있지 않은 배열이면 정상 반환 (exit 없음)", () => {
		expect(() =>
			assertMembersOrExit([{ name: "x" }], councilConfig, "/path/to/config.yaml"),
		).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// assertDenyEnforceable
// ---------------------------------------------------------------------------

describe("assertDenyEnforceable", () => {
	let originalExit: typeof process.exit;
	let originalStderrWrite: typeof process.stderr.write;
	let originalStdoutWrite: typeof process.stdout.write;
	let stderrOutput: string;
	let stdoutOutput: string;

	beforeEach(() => {
		originalExit = process.exit;
		originalStderrWrite = process.stderr.write;
		originalStdoutWrite = process.stdout.write;
		stderrOutput = "";
		stdoutOutput = "";
		(process as any).exit = (code?: number) => {
			throw new Error(`process.exit(${code})`);
		};
		(process.stderr.write as any) = (chunk: string) => {
			stderrOutput += chunk;
			return true;
		};
		(process.stdout.write as any) = (chunk: string) => {
			stdoutOutput += chunk;
			return true;
		};
	});

	afterEach(() => {
		process.exit = originalExit;
		process.stderr.write = originalStderrWrite;
		process.stdout.write = originalStdoutWrite;
	});

	test("deny 비어있음 + gemini member는 통과하고 stderr에 차단 미선언 한 줄을 남긴다 (stdout은 비어있다)", () => {
		expect(() =>
			assertDenyEnforceable(
				[{ name: "gemini-member", command: "gemini -p" }],
				[],
				councilConfig,
				"/path/to/config.yaml",
			),
		).not.toThrow();
		expect(stderrOutput).toContain("declares no deny");
		expect(stdoutOutput).toBe("");
	});

	test("deny 선언 + gemini member는 exit 1이고 4개 구성요소를 모두 포함한다", () => {
		expect(() =>
			assertDenyEnforceable(
				[{ name: "bob", command: "gemini -p" }],
				["some-skill"],
				councilConfig,
				"/path/to/config.yaml",
			),
		).toThrow("process.exit(1)");

		// (a) configPath
		expect(stderrOutput).toContain("/path/to/config.yaml");
		// (b) 위반 member 이름과 감지된 cliType의 렌더 쌍
		expect(stderrOutput).toContain("bob (gemini)");
		// (c) 집행 가능 CLI 목록
		expect(stderrOutput).toContain("Enforceable CLIs: codex, claude, opencode");
		// (d) 고치는 방법 2가지 — 대체 / deny 제거
		expect(stderrOutput).toContain("(1) replacing these members with an enforceable CLI");
		expect(stderrOutput).toContain("(2) removing this job's settings.deny declaration");
	});

	test("deny 선언 + unknown cliType member는 exit 1이다", () => {
		expect(() =>
			assertDenyEnforceable(
				[{ name: "mystery-member", command: "mycli run" }],
				["some-skill"],
				councilConfig,
				"/path/to/config.yaml",
			),
		).toThrow("process.exit(1)");
		expect(stderrOutput).toContain("mystery-member");
		expect(stderrOutput).toContain("unknown");
	});

	test("위반 member가 2개 이상이면 에러 문자열에 둘 다 나열된다", () => {
		expect(() =>
			assertDenyEnforceable(
				[
					{ name: "gemini-member", command: "gemini -p" },
					{ name: "mystery-member", command: "mycli run" },
					{ name: "codex-member", command: "codex exec" },
				],
				["some-skill"],
				councilConfig,
				"/path/to/config.yaml",
			),
		).toThrow("process.exit(1)");
		expect(stderrOutput).toContain("gemini-member");
		expect(stderrOutput).toContain("mystery-member");
	});

	test("위반 member가 배열 마지막에 있어도 빠짐없이 적발된다", () => {
		expect(() =>
			assertDenyEnforceable(
				[
					{ name: "codex-member", command: "codex exec" },
					{ name: "claude-member", command: "claude -p" },
					{ name: "gemini-member", command: "gemini -p" },
				],
				["some-skill"],
				councilConfig,
				"/path/to/config.yaml",
			),
		).toThrow("process.exit(1)");
		// 배열 마지막 위치의 위반(gemini-member)도 검사를 빠져나가지 않는다
		expect(stderrOutput).toContain("gemini-member");
	});

	test("deny 선언 + 전 member가 집행 가능 CLI면 통과한다 (exit 없음)", () => {
		expect(() =>
			assertDenyEnforceable(
				[
					{ name: "codex-member", command: "codex exec" },
					{ name: "claude-member", command: "claude -p" },
					{ name: "opencode-member", command: "opencode run" },
				],
				["some-skill"],
				councilConfig,
				"/path/to/config.yaml",
			),
		).not.toThrow();
	});

	test("deny가 undefined면 [] 와 동일하게 통과하고 stderr에 차단 미선언 한 줄을 남긴다 (stdout은 비어있다)", () => {
		expect(() =>
			assertDenyEnforceable(
				[{ name: "gemini-member", command: "gemini -p" }],
				undefined,
				councilConfig,
				"/path/to/config.yaml",
			),
		).not.toThrow();
		expect(stderrOutput).toContain("declares no deny");
		expect(stdoutOutput).toBe("");
	});

	test("deny가 null이면 [] 와 동일하게 통과하고 stderr에 차단 미선언 한 줄을 남긴다 (stdout은 비어있다)", () => {
		expect(() =>
			assertDenyEnforceable(
				[{ name: "gemini-member", command: "gemini -p" }],
				null as unknown as undefined,
				councilConfig,
				"/path/to/config.yaml",
			),
		).not.toThrow();
		expect(stderrOutput).toContain("declares no deny");
		expect(stdoutOutput).toBe("");
	});

	// subagent 축도 skills 축과 같은 "선언가능 = 집행가능" 게이트를 통과해야 한다 —
	// skills를 하나도 선언하지 않고 subagents만 켠 job이 gemini member로 조용히
	// 통과하면 선언은 있는데 집행은 없는 상태가 된다.
	test("subagents만 선언 + gemini member는 exit 1이다 (skills는 비어있음)", () => {
		expect(() =>
			assertDenyEnforceable(
				[{ name: "bob", command: "gemini -p" }],
				[],
				councilConfig,
				"/path/to/config.yaml",
				true,
			),
		).toThrow("process.exit(1)");
		expect(stderrOutput).toContain("bob (gemini)");
	});

	test("subagents만 선언 + 전 member가 집행 가능 CLI면 통과하고 미선언 경고도 남기지 않는다", () => {
		expect(() =>
			assertDenyEnforceable(
				[
					{ name: "codex-member", command: "codex exec" },
					{ name: "claude-member", command: "claude -p" },
					{ name: "opencode-member", command: "opencode run" },
				],
				[],
				councilConfig,
				"/path/to/config.yaml",
				true,
			),
		).not.toThrow();
		expect(stderrOutput).not.toContain("declares no deny");
	});

	test("subagents=false + skills 비어있음은 미선언 경고 경로 그대로다", () => {
		expect(() =>
			assertDenyEnforceable(
				[{ name: "gemini-member", command: "gemini -p" }],
				[],
				councilConfig,
				"/path/to/config.yaml",
				false,
			),
		).not.toThrow();
		expect(stderrOutput).toContain("declares no deny");
	});
});

// ---------------------------------------------------------------------------
// assertDenyShape / extractDenySubagents — settings.deny.subagents 축
// ---------------------------------------------------------------------------

describe("settings.deny.subagents 형식 검증과 추출", () => {
	let originalExit: typeof process.exit;
	let originalStderrWrite: typeof process.stderr.write;

	beforeEach(() => {
		originalExit = process.exit;
		originalStderrWrite = process.stderr.write;
		(process as any).exit = (code?: number) => {
			throw new Error(`process.exit(${code})`);
		};
		(process.stderr.write as any) = () => true;
	});

	afterEach(() => {
		process.exit = originalExit;
		process.stderr.write = originalStderrWrite;
	});

	test("subagents가 boolean이 아니면 exit 1이다", () => {
		for (const bad of ["true", 1, [], {}]) {
			expect(() =>
				assertDenyShape({ deny: { subagents: bad } }, councilConfig, "/path/to/config.yaml"),
			).toThrow("process.exit(1)");
		}
	});

	test("subagents가 boolean이거나 없으면 통과한다", () => {
		for (const good of [true, false, undefined, null]) {
			expect(() =>
				assertDenyShape({ deny: { subagents: good } }, councilConfig, "/path/to/config.yaml"),
			).not.toThrow();
		}
	});

	test("extractDenySubagents는 선언된 boolean을 그대로, 미선언은 false로 읽는다", () => {
		expect(extractDenySubagents({ deny: { subagents: true } })).toBe(true);
		expect(extractDenySubagents({ deny: { subagents: false } })).toBe(false);
		expect(extractDenySubagents({ deny: { skills: ["a"] } })).toBe(false);
		expect(extractDenySubagents({})).toBe(false);
		expect(extractDenySubagents({ deny: null })).toBe(false);
	});

	test("두 축은 서로를 지우지 않는다 — 한쪽만 선언해도 다른 쪽 추출은 중립값이다", () => {
		expect(extractDenySkills({ deny: { subagents: true } })).toEqual([]);
		expect(extractDenySubagents({ deny: { skills: ["a", "b"] } })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// cmdResumeMember
// ---------------------------------------------------------------------------

describe("cmdResumeMember", () => {
	let tmpDir: string;
	let jobDir: string;

	const membersConfig: JobConfig = {
		entitySingular: "member",
		entityPlural: "members",
		entityDirName: "members",
		jobPrefix: "council-",
		uiLabel: "[Council]",
		configTopLevelKey: "council",
	};

	const reviewersConfig: JobConfig = {
		entitySingular: "reviewer",
		entityPlural: "reviewers",
		entityDirName: "reviewers",
		jobPrefix: "spec-review-",
		uiLabel: "[Spec Review]",
		configTopLevelKey: "spec-review",
	};

	function writeMemberStatus(entityDir: string, payload: Record<string, unknown>) {
		fs.mkdirSync(entityDir, { recursive: true });
		fs.writeFileSync(path.join(entityDir, "status.json"), JSON.stringify(payload, null, 2), "utf8");
	}

	function readMemberStatus(entityDir: string): Record<string, unknown> {
		return JSON.parse(fs.readFileSync(path.join(entityDir, "status.json"), "utf8"));
	}

	function makeMockDriver() {
		return {
			cli: "opencode" as const,
			initialCommand: () => ({ program: "opencode", args: [], env: {} }),
			resumeCommand: () => ({ program: "opencode", args: ["--resume", "sess-abc"], env: {} }),
			parseStdout: (_s: string) => ({
				sessionID: "sess-abc",
				terminal: "stop" as const,
				text: "resumed result",
				rawEvents: [],
			}),
		};
	}

	function makeResumeStub(sessionID = "sess-abc") {
		return async (_sid: string, _opts: unknown) => ({
			state: "done",
			sessionID,
			text: "resumed output",
			exitCode: 0,
		});
	}

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "generic-job-resume-test-"));
		jobDir = path.join(tmpDir, "job1");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("uses entityDirName=members to locate status.json", async () => {
		const entityDir = path.join(jobDir, "members", "alice");
		writeMemberStatus(entityDir, {
			member: "alice",
			state: "done",
			sessionID: "sess-abc",
			resume_count: 0,
			command: "opencode",
		});

		const opts: ResumeMemberOpts = {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn: makeResumeStub() as any,
		};
		await expect(
			cmdResumeMember(jobDir, "alice", "follow up", membersConfig, opts),
		).resolves.toBeUndefined();
	});

	test("uses entityDirName=reviewers to locate status.json", async () => {
		const entityDir = path.join(jobDir, "reviewers", "bob");
		writeMemberStatus(entityDir, {
			member: "bob",
			state: "done",
			sessionID: "sess-abc",
			resume_count: 0,
			command: "opencode",
		});

		const opts: ResumeMemberOpts = {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn: makeResumeStub() as any,
		};
		await expect(
			cmdResumeMember(jobDir, "bob", "follow up", reviewersConfig, opts),
		).resolves.toBeUndefined();
	});

	test("rejects when status.json absent (no resumable session)", async () => {
		const opts: ResumeMemberOpts = {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn: makeResumeStub() as any,
		};
		await expect(
			cmdResumeMember(jobDir, "ghost", "follow up", membersConfig, opts),
		).rejects.toThrow("no resumable session");
	});

	test("rejects when sessionID missing in status.json", async () => {
		const entityDir = path.join(jobDir, "members", "alice");
		writeMemberStatus(entityDir, {
			member: "alice",
			state: "done",
			sessionID: null,
			resume_count: 0,
			command: "opencode",
		});

		const opts: ResumeMemberOpts = {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn: makeResumeStub() as any,
		};
		await expect(
			cmdResumeMember(jobDir, "alice", "follow up", membersConfig, opts),
		).rejects.toThrow("no resumable session");
	});

	test("increments resume_count to 1 after one call", async () => {
		const entityDir = path.join(jobDir, "members", "alice");
		writeMemberStatus(entityDir, {
			member: "alice",
			state: "done",
			sessionID: "sess-abc",
			resume_count: 0,
			command: "opencode",
		});

		const opts: ResumeMemberOpts = {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn: makeResumeStub() as any,
		};
		await cmdResumeMember(jobDir, "alice", "follow up", membersConfig, opts);
		const status = readMemberStatus(entityDir);
		expect(status.resume_count).toBe(1);
	});

	test("rejects with cap exceeded when resume_count is 3", async () => {
		const entityDir = path.join(jobDir, "reviewers", "bob");
		writeMemberStatus(entityDir, {
			member: "bob",
			state: "done",
			sessionID: "sess-abc",
			resume_count: 3,
			command: "opencode",
		});

		const opts: ResumeMemberOpts = {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn: makeResumeStub() as any,
		};
		await expect(
			cmdResumeMember(jobDir, "bob", "follow up", reviewersConfig, opts),
		).rejects.toThrow("resume cap exceeded (3/3)");
	});

	test("rejects when state is error", async () => {
		const entityDir = path.join(jobDir, "members", "alice");
		writeMemberStatus(entityDir, {
			member: "alice",
			state: "error",
			sessionID: "sess-abc",
			resume_count: 0,
			command: "opencode",
		});

		const opts: ResumeMemberOpts = {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn: makeResumeStub() as any,
		};
		await expect(
			cmdResumeMember(jobDir, "alice", "follow up", membersConfig, opts),
		).rejects.toThrow("member in non-resumable state: error");
	});

	test("wrong entityDirName does not find status.json in sibling directory", async () => {
		// Status is in 'members/' but we pass reviewersConfig (entityDirName='reviewers')
		const entityDir = path.join(jobDir, "members", "alice");
		writeMemberStatus(entityDir, {
			member: "alice",
			state: "done",
			sessionID: "sess-abc",
			resume_count: 0,
			command: "opencode",
		});

		const opts: ResumeMemberOpts = {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn: makeResumeStub() as any,
		};
		// reviewersConfig uses 'reviewers' dir — should not find 'members/alice'
		await expect(
			cmdResumeMember(jobDir, "alice", "follow up", reviewersConfig, opts),
		).rejects.toThrow("no resumable session");
	});

	test("passes workerEnv from status.json through to resumeFn", async () => {
		const entityDir = path.join(jobDir, "members", "gpt");
		writeMemberStatus(entityDir, {
			member: "gpt",
			state: "done",
			sessionID: "ses_x",
			resume_count: 0,
			command: "opencode",
			workerEnv: { CLAUDECODE: "", CLAUDE_CODE_EFFORT_LEVEL: "xhigh", CUSTOM: "val" },
		});

		let capturedOpts: RunOneTurnOpts | null = null;
		const resumeOneTurnFn = async (_sid: string, opts: RunOneTurnOpts) => {
			capturedOpts = opts;
			return { state: "done" as const, sessionID: "ses_x", text: "", exitCode: 0 };
		};

		await cmdResumeMember(jobDir, "gpt", "follow up", membersConfig, {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn,
		});

		expect(capturedOpts).not.toBeNull();
		expect(capturedOpts!.workerEnv).toEqual({
			CLAUDECODE: "",
			CLAUDE_CODE_EFFORT_LEVEL: "xhigh",
			CUSTOM: "val",
		});
	});

	test("round-trip: resume re-tokenizes a persisted deny command with quotes intact", async () => {
		const entityDir = path.join(jobDir, "members", "codexmember");
		const augmented = buildAugmentedCommand({ command: "codex exec", deny: ["a", "b"] }, "codex");
		writeMemberStatus(entityDir, {
			member: "codexmember",
			state: "done",
			sessionID: "ses_y",
			resume_count: 0,
			command: augmented.command,
		});

		let capturedOpts: RunOneTurnOpts | null = null;
		const resumeOneTurnFn = async (_sid: string, opts: RunOneTurnOpts) => {
			capturedOpts = opts;
			return { state: "done" as const, sessionID: "ses_y", text: "", exitCode: 0 };
		};

		await cmdResumeMember(jobDir, "codexmember", "follow up", membersConfig, {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn,
		});

		expect(capturedOpts).not.toBeNull();
		expect(capturedOpts!.args).toContain(
			'skills.config=[{name="a",enabled=false},{name="b",enabled=false}]',
		);
	});

	test("cmdResumeMember restores workerEnv", async () => {
		// Asserts the existing status.json → workerEnv → resumeFn chain.
		// worker-utils.ts:402 snapshots builtCmd.env as workerEnv into status.json;
		// cmdResumeMember reads it back and forwards it to resumeFn as workerEnv.
		// No new resume code: this test only verifies the existing round-trip works.
		const entityDir = path.join(jobDir, "members", "alice");
		writeMemberStatus(entityDir, {
			member: "alice",
			state: "done",
			sessionID: "sess-abc",
			resume_count: 0,
			command: "opencode",
			workerEnv: { OPENSEARCH_DISABLED_TOOLS: "CountTool", CLAUDECODE: "" },
		});

		let capturedWorkerEnv: Record<string, string> | undefined;
		const resumeOneTurnFn = async (_sid: string, opts: RunOneTurnOpts) => {
			capturedWorkerEnv = opts.workerEnv as Record<string, string>;
			return { state: "done" as const, sessionID: "sess-abc", text: "", exitCode: 0 };
		};

		await cmdResumeMember(jobDir, "alice", "follow up", membersConfig, {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn,
		});

		expect(capturedWorkerEnv).toBeDefined();
		expect(capturedWorkerEnv!.OPENSEARCH_DISABLED_TOOLS).toBe("CountTool");
		expect(capturedWorkerEnv!.CLAUDECODE).toBe("");
	});

	// ---------------------------------------------------------------------------
	// Regression tests: triple fix (item 2 comment, item 4 preflight, item 5 timeoutSec=0)
	// ---------------------------------------------------------------------------

	test("unknown command throws before resume_count is incremented (preflight before cap)", async () => {
		const entityDir = path.join(jobDir, "members", "alice");
		fs.mkdirSync(entityDir, { recursive: true });
		const statusPayload = {
			member: "alice",
			state: "done",
			sessionID: "sess-abc",
			resume_count: 0,
			command: "unknowncli run",
		};
		fs.writeFileSync(
			path.join(entityDir, "status.json"),
			JSON.stringify(statusPayload, null, 2),
			"utf8",
		);

		const opts: ResumeMemberOpts = {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn: makeResumeStub() as any,
		};
		await expect(
			cmdResumeMember(jobDir, "alice", "follow up", membersConfig, opts),
		).rejects.toThrow("unknown cli type");

		const status = JSON.parse(fs.readFileSync(path.join(entityDir, "status.json"), "utf8"));
		expect(status.resume_count).toBe(0);
	});

	test("timeoutSec=0 in job.json forwarded as 0 to resumeFn (not coerced to 300)", async () => {
		const entityDir = path.join(jobDir, "members", "alice");
		fs.mkdirSync(entityDir, { recursive: true });
		fs.writeFileSync(
			path.join(entityDir, "status.json"),
			JSON.stringify(
				{
					member: "alice",
					state: "done",
					sessionID: "sess-abc",
					resume_count: 0,
					command: "opencode",
				},
				null,
				2,
			),
			"utf8",
		);

		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(
			path.join(jobDir, "job.json"),
			JSON.stringify(
				{
					settings: { timeoutSec: 0 },
				},
				null,
				2,
			),
			"utf8",
		);

		let capturedTimeoutSec: number | undefined;
		const resumeOneTurnFn = async (_sid: string, opts: RunOneTurnOpts) => {
			capturedTimeoutSec = opts.timeoutSec;
			return { state: "done" as const, sessionID: "sess-abc", text: "", exitCode: 0 };
		};

		await cmdResumeMember(jobDir, "alice", "follow up", membersConfig, {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn,
		});

		expect(capturedTimeoutSec).toBe(0);
	});

	test("intent comment exists in cmdResumeMember explaining non-forwarding of promptsDir", () => {
		const src = fs.readFileSync(path.join(__dirname, "generic-job.ts"), "utf8");
		// Verify comment is present between cmdResumeMember start and end
		const fnStart = src.indexOf("export async function cmdResumeMember(");
		const fnEnd = src.indexOf("\nexport ", fnStart + 1);
		const fnBody = src.slice(fnStart, fnEnd);
		expect(fnBody).toMatch(
			/session.*preserv|--resume.*persona|intentionally.*omit|not forwarded|session-preserving/i,
		);
	});

	// ---------------------------------------------------------------------------
	// workerPath opt: detached-spawn resume dispatch (in-process path above stays
	// the legacy default for callers that never pass workerPath).
	// ---------------------------------------------------------------------------

	function makeSpawnStub() {
		const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = [];
		const spawnFn = ((command: string, args: string[], options: Record<string, unknown>) => {
			calls.push({ command, args, options });
			return { unref: () => {} } as unknown as ReturnType<typeof spawn>;
		}) as unknown as typeof spawn;
		return { spawnFn, calls };
	}

	test("workerPath가 주어지면 resumeFn을 호출하지 않고 스폰만 한다", async () => {
		const entityDir = path.join(jobDir, "members", "alice");
		writeMemberStatus(entityDir, {
			member: "alice",
			state: "done",
			sessionID: "sess-abc",
			resume_count: 0,
			command: "opencode",
		});

		const { spawnFn, calls } = makeSpawnStub();
		let resumeFnCalled = false;

		await cmdResumeMember(jobDir, "alice", "follow up", membersConfig, {
			driverFactory: () => makeMockDriver(),
			resumeOneTurnFn: async () => {
				resumeFnCalled = true;
				return { state: "done", sessionID: "sess-abc", text: "", exitCode: 0 };
			},
			workerPath: "/fake/worker.ts",
			spawnFn,
		});

		expect(resumeFnCalled).toBe(false);
		expect(calls.length).toBe(1);
	});

	test("workerPath 모드는 spawn을 detached로 호출하고 workerPath/--session/--prompt를 인자로 전달한다", async () => {
		const entityDir = path.join(jobDir, "members", "alice");
		writeMemberStatus(entityDir, {
			member: "alice",
			state: "done",
			sessionID: "sess-abc",
			resume_count: 0,
			command: "opencode",
			workerEnv: { CUSTOM: "val" },
		});

		const { spawnFn, calls } = makeSpawnStub();
		await cmdResumeMember(jobDir, "alice", "follow up prompt", membersConfig, {
			driverFactory: () => makeMockDriver(),
			workerPath: "/fake/worker.ts",
			spawnFn,
		});

		expect(calls.length).toBe(1);
		const call = calls[0];
		expect(call.command).toBe(process.execPath);
		expect(call.args).toEqual([
			"/fake/worker.ts",
			"--job-dir",
			jobDir,
			"--member",
			"alice",
			"--command",
			"opencode",
			"--session",
			"sess-abc",
			"--prompt",
			"follow up prompt",
			"--env",
			"CUSTOM=val",
			"--timeout",
			"300",
		]);
		expect(call.options).toMatchObject({ detached: true, stdio: "ignore" });
	});

	test("workerPath 모드는 spawn 전에 status.json을 queued로 전환하며 기존 필드를 보존한다", async () => {
		const entityDir = path.join(jobDir, "members", "alice");
		writeMemberStatus(entityDir, {
			member: "alice",
			state: "awaiting_resume",
			sessionID: "sess-abc",
			resume_count: 1,
			command: "opencode",
			workerEnv: { CUSTOM: "val" },
			usage: { output_tokens: 42 },
		});

		const { spawnFn } = makeSpawnStub();
		await cmdResumeMember(jobDir, "alice", "follow up", membersConfig, {
			driverFactory: () => makeMockDriver(),
			workerPath: "/fake/worker.ts",
			spawnFn,
		});

		const status = readMemberStatus(entityDir);
		expect(status.state).toBe("queued");
		expect(typeof status.queuedAt).toBe("string");
		expect(status.sessionID).toBe("sess-abc");
		expect(status.command).toBe("opencode");
		expect(status.workerEnv).toEqual({ CUSTOM: "val" });
		expect(status.resume_count).toBe(2);
		expect(status.usage).toEqual({ output_tokens: 42 });
	});

	test("workerPath 모드는 stdout에 dispatched ack를 출력하고 즉시 반환한다", async () => {
		const entityDir = path.join(jobDir, "members", "alice");
		writeMemberStatus(entityDir, {
			member: "alice",
			state: "done",
			sessionID: "sess-abc",
			resume_count: 0,
			command: "opencode",
		});

		const { spawnFn } = makeSpawnStub();
		let captured = "";
		const origWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			captured += String(chunk);
			return true;
		}) as typeof process.stdout.write;
		try {
			await expect(
				cmdResumeMember(jobDir, "alice", "follow up", membersConfig, {
					driverFactory: () => makeMockDriver(),
					workerPath: "/fake/worker.ts",
					spawnFn,
				}),
			).resolves.toBeUndefined();
		} finally {
			process.stdout.write = origWrite;
		}

		expect(JSON.parse(captured.trim())).toEqual({ state: "dispatched", member: "alice" });
	});

	test("workerPath 모드에서도 resume_count가 캡(3)이면 스폰 없이 reject한다", async () => {
		const entityDir = path.join(jobDir, "members", "alice");
		writeMemberStatus(entityDir, {
			member: "alice",
			state: "done",
			sessionID: "sess-abc",
			resume_count: 3,
			command: "opencode",
		});

		const { spawnFn, calls } = makeSpawnStub();
		await expect(
			cmdResumeMember(jobDir, "alice", "follow up", membersConfig, {
				driverFactory: () => makeMockDriver(),
				workerPath: "/fake/worker.ts",
				spawnFn,
			}),
		).rejects.toThrow("resume cap exceeded (3/3)");

		expect(calls.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// cmdClean — active-member guard
// ---------------------------------------------------------------------------

describe("cmdClean 활성 멤버 삭제 거부", () => {
	let tmpDir: string;
	let originalExit: typeof process.exit;

	function setupCleanJob(
		jobDir: string,
		entities: Record<string, { state: string }>,
		config: JobConfig,
	) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({ id: "clean-test" }));
		const entitiesDir = path.join(jobDir, config.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		for (const [name, status] of Object.entries(entities)) {
			const dir = path.join(entitiesDir, name);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));
		}
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
		originalExit = process.exit;
		(process as any).exit = (code?: number) => {
			throw new Error(`process.exit(${code})`);
		};
	});

	afterEach(() => {
		process.exit = originalExit;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("awaiting_resume 멤버가 있으면 clean을 거부한다", () => {
		const jobDir = path.join(tmpDir, "job-active");
		setupCleanJob(jobDir, { alice: { state: "awaiting_resume" } }, chunkReviewConfig);
		expect(() => cmdClean({}, jobDir, chunkReviewConfig, tmpDir)).toThrow("process.exit(1)");
		// jobDir must still exist — was not deleted
		expect(fs.existsSync(jobDir)).toBe(true);
	});

	test("awaiting_resume 멤버가 있어도 force 옵션으로 clean이 가능하다", () => {
		const jobDir = path.join(tmpDir, "job-force");
		setupCleanJob(jobDir, { alice: { state: "awaiting_resume" } }, chunkReviewConfig);
		expect(() => cmdClean({ force: true }, jobDir, chunkReviewConfig, tmpDir)).not.toThrow();
		expect(fs.existsSync(jobDir)).toBe(false);
	});

	test("모든 멤버가 terminal 상태이면 정상적으로 clean된다", () => {
		const jobDir = path.join(tmpDir, "job-terminal");
		setupCleanJob(
			jobDir,
			{
				alice: { state: "done" },
				bob: { state: "error" },
			},
			chunkReviewConfig,
		);
		expect(() => cmdClean({}, jobDir, chunkReviewConfig, tmpDir)).not.toThrow();
		expect(fs.existsSync(jobDir)).toBe(false);
	});

	test.each(["running", "queued", "retrying"] as const)(
		"%s 상태의 멤버가 있으면 clean을 거부한다",
		(state) => {
			const jobDir = path.join(tmpDir, `job-${state}`);
			setupCleanJob(jobDir, { alice: { state } }, chunkReviewConfig);
			expect(() => cmdClean({}, jobDir, chunkReviewConfig, tmpDir)).toThrow("process.exit(1)");
			expect(fs.existsSync(jobDir)).toBe(true);
		},
	);
});

// ---------------------------------------------------------------------------
// cmdCollect — awaiting_resume early return
// ---------------------------------------------------------------------------

describe("cmdCollect — awaiting_resume 조기 반환", () => {
	let tmpDir: string;

	function setupCollectJob(jobDir: string, entities: Record<string, unknown>) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(
			path.join(jobDir, "job.json"),
			JSON.stringify({ id: "awaiting-resume-test" }),
		);
		const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		for (const [name, status] of Object.entries(entities)) {
			const dir = path.join(entitiesDir, name);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));
		}
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		mock.module("./job-utils", () => realJobUtils);
		mock.restore();
	});

	test("awaiting_resume 멤버가 있으면 큰 --timeout-ms에도 폴링 없이 즉시 반환하고 파킹된 멤버를 식별할 수 있다", async () => {
		const jobDir = path.join(tmpDir, "job-awaiting-resume");
		setupCollectJob(jobDir, {
			alice: { member: "alice", state: "awaiting_resume" },
		});

		// Observable proxy for "didn't burn the poll budget": the loop's only await point
		// between iterations is sleepMs — zero calls means it returned on the first pass.
		// Date.now is faked in lockstep so that if the fix is absent, the loop's real poll
		// count still converges (via the existing hardcap) in near-zero wall-clock time
		// instead of actually spinning for the real hardcap duration.
		let sleepCallCount = 0;
		const clock = { now: 1_000_000 };
		mock.module("./job-utils", () => ({
			...JobUtils,
			sleepMs: async (ms: number) => {
				const msNum = Number(ms);
				if (Number.isFinite(msNum) && msNum > 0) {
					sleepCallCount++;
					clock.now += msNum;
				}
			},
		}));
		const realDateNow = Date.now;
		Date.now = () => clock.now;

		const output: string[] = [];
		const origWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = (chunk: string | Uint8Array, ..._args: unknown[]) => {
			if (typeof chunk === "string") output.push(chunk);
			return origWrite(chunk as any);
		};

		try {
			const cacheBust = `${realDateNow()}-${Math.random()}`;
			const freshGenericJob = await import(
				`./generic-job.ts?awaiting-resume-early-return=${cacheBust}`
			);
			await freshGenericJob.cmdCollect({ "timeout-ms": 999999999 }, jobDir, chunkReviewConfig);
		} finally {
			process.stdout.write = origWrite;
			Date.now = realDateNow;
		}

		expect(sleepCallCount).toBe(0);
		expect(output.length).toBeGreaterThan(0);
		const result = JSON.parse(output[0]);
		expect(result.overallState).toBe("awaiting_resume");
		const parked = result.members.find((m: any) => m.member === "alice");
		expect(parked).toBeDefined();
		expect(parked.errorMessage).toBe("awaiting_resume");
	});
});

// ---------------------------------------------------------------------------
// cmdStop — termination wait
// ---------------------------------------------------------------------------

describe("cmdStop — 종료 대기", () => {
	let tmpDir: string;
	const spawned: ReturnType<typeof Bun.spawn>[] = [];

	function setupStopJob(jobDir: string, pid: number) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({ id: "stop-test" }));
		const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		const dir = path.join(entitiesDir, "alice");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "status.json"),
			JSON.stringify({ member: "alice", state: "running", pid }),
		);
	}

	function isAlive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		for (const child of spawned.splice(0)) {
			try {
				child.kill("SIGKILL");
			} catch {
				// already dead
			}
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
		mock.module("./job-utils", () => realJobUtils);
		mock.restore();
	});

	test("SIGTERM 후 대상 프로세스가 죽고 status가 done으로 전이된 뒤에 반환한다", async () => {
		// 대기 축은 프로세스 생존이 아니라 status.json의 state다. 자식이 죽는 것만으로는
		// cmdStop이 반환할 근거가 없다 — 실제 워커처럼 자식 종료 후 status를 done으로
		// 갱신하는 비동기 작업을 함께 띄워, cmdStop이 "그 전이"를 기다리는지 검증한다.
		const jobDir = path.join(tmpDir, "job-stop-wait");
		const child = Bun.spawn(
			["bash", "-c", "trap 'sleep 0.1; exit 0' TERM; while :; do sleep 0.05; done"],
			{ stdout: "ignore", stderr: "ignore" },
		);
		spawned.push(child);
		const pid = child.pid;
		setupStopJob(jobDir, pid);
		const statusPath = path.join(jobDir, chunkReviewConfig.entityDirName, "alice", "status.json");

		(async () => {
			while (isAlive(pid)) await new Promise((r) => setTimeout(r, 20));
			fs.writeFileSync(statusPath, JSON.stringify({ member: "alice", state: "done", pid }));
		})();

		await cmdStop({}, jobDir, chunkReviewConfig);

		expect(isAlive(pid)).toBe(false);
		const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
		expect(status.state).toBe("done");
	}, 10000);

	test("`pid가 죽어 있는 running 멤버는 status가 done으로 바뀌길 기다린 뒤 매니페스트에 outputFilePath가 채워진다`", async () => {
		const jobDir = path.join(tmpDir, "job-stop-dead-pid-output");
		const deadChild = Bun.spawn(["bash", "-c", "exit 0"], { stdout: "ignore", stderr: "ignore" });
		await deadChild.exited;
		const deadPid = deadChild.pid;
		setupStopJob(jobDir, deadPid);
		const memberDir = path.join(jobDir, chunkReviewConfig.entityDirName, "alice");
		const statusPath = path.join(memberDir, "status.json");
		const outputPath = path.join(memberDir, "output.txt");

		// stop 직전 이미 완료된 파인더를 모사: 자식은 죽어 있지만(SIGTERM은 ESRCH로 실패),
		// 워커 자신은 output.txt를 다 쓰고 나서야 status를 done으로 뒤집는다 — 그 지연을
		// 흉내내기 위해 짧은 딜레이 뒤 output.txt + done 전이를 함께 반영한다.
		setTimeout(() => {
			fs.writeFileSync(outputPath, "review output");
			fs.writeFileSync(
				statusPath,
				JSON.stringify({ member: "alice", state: "done", pid: deadPid, size_bytes: 13 }),
			);
		}, 150);

		// 검증 대상은 cmdStop이 스스로 대기 후 재스냅샷해 stdout으로 찍는 JSON이다 —
		// 테스트가 별도로 buildManifest를 다시 만들면 cmdStop이 재스냅샷을 안 해도
		// 통과해버린다. cmdStop이 실제로 쓴 stdout을 캡처해 그 JSON을 파싱한다.
		const output: string[] = [];
		const origWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: any) => {
			output.push(String(chunk));
			return true;
		}) as any;

		try {
			await cmdStop({}, jobDir, chunkReviewConfig);
		} finally {
			process.stdout.write = origWrite;
		}

		const raw = output.join("");
		const manifest = JSON.parse(raw.slice(raw.indexOf("{")));
		const alice = manifest[chunkReviewConfig.entityPlural].find((m: any) => m.member === "alice");
		expect(alice.outputFilePath).toBe(outputPath);
	}, 10000);

	test("`pid가 null인 running 멤버만 있으면 대기하지 않고 즉시 반환한다`", async () => {
		const jobDir = path.join(tmpDir, "job-stop-no-pid-no-wait");
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({ id: "stop-test" }));
		const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		const memberDir = path.join(entitiesDir, "alice");
		fs.mkdirSync(memberDir, { recursive: true });
		fs.writeFileSync(
			path.join(memberDir, "status.json"),
			// pid: null — worker-utils.ts가 CLI 자식을 spawn하기 전 1단계 기록을 흉내낸다.
			// 신호를 보낼 핸들이 없으므로 대기 집합에도 들어가면 안 된다.
			JSON.stringify({ member: "alice", state: "running", pid: null }),
		);

		// 시간 기반 단언은 flaky하므로 쓰지 않는다: sleepMs를 페이크로 잡아 폴링 루프가
		// 단 한 번도 돌지 않았음(=대기하지 않고 즉시 반환)을 호출 횟수로 증명한다.
		let sleepCallCount = 0;
		const clock = { now: 1_000_000 };
		mock.module("./job-utils", () => ({
			...JobUtils,
			sleepMs: async (ms: number) => {
				const msNum = Number(ms);
				if (Number.isFinite(msNum) && msNum > 0) {
					sleepCallCount++;
					clock.now += msNum;
				}
			},
		}));
		const realDateNow = Date.now;
		Date.now = () => clock.now;

		try {
			const cacheBust = `${realDateNow()}-${Math.random()}`;
			const freshGenericJob = await import(`./generic-job.ts?stop-no-pid-no-wait=${cacheBust}`);
			await freshGenericJob.cmdStop({}, jobDir, chunkReviewConfig);
		} finally {
			Date.now = realDateNow;
		}

		expect(sleepCallCount).toBe(0);
		const status = JSON.parse(fs.readFileSync(path.join(memberDir, "status.json"), "utf8"));
		expect(status.state).toBe("running");
	}, 10000);

	test("대기 상한을 넘으면 상한에서 포기하고 반환한다", async () => {
		const jobDir = path.join(tmpDir, "job-stop-cap");
		const child = Bun.spawn(["bash", "-c", "trap '' TERM; while :; do sleep 0.05; done"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		spawned.push(child);
		const pid = child.pid;
		setupStopJob(jobDir, pid);

		// Fast-forward: cmdStop's own wait loop polls via sleepMs/Date.now, both faked here so
		// the cap (whatever real-ms value it is) elapses in near-zero wall-clock time, the same
		// technique the sibling cmdCollect hardcap-clamp test uses.
		let sleepCallCount = 0;
		const clock = { now: 1_000_000 };
		mock.module("./job-utils", () => ({
			...JobUtils,
			sleepMs: async (ms: number) => {
				const msNum = Number(ms);
				if (Number.isFinite(msNum) && msNum > 0) {
					sleepCallCount++;
					clock.now += msNum;
				}
			},
		}));
		const realDateNow = Date.now;
		Date.now = () => clock.now;

		try {
			const cacheBust = `${realDateNow()}-${Math.random()}`;
			const freshGenericJob = await import(`./generic-job.ts?stop-wait-cap=${cacheBust}`);
			await freshGenericJob.cmdStop({}, jobDir, chunkReviewConfig);
		} finally {
			Date.now = realDateNow;
		}

		expect(sleepCallCount).toBeGreaterThan(0);
		expect(isAlive(pid)).toBe(true);
	}, 10000);
});

// cmdClean — active-member guard shares computeStatus's heartbeat-stale
// judgment: a `running` member whose heartbeat is stale (e.g. left behind by
// an external SIGKILL that bypassed the normal exit path) must not block
// clean the way a genuinely active `running` member does.
// ---------------------------------------------------------------------------

describe("cmdClean 활성 멤버 guard — heartbeat stale 판정 공유", () => {
	let tmpDir: string;
	let originalExit: typeof process.exit;

	function setupCleanJobWithStatus(
		jobDir: string,
		entities: Record<string, Record<string, unknown>>,
	) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({ id: "clean-hb-test" }));
		const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		for (const [name, status] of Object.entries(entities)) {
			const dir = path.join(entitiesDir, name);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));
		}
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
		originalExit = process.exit;
		(process as any).exit = (code?: number) => {
			throw new Error(`process.exit(${code})`);
		};
	});

	afterEach(() => {
		process.exit = originalExit;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("`running` 멤버의 lastHeartbeat가 90초 과거면 force 없이도 clean이 성공한다", () => {
		const jobDir = path.join(tmpDir, "job-stale-running");
		const staleHeartbeat = new Date(Date.now() - 90_000).toISOString();
		setupCleanJobWithStatus(jobDir, {
			alice: { member: "alice", state: "running", lastHeartbeat: staleHeartbeat },
		});
		expect(() => cmdClean({}, jobDir, chunkReviewConfig, tmpDir)).not.toThrow();
		expect(fs.existsSync(jobDir)).toBe(false);
	});

	test("`running` 멤버의 lastHeartbeat가 방금이면 clean을 여전히 거부한다 (음성 대조군)", () => {
		const jobDir = path.join(tmpDir, "job-fresh-running");
		const freshHeartbeat = new Date().toISOString();
		setupCleanJobWithStatus(jobDir, {
			alice: { member: "alice", state: "running", lastHeartbeat: freshHeartbeat },
		});
		expect(() => cmdClean({}, jobDir, chunkReviewConfig, tmpDir)).toThrow("process.exit(1)");
		expect(fs.existsSync(jobDir)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// cmdClean — 디렉터리 삭제 전 job.json의 workerPgid로 프로세스 그룹을 회수한다.
// ---------------------------------------------------------------------------

describe("cmdClean — 삭제 전 프로세스 그룹 회수", () => {
	let tmpDir: string;
	let originalExit: typeof process.exit;
	let spawnedPgids: number[];

	function setupCleanJobWithPgid(
		jobDir: string,
		workerPgid: number | null,
		workerPgidStartedAt: string | null = null,
	) {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(
			path.join(jobDir, "job.json"),
			JSON.stringify({
				id: "clean-pgid-test",
				members: [{ name: "alice", workerPgid, workerPgidStartedAt }],
			}),
		);
		const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		const dir = path.join(entitiesDir, "alice");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "status.json"),
			JSON.stringify({ member: "alice", state: "done" }),
		);
	}

	function isPgidAlive(pgid: number): boolean {
		try {
			const out = execSync("ps -o pgid= -A", { encoding: "utf8" });
			return out
				.split("\n")
				.map((l) => Number(l.trim()))
				.some((n) => n === pgid);
		} catch {
			return false;
		}
	}

	/** Same `ps -o lstart=` witness production's spawnWorkers records — used here
	 *  to build a matching or deliberately-mismatched fixture value. */
	function getLstart(pid: number): string {
		return execSync(`ps -o lstart= -p ${pid}`, { encoding: "utf8" }).trim();
	}

	// Bounded async poll — cmdClean itself sends the signal synchronously,
	// but the killed child stays a zombie (`ps` still lists it as `Z`) until
	// this process's event loop runs its SIGCHLD reap callback. A busy-wait
	// spin loop would starve that same event loop and never observe the
	// reap, so this poll must yield via a real `setTimeout`, not spin.
	async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (predicate()) return true;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return predicate();
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
		spawnedPgids = [];
		originalExit = process.exit;
		(process as any).exit = (code?: number) => {
			throw new Error(`process.exit(${code})`);
		};
	});

	afterEach(() => {
		process.exit = originalExit;
		for (const pgid of spawnedPgids) {
			try {
				process.kill(-pgid, "SIGKILL");
			} catch {
				// already gone — nothing to clean up
			}
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("job.json의 workerPgid로 기록된 살아있는 프로세스 그룹을 clean이 회수한다", async () => {
		const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const pgid = child.pid;
		if (pgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(pgid);

		// 선행 단언: 회수 전에 그룹이 실제로 살아있음을 먼저 확인한다 — 없으면
		// 사후 0개 단언이 "애초에 아무것도 없었다"와 구분되지 않는다.
		expect(isPgidAlive(pgid)).toBe(true);

		const jobDir = path.join(tmpDir, "job-pgid-alive");
		setupCleanJobWithPgid(jobDir, pgid, getLstart(pgid));

		cmdClean({}, jobDir, chunkReviewConfig, tmpDir);

		expect(await waitUntil(() => !isPgidAlive(pgid))).toBe(true);
		expect(fs.existsSync(jobDir)).toBe(false);
	});

	test("증인이 불일치하면(번호 재사용) clean은 신호를 보내지 않고 그 프로세스는 살아남는다", async () => {
		// 무관한 프로세스 — job.json에 기록된 workerPgid는 이 pid를 가리키지만,
		// 증인(workerPgidStartedAt)은 실제 값과 다르게 기록된다: "번호는 재사용됐고
		// 소유권은 다르다"의 정확한 모형.
		const bystander = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const bystanderPgid = bystander.pid;
		if (bystanderPgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(bystanderPgid);
		expect(isPgidAlive(bystanderPgid)).toBe(true);

		const jobDir = path.join(tmpDir, "job-pgid-mismatch");
		setupCleanJobWithPgid(jobDir, bystanderPgid, "Wed Jan  1 00:00:00 2020");

		cmdClean({}, jobDir, chunkReviewConfig, tmpDir);

		expect(fs.existsSync(jobDir)).toBe(false);
		// 신호가 실제로 발송됐다면(버그) SIGKILL 이후 이벤트 루프가 zombie를
		// 회수할 시간을 준다 — 그래야 "아직 zombie라 살아있어 보임"이 아니라
		// "정말 신호를 안 보내서 살아있다"를 구분할 수 있다.
		await new Promise((resolve) => setTimeout(resolve, 300));
		// 오살 방지 핵심 단언: 증인이 불일치하므로 신호가 가지 않고, 그 프로세스는
		// 살아남아야 한다.
		expect(isPgidAlive(bystanderPgid)).toBe(true);
	});

	test("workerPgid가 전부 null이면 kill을 시도하지 않고 무관한 프로세스는 살아남는다", () => {
		const bystander = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const bystanderPgid = bystander.pid;
		if (bystanderPgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(bystanderPgid);
		expect(isPgidAlive(bystanderPgid)).toBe(true);

		const jobDir = path.join(tmpDir, "job-pgid-null");
		setupCleanJobWithPgid(jobDir, null);

		cmdClean({}, jobDir, chunkReviewConfig, tmpDir);

		expect(fs.existsSync(jobDir)).toBe(false);
		// 오살 방지 음성 대조군: 이 job과 무관한 프로세스는 살아남아야 한다.
		expect(isPgidAlive(bystanderPgid)).toBe(true);
	});

	// 결함 C: cmdClean의 판정 루프가 과거엔 "mismatch"만 stderr로 보고했다.
	// "no-witness"(spawn 시점 ps 실패로 증인이 null)는 조용히 지나가고, 실행은
	// fs.rmSync에 도달해 앵커(job.json)를 지운다 — 살아있는 프로세스 그룹이
	// 이제 어떤 계층으로도 추적 불가인데 stderr엔 단서가 없었다.
	test("증인이 없는(null) pgid는 clean이 stderr에 보고하고, 신호를 보내지 않으며, 디렉터리는 지운다 (결함 C)", () => {
		const bystander = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const bystanderPgid = bystander.pid;
		if (bystanderPgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(bystanderPgid);
		// 선행 단언: 회수 전에 대상이 실제로 살아있음을 먼저 확인한다.
		expect(isPgidAlive(bystanderPgid)).toBe(true);

		const jobDir = path.join(tmpDir, "job-pgid-nowitness");
		// pgid는 유효하지만(=회수 로직에 진입) 증인은 null — 옛 코드가 조용히
		// 넘어가던 정확한 경로.
		setupCleanJobWithPgid(jobDir, bystanderPgid, null);

		const stderrChunks: string[] = [];
		const originalStderrWrite = process.stderr.write;
		(process.stderr as unknown as { write: unknown }).write = (chunk: unknown) => {
			stderrChunks.push(String(chunk));
			return true;
		};

		try {
			cmdClean({}, jobDir, chunkReviewConfig, tmpDir);
		} finally {
			process.stderr.write = originalStderrWrite;
		}

		expect(fs.existsSync(jobDir)).toBe(false);
		// 오살 방지: 증인이 없으므로 신호가 가지 않고, 프로세스는 살아남는다.
		expect(isPgidAlive(bystanderPgid)).toBe(true);
		// 핵심 단언 — 결함 C: no-witness 스킵이 stderr에 실제로 보고된다.
		expect(
			stderrChunks.some((c) => c.includes(String(bystanderPgid)) && c.includes("no-witness")),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// findOrphanJobs / reapOrphanJobs / doctorOrphanJobs — 계층 3: 고아 프로세스
// 그룹 판별식 + reap(회수)/doctor(카운트) 엔진. workerPgid는 살아있는데 그
// job에는 살아있는 진행이 없는 경우만 고아로 판정한다 (PPID=1 규칙은 정상
// 워커도 몇 초 안에 도달하는 상태라 판별식으로 쓸 수 없음이 실측으로
// 반증됨 — generic-job.ts의 findOrphanJobs 주석 참조).
// ---------------------------------------------------------------------------

describe("findOrphanJobs / reapOrphanJobs / doctorOrphanJobs", () => {
	let tmpDir: string;
	let jobsDir: string;
	let spawnedPgids: number[];

	function isPgidAlive(pgid: number): boolean {
		try {
			const out = execSync("ps -o pgid= -A", { encoding: "utf8" });
			return out
				.split("\n")
				.map((l) => Number(l.trim()))
				.some((n) => n === pgid);
		} catch {
			return false;
		}
	}

	// Bounded async poll — same reasoning as cmdClean's waitUntil above: a
	// killed child stays a zombie in `ps` until this process's event loop
	// runs its SIGCHLD reap callback, so this must yield via setTimeout.
	async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (predicate()) return true;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return predicate();
	}

	function setupOrphanJob(
		name: string,
		members: Array<{ workerPgid: number | null; workerPgidStartedAt?: string | null }>,
		memberStatus: Record<string, unknown>,
	): string {
		const jobDir = path.join(jobsDir, name);
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(
			path.join(jobDir, "job.json"),
			JSON.stringify({
				id: name,
				members: members.map((m, i) => ({
					name: `w${i}`,
					workerPgid: m.workerPgid,
					workerPgidStartedAt: m.workerPgidStartedAt ?? null,
				})),
			}),
		);
		const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		const dir = path.join(entitiesDir, "alice");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(memberStatus));
		return jobDir;
	}

	/** Same `ps -o lstart=` witness production's spawnWorkers records — used here
	 *  to build a matching or deliberately-mismatched fixture value. */
	function getLstart(pid: number): string {
		return execSync(`ps -o lstart= -p ${pid}`, { encoding: "utf8" }).trim();
	}

	function isPidAlive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	/** True iff a live process currently has pid === pgid for the given pgid
	 *  — i.e. a group LEADER is alive under that number right now. Used to
	 *  assert the fixture is actually in the "leader dead, descendant alive"
	 *  shape a defect-A test needs before trusting any post-condition. */
	function hasLiveLeaderRow(pgid: number): boolean {
		try {
			const out = execSync("ps -o pgid=,pid= -A", { encoding: "utf8" });
			return out
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length > 0)
				.some((l) => {
					const [pgidStr, pidStr] = l.split(/\s+/);
					return Number(pgidStr) === pgid && Number(pidStr) === pgid;
				});
		} catch {
			return false;
		}
	}

	/** Spawns a detached "leader" that itself spawns a plain (non-detached)
	 *  `sleep 30` descendant sharing the leader's own pgid, then blocks on a
	 *  go-file signal before exiting. This produces, on demand and without a
	 *  timing race, the exact SIGKILL/panic/OOM shape layer 3 exists for:
	 *  once triggered, the leader is gone but the descendant it started
	 *  under the same pgid is not — no live row has pid === pgid anymore.
	 *  The go-file gate exists so the caller can capture the leader's own
	 *  `ps -o lstart=` witness (spawnWorkers' real production step) BEFORE
	 *  triggering the exit, instead of racing the leader's own teardown. */
	function spawnLeaderWithDescendant(dir: string): {
		pgid: number;
		markerPath: string;
		goPath: string;
		harness: ReturnType<typeof spawn>;
	} {
		const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const scriptPath = path.join(dir, `leader-${unique}.ts`);
		const markerPath = path.join(dir, `leader-${unique}.marker`);
		const goPath = path.join(dir, `leader-${unique}.go`);
		fs.writeFileSync(
			scriptPath,
			[
				`import { spawn } from "child_process";`,
				`import fs from "fs";`,
				``,
				`const markerPath = process.argv[2];`,
				`const goPath = process.argv[3];`,
				`const sleepChild = spawn("sleep", ["30"], { stdio: "ignore" });`,
				`fs.writeFileSync(markerPath, String(sleepChild.pid));`,
				``,
				`function waitGoThenExit() {`,
				`	if (!fs.existsSync(goPath)) {`,
				`		setTimeout(waitGoThenExit, 10);`,
				`		return;`,
				`	}`,
				`	process.exit(0);`,
				`}`,
				`waitGoThenExit();`,
				``,
			].join("\n"),
			"utf8",
		);
		const harness = spawn(process.execPath, [scriptPath, markerPath, goPath], {
			detached: true,
			stdio: "ignore",
		});
		const pgid = harness.pid;
		if (pgid === undefined) throw new Error("spawn failed to produce a pid");
		return { pgid, markerPath, goPath, harness };
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
		jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });
		spawnedPgids = [];
	});

	afterEach(() => {
		for (const pgid of spawnedPgids) {
			try {
				process.kill(-pgid, "SIGKILL");
			} catch {
				// already gone — nothing to clean up
			}
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("고아 job의 살아있는 프로세스 그룹을 reapOrphanJobs가 회수한다", async () => {
		const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const pgid = child.pid;
		if (pgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(pgid);

		// 선행 단언: 회수 전에 그룹이 실제로 살아있음을 먼저 확인한다 — 없으면
		// 사후 0개 단언이 "애초에 아무것도 없었다"와 구분되지 않는다.
		expect(isPgidAlive(pgid)).toBe(true);

		setupOrphanJob("chunk-review-orphan-001", [{ workerPgid: pgid, workerPgidStartedAt: getLstart(pgid) }], {
			member: "alice",
			state: "done",
		});

		const { reaped, survivingPids } = await reapOrphanJobs(jobsDir, chunkReviewConfig, {
			graceMs: 100,
		});

		expect(reaped.length).toBe(1);
		expect(reaped[0].pgids).toContain(pgid);
		expect(await waitUntil(() => !isPgidAlive(pgid))).toBe(true);
		expect(survivingPids).toEqual([]);
	});

	test("증인이 불일치하면(번호 재사용) reapOrphanJobs는 신호를 보내지 않고 그 프로세스는 살아남는다", async () => {
		// 무관한 프로세스 — job.json은 이 pid를 workerPgid로 기록하지만, 증인
		// (workerPgidStartedAt)은 실제 값과 다르다: "PGID 번호는 재사용됐고
		// 소유권은 다르다"의 정확한 모형. reapOrphanJobs는 이 pgid에 신호를
		// 보내면 안 되고, 이 job은 reaped에 나타나면 안 된다.
		const bystander = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const bystanderPgid = bystander.pid;
		if (bystanderPgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(bystanderPgid);

		// 선행 단언: 회수 전에 그룹이 실제로 살아있음을 먼저 확인한다.
		expect(isPgidAlive(bystanderPgid)).toBe(true);

		setupOrphanJob(
			"chunk-review-mismatch-001",
			[{ workerPgid: bystanderPgid, workerPgidStartedAt: "Wed Jan  1 00:00:00 2020" }],
			{ member: "alice", state: "done" },
		);

		const { reaped } = await reapOrphanJobs(jobsDir, chunkReviewConfig, { graceMs: 100 });

		expect(reaped.find((o) => o.jobDir.includes("mismatch-001"))).toBeUndefined();
		// 핵심 단언 — 오살 방지: 증인이 불일치하므로 신호가 가지 않고, 무관한
		// 프로세스는 살아남아야 한다.
		expect(isPgidAlive(bystanderPgid)).toBe(true);
	});

	test("증인이 없는(null) job의 살아있는 PGID는 회수하지 않는다", async () => {
		const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const pgid = child.pid;
		if (pgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(pgid);
		expect(isPgidAlive(pgid)).toBe(true);

		// workerPgidStartedAt을 명시적으로 지정하지 않음 → setupOrphanJob 기본값 null.
		setupOrphanJob("chunk-review-nowitness-001", [{ workerPgid: pgid }], {
			member: "alice",
			state: "done",
		});

		const { reaped } = await reapOrphanJobs(jobsDir, chunkReviewConfig, { graceMs: 100 });

		expect(reaped.find((o) => o.jobDir.includes("nowitness-001"))).toBeUndefined();
		expect(isPgidAlive(pgid)).toBe(true);
	});

	test("정상 작동 중인 job(방금 heartbeat)은 건너뛴다 — 음성 대조군, PPID 규칙이면 실패했을 케이스", async () => {
		const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const pgid = child.pid;
		if (pgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(pgid);
		expect(isPgidAlive(pgid)).toBe(true);

		setupOrphanJob(
			"chunk-review-healthy-001",
			[{ workerPgid: pgid, workerPgidStartedAt: getLstart(pgid) }],
			{
				member: "alice",
				state: "running",
				lastHeartbeat: new Date().toISOString(),
			},
		);

		const { reaped } = await reapOrphanJobs(jobsDir, chunkReviewConfig, { graceMs: 100 });

		expect(reaped.length).toBe(0);
		// 정상 워커는 죽지 않고 살아남아야 한다 — 오살 방지의 증거.
		expect(isPgidAlive(pgid)).toBe(true);
	});

	test("workerPgid가 전부 null인 job은 findOrphanJobs 결과에 없다", () => {
		setupOrphanJob(
			"chunk-review-nopgid-001",
			[{ workerPgid: null }, { workerPgid: null }],
			{ member: "alice", state: "done" },
		);

		const orphans = findOrphanJobs(jobsDir, chunkReviewConfig);

		expect(orphans.find((o: OrphanJob) => o.jobDir.includes("nopgid-001"))).toBeUndefined();
	});

	test("doctorOrphanJobs는 죽이지 않고 findOrphanJobs와 동일한 카운트만 센다", () => {
		const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const pgid = child.pid;
		if (pgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(pgid);

		setupOrphanJob(
			"chunk-review-doctor-001",
			[{ workerPgid: pgid, workerPgidStartedAt: getLstart(pgid) }],
			{ member: "alice", state: "done" },
		);

		const found = findOrphanJobs(jobsDir, chunkReviewConfig);
		const doctorResult = doctorOrphanJobs(jobsDir, chunkReviewConfig);

		expect(doctorResult.orphanJobCount).toBe(found.length);
		expect(doctorResult.orphanPgidCount).toBe(
			found.reduce((sum: number, o: OrphanJob) => sum + o.pgids.length, 0),
		);
		// doctor는 죽이지 않는다 — 그룹은 여전히 살아있다.
		expect(isPgidAlive(pgid)).toBe(true);
	});

	test("잔여 프로세스는 stderr로 보고되고 추가 kill 시도는 없다", async () => {
		const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const pgid = child.pid;
		if (pgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(pgid);

		setupOrphanJob(
			"chunk-review-report-001",
			[{ workerPgid: pgid, workerPgidStartedAt: getLstart(pgid) }],
			{ member: "alice", state: "done" },
		);

		const stderrChunks: string[] = [];
		const originalStderrWrite = process.stderr.write;
		(process.stderr as unknown as { write: unknown }).write = (chunk: unknown) => {
			stderrChunks.push(String(chunk));
			return true;
		};

		const killCalls: Array<[number, string | undefined]> = [];
		const originalKill = process.kill;
		// kill을 no-op으로 바꿔 실제로는 신호를 보내지 않는다 — 그러면 프로세스는
		// 반드시 살아남으므로 survivingPids가 타이밍에 의존하지 않고 결정적으로
		// 채워진다.
		(process as unknown as { kill: unknown }).kill = (pid: number, signal?: string) => {
			killCalls.push([pid, signal]);
			return true;
		};

		try {
			const { survivingPids } = await reapOrphanJobs(jobsDir, chunkReviewConfig, { graceMs: 10 });
			expect(survivingPids).toContain(pgid);
			expect(stderrChunks.some((c) => c.includes(String(pgid)))).toBe(true);
			// SIGTERM 한 번, SIGKILL 한 번 — 생존을 관측한 뒤에도 추가 kill은 없다.
			const killsForGroup = killCalls.filter(([p]) => p === -pgid);
			expect(killsForGroup.length).toBe(2);
			expect(killsForGroup.map(([, sig]) => sig)).toEqual(["SIGTERM", "SIGKILL"]);
		} finally {
			process.kill = originalKill;
			process.stderr.write = originalStderrWrite;
		}
	});

	test("reapOrphanJobs의 프로덕션 기본 유예는 5000ms다", () => {
		const src = fs.readFileSync(path.join(__dirname, "generic-job.ts"), "utf8");
		expect(src).toMatch(/REAP_GRACE_MS_DEFAULT\s*=\s*5000/);
	});

	// 결함 D: `ps -o lstart=`는 LC_TIME에 따라 렌더링이 달라진다. 증인은
	// cmdStart(컨덕터 환경)에서 기록되고, SessionStart 훅의 detached 프로세스
	// (새 세션 환경)에서 대조된다 — 두 환경의 LC_TIME이 다르면 같은 프로세스가
	// 다르게 렌더돼 영구 mismatch가 되어 이 계층이 조용히 무력화된다. lstart를
	// 읽는 두 ps 호출(getProcessStartedAt·getPgidSnapshot) 모두 LC_ALL=C로
	// 로케일을 고정해야 한다.
	test("lstart를 읽는 두 ps 호출 모두 LC_ALL=C로 로케일이 고정된다 (결함 D)", () => {
		const src = fs.readFileSync(path.join(__dirname, "generic-job.ts"), "utf8");
		const execLstartLines = src
			.split("\n")
			.filter((l) => l.includes("execSync(") && l.includes("lstart"));
		// getProcessStartedAt(단일 pid 조회)과 getPgidSnapshot(전체 스냅샷) 두 곳.
		expect(execLstartLines.length).toBe(2);
		for (const line of execLstartLines) {
			expect(line).toContain("LC_ALL=C");
		}
	});

	test("고아가 0개면 유예를 기다리지 않고 즉시 반환한다", async () => {
		// jobsDir은 비어 있다 — findOrphanJobs가 0개를 판정하는 경로. 죽일 것이
		// 없는데도 SIGTERM/SIGKILL 사이의 유예를 기다리는 것은 세션 시작마다 백그
		// 라운드 bun 프로세스가 아무 이유 없이 노는 것과 같다.
		const graceMs = 5000;
		const start = Date.now();
		const { reaped } = await reapOrphanJobs(jobsDir, chunkReviewConfig, { graceMs });
		const elapsed = Date.now() - start;

		expect(reaped.length).toBe(0);
		// 이 경계는 "유예를 기다렸는가"만 가른다 — 머신 속도를 재는 것이 아니다.
		// 유예를 기다렸다면 graceMs에 근접하므로 그 절반 미만이면 안 기다린 것이다.
		// 절대값(500ms)으로 두면 부하가 걸린 머신에서 간헐 실패한다(실측 538ms).
		expect(elapsed).toBeLessThan(graceMs / 2);
	});

	test("고아가 1개 이상이면 유예를 여전히 기다린다 (음성 대조군)", async () => {
		const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const pgid = child.pid;
		if (pgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(pgid);

		setupOrphanJob(
			"chunk-review-grace-nonzero-001",
			[{ workerPgid: pgid, workerPgidStartedAt: getLstart(pgid) }],
			{ member: "alice", state: "done" },
		);

		const start = Date.now();
		const { reaped } = await reapOrphanJobs(jobsDir, chunkReviewConfig, { graceMs: 300 });
		const elapsed = Date.now() - start;

		expect(reaped.length).toBe(1);
		expect(elapsed).toBeGreaterThanOrEqual(250);
	});

	// -------------------------------------------------------------------------
	// 결함 A (회귀, acaf689c): getPgidLeaderStartTimes/judgePgidSignal이 리더
	// 행(pid === pgid)만 "살아있다"로 쳤다. 리더가 SIGKILL/패닉/OOM으로 죽고
	// 자손(codex exec, MCP 서버)만 같은 PGID에 남으면 리더 행이 없어
	// "leader-dead"로 오판되고, 그룹은 실제로 살아있는데도 회수기 양쪽
	// (findOrphanJobs/cmdClean)이 건너뛴다. 정확히 계층 3의 존재 이유인
	// 비정상 종료 케이스를 통째로 놓치는 회귀.
	// -------------------------------------------------------------------------

	test(
		"리더는 죽고 자손만 살아있는 그룹도 reapOrphanJobs가 회수한다 (결함 A 회귀)",
		async () => {
			const { pgid, markerPath, goPath, harness } = spawnLeaderWithDescendant(tmpDir);
			spawnedPgids.push(pgid);

			expect(await waitUntil(() => fs.existsSync(markerPath))).toBe(true);
			const sleepPid = Number(fs.readFileSync(markerPath, "utf8").trim());
			expect(Number.isInteger(sleepPid)).toBe(true);

			// 리더가 아직 go 신호를 기다리며 살아있는 지금, 실제 spawnWorkers가
			// 하는 것과 똑같이 spawn-time 증인을 뜬다.
			const leaderStartedAt = getLstart(pgid);

			fs.writeFileSync(goPath, "go");
			await new Promise<void>((resolve) => harness.on("exit", () => resolve()));
			// 그룹 리더가 좀비에서 완전히 회수될 여유 시간.
			await new Promise((resolve) => setTimeout(resolve, 300));

			// 선행 단언 — 픽스처가 실제로 의도한 상태인지 먼저 확인한다: 이 pgid에
			// 살아있는 행(자손)이 있고, pid === pgid인 리더 행은 없다. 이 확인 없이는
			// 아래 회수 단언이 공허해진다.
			expect(isPidAlive(sleepPid)).toBe(true);
			expect(hasLiveLeaderRow(pgid)).toBe(false);

			setupOrphanJob(
				"chunk-review-leaderdead-001",
				[{ workerPgid: pgid, workerPgidStartedAt: leaderStartedAt }],
				{ member: "alice", state: "done" },
			);

			const { reaped } = await reapOrphanJobs(jobsDir, chunkReviewConfig, { graceMs: 100 });

			expect(reaped.find((o) => o.jobDir.includes("leaderdead-001"))).toBeDefined();
			expect(await waitUntil(() => !isPidAlive(sleepPid))).toBe(true);
		},
		10000,
	);

	// 결함 A의 안전 방향 (음성 대조군): 리더가 죽었어도, 살아있는 멤버 중
	// 하나라도 기록된 리더 시작 시각(T)보다 먼저 시작했다면 그 그룹은 우리가
	// spawn하기 전부터 존재했던 남의 그룹이다 — 회수하면 안 된다. 실제 PID
	// 재사용을 기다리지 않고, 기존 mismatch 테스트와 같은 결로 기록된 증인을
	// 미래로 조작해 이 조건을 결정론적으로 모형화한다.
	test(
		"리더가 죽었어도 살아있는 멤버가 기록된 리더 시각보다 먼저 시작했으면 회수하지 않는다 (결함 A 안전 방향)",
		async () => {
			const { pgid, markerPath, goPath, harness } = spawnLeaderWithDescendant(tmpDir);
			spawnedPgids.push(pgid);

			expect(await waitUntil(() => fs.existsSync(markerPath))).toBe(true);
			const sleepPid = Number(fs.readFileSync(markerPath, "utf8").trim());
			expect(Number.isInteger(sleepPid)).toBe(true);

			fs.writeFileSync(goPath, "go");
			await new Promise<void>((resolve) => harness.on("exit", () => resolve()));
			await new Promise((resolve) => setTimeout(resolve, 300));

			// 선행 단언: 픽스처가 의도한 상태(리더 없음, 자손 살아있음)인지 확인.
			expect(isPidAlive(sleepPid)).toBe(true);
			expect(hasLiveLeaderRow(pgid)).toBe(false);

			// 기록된 리더 시각을 미래로 조작한다 — "이 그룹은 우리가 spawn하기
			// 전부터 존재했다"를 실제 PID 재사용 없이 결정론적으로 모형화.
			const fabricatedFutureLeaderStartedAt = "Tue Jan  1 00:00:00 2030";

			setupOrphanJob(
				"chunk-review-foreign-001",
				[{ workerPgid: pgid, workerPgidStartedAt: fabricatedFutureLeaderStartedAt }],
				{ member: "alice", state: "done" },
			);

			const { reaped } = await reapOrphanJobs(jobsDir, chunkReviewConfig, { graceMs: 100 });

			expect(reaped.find((o) => o.jobDir.includes("foreign-001"))).toBeUndefined();
			// 핵심 단언 — 오살 방지: 우리 것이 아니라고 판단된 살아있는 자손은 살아남아야 한다.
			expect(isPidAlive(sleepPid)).toBe(true);
		},
		10000,
	);

	// -------------------------------------------------------------------------
	// 결함 B: findOrphanJobs가 판정한 시점과 실제 SIGKILL 발사 시점 사이에 유예
	// (graceMs, 기본 5000ms)가 있다. SIGTERM이 그룹을 정상 종료시키면 그 PGID
	// 번호는 유예 도중 OS로 반납되고, 재발급될 수 있다 — SIGKILL이 그 재검증
	// 없이 나가면 무관한 새 프로세스를 오살한다. 실제 PID 재사용은 결정론적으로
	// 기다릴 수 없으므로, reapOrphanJobs의 유예-후 재스냅샷 지점만 테스트용
	// getSnapshotFn으로 갈아끼워 "번호가 재사용됐다"를 모형화한다 — 이 파일의
	// 기존 테스트가 process.kill을 no-op으로 갈아끼워 결정론을 만드는 것과 같은 결.
	// -------------------------------------------------------------------------

	test("유예 도중 PGID가 재사용된 것처럼 스냅샷을 조작하면, 재사용된 무관한 프로세스로 SIGKILL이 가지 않는다 (결함 B 회귀)", async () => {
		const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const pgid = child.pid;
		if (pgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(pgid);

		// 선행 단언: 회수 전에 그룹이 실제로 살아있음을 먼저 확인한다.
		expect(isPgidAlive(pgid)).toBe(true);
		const realStartedAt = getLstart(pgid);

		setupOrphanJob(
			"chunk-review-regrab-001",
			[{ workerPgid: pgid, workerPgidStartedAt: realStartedAt }],
			{ member: "alice", state: "done" },
		);

		// process.kill을 no-op으로 갈아끼운다 — 실제로 SIGTERM이 나가 이 pgid
		// 번호가 진짜로 해방돼 버리면 "재사용을 모형화했다"와 "진짜로 신호가
		// 갔다"를 구분할 수 없어진다. 이 기법은 이 파일의 "잔여 프로세스는
		// stderr로 보고되고 추가 kill 시도는 없다" 테스트와 동일하다.
		const killCalls: Array<[number, string | undefined]> = [];
		const originalKill = process.kill;
		(process as unknown as { kill: unknown }).kill = (pid: number, signal?: string) => {
			killCalls.push([pid, signal]);
			return true;
		};

		// 유예 후 재검증(결함 B가 추가하는 지점)에서만 쓰이는 스냅샷을 조작한다:
		// 같은 pgid가 이제는 전혀 다른(무관한) 시작 시각을 가진 것처럼 응답하게
		// 만들어, 실제 PID 재사용 없이 "번호가 재사용됐다"를 결정론적으로
		// 모형화한다. findOrphanJobs 자신의 최초 판정(진짜 ps 스냅샷)은 건드리지
		// 않으므로, SIGTERM은 여전히 나간다 — 재검증 후 SIGKILL만 막혀야 한다.
		const fakeSnapshot: PgidSnapshot = {
			leaderStartTimes: new Map([[pgid, "Wed Jan  1 00:00:00 2020"]]),
			memberStartTimes: new Map([[pgid, ["Wed Jan  1 00:00:00 2020"]]]),
		};

		try {
			const { reaped } = await reapOrphanJobs(jobsDir, chunkReviewConfig, {
				graceMs: 10,
				getSnapshotFn: () => fakeSnapshot,
			});

			// findOrphanJobs 자신의 최초 판정은 여전히 유효했다 — 이 job은 오르판으로
			// 판정되고 SIGTERM은 나간다.
			expect(reaped.find((o) => o.jobDir.includes("regrab-001"))).toBeDefined();

			const killsForGroup = killCalls.filter(([p]) => p === -pgid);
			// 핵심 단언 — 오살 방지: SIGTERM은 나갔지만, 유예 후 재검증이 불일치를
			// 감지했으므로 SIGKILL은 나가면 안 된다.
			expect(killsForGroup.map(([, sig]) => sig)).toEqual(["SIGTERM"]);
		} finally {
			process.kill = originalKill;
		}
	});
});

// ---------------------------------------------------------------------------
// judgePgidSignal — 파싱 불가한 증인이 신원 필터를 무력화하는 fail-open
// (3차 독립 code-review 결함 A). recordedStartedAt/멤버 시작 시각 모두
// `new Date(value).getTime()`(toEpochMs)으로 파싱되는데, 파싱 실패는 NaN이고
// NaN과의 모든 비교는 false다 — 그래서 recordedMs가 NaN이면 "이 멤버는 기록
// 시각보다 먼저 시작하지 않았다"로 판정돼 배제해야 할 경우를 "signal"로
// 새어나가게 한다. 이 스위트는 judgePgidSignal을 직접 단위 테스트한다 — 실제
// 프로세스를 띄우지 않고 스냅샷을 손으로 구성해 결정론적으로 검증한다.
// ---------------------------------------------------------------------------

describe("judgePgidSignal — 파싱 불가 증인 fail-open (3차 리뷰 결함 A)", () => {
	// 실제 프로세스가 필요 없는 순수 판정 단위 테스트이므로 존재하지 않는 임의의
	// pgid를 키로 쓴다 — judgePgidSignal은 snapshot 인자만 보고, `ps`를 다시
	// 호출하지 않는다.
	const pgid = 424242;
	// 기록된(가짜) spawn 시각 — 파싱 가능한 정상 문자열.
	const recordedStartedAt = "Wed Jan  4 00:00:00 2023";
	// 살아있는 멤버의 시작 시각 — recordedStartedAt보다 이틀 먼저(리뷰어가 실측한
	// 스냅샷과 같은 모양: fallback이 정확히 배제하려는 케이스).
	const memberBeforeRecorded = "Mon Jan  2 00:00:00 2023";
	// recordedStartedAt보다 나중 — fallback이 "signal"을 내야 하는 정상 케이스.
	const memberAfterRecorded = "Fri Jan  6 00:00:00 2023";

	function leaderDeadSnapshot(memberStartedAt: string): PgidSnapshot {
		return {
			leaderStartTimes: new Map(), // 리더 행 없음 — judgePgidSignal이 fallback 분기로 들어간다.
			memberStartTimes: new Map([[pgid, [memberStartedAt]]]),
		};
	}

	test("정상 경로 음성 대조군: 살아있는 멤버가 기록 시각보다 먼저 시작하면 leader-dead (배제)", () => {
		const snapshot = leaderDeadSnapshot(memberBeforeRecorded);
		expect(judgePgidSignal(pgid, recordedStartedAt, snapshot)).toBe("leader-dead");
	});

	test("정상 경로 음성 대조군: 살아있는 멤버가 기록 시각보다 나중 시작하면 signal (fallback 정상 동작)", () => {
		const snapshot = leaderDeadSnapshot(memberAfterRecorded);
		expect(judgePgidSignal(pgid, recordedStartedAt, snapshot)).toBe("signal");
	});

	test("리더가 살아있고 증인이 일치하면 signal (리더 경로는 건드리지 않았음을 확인)", () => {
		const snapshot: PgidSnapshot = {
			leaderStartTimes: new Map([[pgid, recordedStartedAt]]),
			memberStartTimes: new Map(),
		};
		expect(judgePgidSignal(pgid, recordedStartedAt, snapshot)).toBe("signal");
	});

	test("리더가 살아있고 증인이 불일치하면 mismatch (리더 경로는 건드리지 않았음을 확인)", () => {
		const snapshot: PgidSnapshot = {
			leaderStartTimes: new Map([[pgid, "Sat Jan  1 00:00:00 2000"]]),
			memberStartTimes: new Map(),
		};
		expect(judgePgidSignal(pgid, recordedStartedAt, snapshot)).toBe("mismatch");
	});

	// 결함 A 본체 — 리뷰어가 같은 스냅샷에 대해 실측한 그대로: 살아있는 멤버는
	// 기록 시각보다 이틀 먼저 시작했다(=배제해야 함). 증인이 파싱 가능하면
	// leader-dead로 배제되지만, 증인이 파싱 불가(빈 문자열/쓰레기 문자열)면
	// recordedMs가 NaN이 되어 모든 비교가 false — "signal"로 샌다.
	test("증인이 빈 문자열이면 signal로 새지 않는다 (결함 A)", () => {
		const snapshot = leaderDeadSnapshot(memberBeforeRecorded);
		expect(judgePgidSignal(pgid, "", snapshot)).toBe("no-witness");
	});

	test("증인이 파싱 불가한 쓰레기 문자열이면 signal로 새지 않는다 (결함 A)", () => {
		const snapshot = leaderDeadSnapshot(memberBeforeRecorded);
		expect(judgePgidSignal(pgid, "not-a-date", snapshot)).toBe("no-witness");
	});

	// 결함 A, 멤버측: recordedStartedAt은 파싱 가능하지만 살아있는 멤버 쪽 시작
	// 시각이 파싱 불가한 경우도 같은 비대칭이 적용돼 그 멤버가 조용히 "먼저
	// 시작 안 함"으로 계산된다 — 배제 쪽(먼저 시작함으로 취급)으로 뒤집어야 한다.
	test("멤버 시작 시각이 파싱 불가하면 그 멤버는 '먼저 시작함'으로 취급돼 signal로 새지 않는다 (결함 A, 멤버측)", () => {
		const snapshot = leaderDeadSnapshot("garbage-timestamp");
		expect(judgePgidSignal(pgid, recordedStartedAt, snapshot)).toBe("leader-dead");
	});
});

// ---------------------------------------------------------------------------
// cmdClean / findOrphanJobs — workerPgid가 아예 없는(키 자체가 없는) 멤버가
// 보고 루프보다 앞에서 걸러져 완전히 침묵하는 결함 (3차 독립 code-review
// 결함 B). agent-council/diagnose/slides-review/design-review는 job.json의
// members[]에 workerPgid 필드 자체를 쓰지 않는다 — null이 아니라 키가 없다.
// ---------------------------------------------------------------------------

describe("cmdClean / findOrphanJobs — workerPgid 부재 멤버 보고 (3차 리뷰 결함 B)", () => {
	let tmpDir: string;
	let jobsDir: string;
	let originalExit: typeof process.exit;

	function setupJobWithRawMembers(jobDir: string, rawMembers: any[], memberName = "alice"): void {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(
			path.join(jobDir, "job.json"),
			JSON.stringify({ id: path.basename(jobDir), members: rawMembers }),
		);
		const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
		fs.mkdirSync(entitiesDir, { recursive: true });
		const dir = path.join(entitiesDir, memberName);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "status.json"),
			JSON.stringify({ member: memberName, state: "done" }),
		);
	}

	function captureStderr(): { chunks: string[]; restore: () => void } {
		const chunks: string[] = [];
		const original = process.stderr.write;
		(process.stderr as unknown as { write: unknown }).write = (chunk: unknown) => {
			chunks.push(String(chunk));
			return true;
		};
		return {
			chunks,
			restore: () => {
				process.stderr.write = original;
			},
		};
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
		jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });
		originalExit = process.exit;
		(process as any).exit = (code?: number) => {
			throw new Error(`process.exit(${code})`);
		};
	});

	afterEach(() => {
		process.exit = originalExit;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("cmdClean은 workerPgid가 아예 없는 멤버를 삭제 전에 stderr로 보고하고, 디렉터리는 지운다 (결함 B)", () => {
		const jobDir = path.join(jobsDir, "chunk-review-nopgidkey-001");
		setupJobWithRawMembers(jobDir, [{ name: "alice" }]);

		const { chunks, restore } = captureStderr();
		try {
			cmdClean({}, jobDir, chunkReviewConfig, jobsDir);
		} finally {
			restore();
		}

		expect(fs.existsSync(jobDir)).toBe(false);
		expect(
			chunks.some(
				(c) => c.includes("alice") && c.includes("workerPgid") && c.includes(pgidVerdictReason("no-witness")),
			),
		).toBe(true);
	});

	test("findOrphanJobs는 workerPgid가 아예 없는 멤버를 stderr로 보고한다 (결함 B)", () => {
		const jobDir = path.join(jobsDir, "chunk-review-nopgidkey-002");
		setupJobWithRawMembers(jobDir, [{ name: "bob" }]);

		const { chunks, restore } = captureStderr();
		let orphans: OrphanJob[];
		try {
			orphans = findOrphanJobs(jobsDir, chunkReviewConfig);
		} finally {
			restore();
		}

		// 정책은 안 바뀐다 — workerPgid가 없으면 여전히 회수 후보에 오르지 않는다.
		expect(orphans.find((o) => o.jobDir.includes("nopgidkey-002"))).toBeUndefined();
		expect(
			chunks.some(
				(c) => c.includes("bob") && c.includes("workerPgid") && c.includes(pgidVerdictReason("no-witness")),
			),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// findActiveMembers / findOrphanJobs / cmdClean — entitiesDir을 못 읽으면
// indeterminate(null)로 취급해야 한다 (외부 코드리뷰 P2). entitiesDir 부재는
// 여전히 "활동 없음"([])이지만, 존재하는데 못 읽는 것(readdirSync throw)은
// "활동 없음"의 증거가 아니다 — 세 계층 모두 그 방향(안 지운다/안 죽인다)으로
// 닫혀야 한다.
// ---------------------------------------------------------------------------

describe("findActiveMembers / findOrphanJobs / cmdClean — entitiesDir 읽기 실패 시 indeterminate", () => {
	let tmpDir: string;
	let jobsDir: string;
	let originalExit: typeof process.exit;
	let spawnedPgids: number[];

	/** entitiesDir 경로에 디렉터리 대신 평범한 파일을 만든다 — existsSync는
	 *  통과하고 readdirSync가 ENOTDIR로 throw한다. chmod 000보다 이식성이
	 *  좋다(루트로 도는 CI에서는 권한이 무의미해질 수 있음). */
	function setupJobWithUnreadableEntitiesDir(
		jobDir: string,
		members: Array<{ workerPgid: number | null; workerPgidStartedAt?: string | null }> = [],
	): string {
		fs.mkdirSync(jobDir, { recursive: true });
		fs.writeFileSync(
			jobDir + "/job.json",
			JSON.stringify({
				id: path.basename(jobDir),
				members: members.map((m, i) => ({
					name: `w${i}`,
					workerPgid: m.workerPgid,
					workerPgidStartedAt: m.workerPgidStartedAt ?? null,
				})),
			}),
		);
		const entitiesDir = path.join(jobDir, chunkReviewConfig.entityDirName);
		// 디렉터리가 아니라 파일 — readdirSync(entitiesDir)가 ENOTDIR로 throw.
		fs.writeFileSync(entitiesDir, "not a directory");
		return entitiesDir;
	}

	function isPgidAlive(pgid: number): boolean {
		try {
			const out = execSync("ps -o pgid= -A", { encoding: "utf8" });
			return out
				.split("\n")
				.map((l) => Number(l.trim()))
				.some((n) => n === pgid);
		} catch {
			return false;
		}
	}

	/** spawnWorkers의 실제 프로덕션 단계가 기록하는 것과 같은 `ps -o lstart=`
	 *  증인 — 신원 검사(judgePgidSignal)를 통과시키기 위한 값. */
	function getLstart(pid: number): string {
		return execSync(`ps -o lstart= -p ${pid}`, { encoding: "utf8" }).trim();
	}

	function captureStderr(): { chunks: string[]; restore: () => void } {
		const chunks: string[] = [];
		const original = process.stderr.write;
		(process.stderr as unknown as { write: unknown }).write = (chunk: unknown) => {
			chunks.push(String(chunk));
			return true;
		};
		return {
			chunks,
			restore: () => {
				process.stderr.write = original;
			},
		};
	}

	beforeEach(() => {
		tmpDir = makeTmpDir();
		jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });
		originalExit = process.exit;
		(process as any).exit = (code?: number) => {
			throw new Error(`process.exit(${code})`);
		};
		spawnedPgids = [];
	});

	afterEach(() => {
		process.exit = originalExit;
		for (const pgid of spawnedPgids) {
			try {
				process.kill(-pgid, "SIGKILL");
			} catch {
				// already gone — nothing to clean up
			}
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("readdirSync가 throw하는 entitiesDir에 대해 findActiveMembers는 null을 낸다", () => {
		const jobDir = path.join(jobsDir, "chunk-review-unreadable-001");
		const entitiesDir = setupJobWithUnreadableEntitiesDir(jobDir);

		expect(findActiveMembers(entitiesDir)).toBeNull();
	});

	test("entitiesDir을 못 읽는 job을 findOrphanJobs는 고아로 반환하지 않는다 — 살아있는 실제 프로세스 그룹으로 신원 검사를 통과시킨다", () => {
		const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
		const pgid = child.pid;
		if (pgid === undefined) throw new Error("spawn failed to produce a pid");
		spawnedPgids.push(pgid);

		// 선행 단언 — 회수 판정 전에 그룹이 실제로 살아있음을 확인한다. 이게
		// 없으면 사후 "고아 아님" 단언이 "애초에 아무것도 없었다"와 구분되지
		// 않는다.
		expect(isPgidAlive(pgid)).toBe(true);

		const jobDir = path.join(jobsDir, "chunk-review-unreadable-002");
		setupJobWithUnreadableEntitiesDir(jobDir, [
			{ workerPgid: pgid, workerPgidStartedAt: getLstart(pgid) },
		]);

		const { chunks, restore } = captureStderr();
		let orphans: OrphanJob[];
		try {
			orphans = findOrphanJobs(jobsDir, chunkReviewConfig);
		} finally {
			restore();
		}

		// 핵심 단언 — entitiesDir을 못 읽었다는 사실이 "활동 없음"으로 둔갑해
		// 살아있는 워커 그룹을 고아로 잘못 판정하면 안 된다.
		expect(orphans.find((o) => o.jobDir.includes("unreadable-002"))).toBeUndefined();
		// 조용히 건너뛰지 않는다 — 회수기가 안 도는 상태를 알아챌 수 있어야 한다.
		expect(chunks.some((c) => c.includes("unreadable-002"))).toBe(true);
		// 살아있는 그룹은 그대로 살아있어야 한다 — 오살 방지의 증거.
		expect(isPgidAlive(pgid)).toBe(true);
	});

	test("entitiesDir을 못 읽는 job에 대해 cmdClean은 force 없이는 거부하고, force를 주면 진행한다", () => {
		const jobDirReject = path.join(jobsDir, "chunk-review-unreadable-003");
		setupJobWithUnreadableEntitiesDir(jobDirReject);

		expect(() => cmdClean({}, jobDirReject, chunkReviewConfig, jobsDir)).toThrow("process.exit(1)");
		// 거부됐으니 디렉터리는 그대로 남아있어야 한다.
		expect(fs.existsSync(jobDirReject)).toBe(true);

		const jobDirForce = path.join(jobsDir, "chunk-review-unreadable-004");
		setupJobWithUnreadableEntitiesDir(jobDirForce);

		expect(() => cmdClean({ force: true }, jobDirForce, chunkReviewConfig, jobsDir)).not.toThrow();
		expect(fs.existsSync(jobDirForce)).toBe(false);
	});
});

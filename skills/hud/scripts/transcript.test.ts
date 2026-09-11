import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
	parseTranscript,
	modelToTier,
	getTranscriptReadStats,
	resetTranscriptReadStats,
} from "./transcript.ts";
import { mkdir, writeFile, rm, readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { initCache } from "./cache.ts";
import { splitJsonlBytes } from "./transcript-cache.ts";
import { randomUUID } from "crypto";
import { createHash } from "crypto";

describe("splitJsonlBytes", () => {
	it("keeps an incomplete UTF-8 JSONL suffix for the next append", () => {
		const first = Buffer.from('{"name":"équipe"', "utf8");
		const result = splitJsonlBytes(Buffer.concat([first, Buffer.from("\n")]), Buffer.alloc(0));
		expect(result.lines.map((line) => line.toString("utf8"))).toEqual(['{"name":"équipe"']);
		expect(result.pending).toEqual(Buffer.alloc(0));

		const partial = Buffer.from('{"name":"équipe"', "utf8");
		const pending = splitJsonlBytes(partial, Buffer.alloc(0));
		expect(pending.lines).toHaveLength(0);
		const completed = splitJsonlBytes(Buffer.from("}\n", "utf8"), pending.pending);
		expect(completed.lines.map((line) => line.toString("utf8"))).toEqual(['{"name":"équipe"}']);
	});
});

describe("parseTranscript", () => {
	const testDir = join(tmpdir(), "hud-transcript-test-" + randomUUID());

	beforeAll(async () => {
		await mkdir(testDir, { recursive: true });
		await mkdir(join(testDir, "cache"), { recursive: true });
		initCache(join(testDir, "cache"));
	});

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("should return default values when file does not exist", async () => {
		const nonExistentPath = join(testDir, "nonexistent.jsonl");

		const result = await parseTranscript(nonExistentPath);

		expect(result.runningAgents).toBe(0);
		expect(result.activeSkill).toBeNull();
	});

	it("should track active skill from Skill tool calls", async () => {
		const transcriptPath = join(testDir, "skill-transcript.jsonl");
		const lines = [JSON.stringify({ tool: "Skill", name: "prometheus", status: "started" })];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.activeSkill).toBe("prometheus");
	});

	it("should track active skill using toolName field", async () => {
		const transcriptPath = join(testDir, "skill-toolname-transcript.jsonl");
		const lines = [JSON.stringify({ toolName: "Skill", name: "sisyphus", status: "started" })];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.activeSkill).toBe("sisyphus");
	});

	it("should count running agents from Agent tool calls", async () => {
		const transcriptPath = join(testDir, "agents-transcript.jsonl");
		const lines = [
			JSON.stringify({ tool: "Agent", status: "started", id: "agent1" }),
			JSON.stringify({ tool: "Agent", status: "running", id: "agent2" }),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.runningAgents).toBeGreaterThanOrEqual(0);
	});

	it("should skip malformed JSON lines", async () => {
		const transcriptPath = join(testDir, "malformed-transcript.jsonl");
		const lines = ["{ invalid json }", JSON.stringify({ tool: "Skill", name: "explore" })];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.activeSkill).toBe("explore");
	});

	it("should return last active skill when multiple skills are invoked", async () => {
		const transcriptPath = join(testDir, "multiple-skills-transcript.jsonl");
		const lines = [
			JSON.stringify({ tool: "Skill", name: "prometheus" }),
			JSON.stringify({ tool: "Skill", name: "sisyphus" }),
			JSON.stringify({ tool: "Skill", name: "oracle" }),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.activeSkill).toBe("oracle");
	});

	it("should track session start timestamp from first entry", async () => {
		const transcriptPath = join(testDir, "session-timestamp.jsonl");
		const timestamp1 = "2024-01-15T10:30:00.000Z";
		const timestamp2 = "2024-01-15T10:35:00.000Z";
		const lines = [
			JSON.stringify({ type: "assistant", timestamp: timestamp1 }),
			JSON.stringify({ type: "user", timestamp: timestamp2 }),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.sessionStartedAt).toEqual(new Date(timestamp1));
	});

	it("should return null sessionStartedAt when no timestamps exist", async () => {
		const transcriptPath = join(testDir, "no-timestamp.jsonl");
		const lines = [JSON.stringify({ type: "assistant" }), JSON.stringify({ type: "user" })];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.sessionStartedAt).toBeNull();
	});

	it("should return earliest timestamp as sessionStartedAt", async () => {
		const transcriptPath = join(testDir, "multiple-timestamps.jsonl");
		const earliest = "2024-01-15T09:00:00.000Z";
		const middle = "2024-01-15T10:00:00.000Z";
		const latest = "2024-01-15T11:00:00.000Z";
		const lines = [
			JSON.stringify({ type: "user", timestamp: middle }),
			JSON.stringify({ type: "assistant", timestamp: earliest }),
			JSON.stringify({ type: "user", timestamp: latest }),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.sessionStartedAt).toEqual(new Date(earliest));
	});

	it("should return empty agents array when file does not exist", async () => {
		const nonExistentPath = join(testDir, "nonexistent-agents.jsonl");

		const result = await parseTranscript(nonExistentPath);

		expect(result.agents).toEqual([]);
	});

	it("should not track assistant messages as agents (only running subagents)", async () => {
		const transcriptPath = join(testDir, "main-agent.jsonl");
		const lines = [
			JSON.stringify({
				type: "assistant",
				message: { model: "claude-sonnet-4-20250514" },
				uuid: "main-123",
			}),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		// Assistant messages are no longer tracked as agents
		// Only running subagents are shown
		expect(result.agents).toEqual([]);
	});

	it("should extract subagent info from Agent tool calls", async () => {
		const transcriptPath = join(testDir, "subagent.jsonl");
		const lines = [
			JSON.stringify({
				tool: "Agent",
				status: "started",
				toolUseId: "task-456",
				model: "claude-opus-4-20250514",
			}),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.agents).toContainEqual({
			type: "S",
			model: "o",
			id: "task-456",
		});
	});

	it("should track only running subagents with different models", async () => {
		const transcriptPath = join(testDir, "multiple-agents.jsonl");
		const lines = [
			JSON.stringify({
				type: "assistant",
				message: { model: "claude-opus-4-20250514" },
				uuid: "main-1",
			}),
			JSON.stringify({
				tool: "Agent",
				status: "started",
				toolUseId: "sub-1",
				model: "claude-sonnet-4-20250514",
			}),
			JSON.stringify({
				tool: "Agent",
				status: "started",
				toolUseId: "sub-2",
				model: "claude-3-5-haiku-20241022",
			}),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		// Only running subagents are tracked (assistant messages are ignored)
		expect(result.agents).toHaveLength(2);
		expect(result.agents).toContainEqual({ type: "S", model: "s", id: "sub-1" });
		expect(result.agents).toContainEqual({ type: "S", model: "h", id: "sub-2" });
	});

	it("should remove agents when they complete", async () => {
		const transcriptPath = join(testDir, "agent-completion.jsonl");
		const lines = [
			JSON.stringify({
				tool: "Agent",
				status: "started",
				toolUseId: "task-1",
				model: "claude-sonnet-4-20250514",
			}),
			JSON.stringify({
				tool: "Agent",
				status: "started",
				toolUseId: "task-2",
				model: "claude-haiku-3-20240307",
			}),
			JSON.stringify({
				tool: "Agent",
				status: "completed",
				toolUseId: "task-1",
			}),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		// task-1 completed, only task-2 should remain
		expect(result.agents).toHaveLength(1);
		expect(result.agents).toContainEqual({ type: "S", model: "h", id: "task-2" });
	});

	// Tests for actual Claude Code transcript structure
	// Claude Code uses: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', id: 'xxx', input: {...} }] } }
	it("should detect agent from actual Claude Code transcript structure with message.content array", async () => {
		const transcriptPath = join(testDir, "claude-code-structure.jsonl");
		const lines = [
			JSON.stringify({
				type: "assistant",
				timestamp: "2024-01-15T10:00:00.000Z",
				message: {
					model: "claude-opus-4-20250514",
					content: [
						{
							type: "tool_use",
							id: "toolu_abc123",
							name: "Agent",
							input: { prompt: "Do something" },
						},
					],
				},
			}),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.agents).toHaveLength(1);
		expect(result.agents).toContainEqual({
			type: "S",
			model: "o",
			id: "toolu_abc123",
		});
	});

	it("should track agent completion via tool_result in Claude Code transcript", async () => {
		const transcriptPath = join(testDir, "claude-code-completion.jsonl");
		const lines = [
			// Agent starts
			JSON.stringify({
				type: "assistant",
				timestamp: "2024-01-15T10:00:00.000Z",
				message: {
					model: "claude-sonnet-4-20250514",
					content: [
						{
							type: "tool_use",
							id: "toolu_task1",
							name: "Agent",
							input: { prompt: "Task 1" },
						},
					],
				},
			}),
			// Another agent starts
			JSON.stringify({
				type: "assistant",
				timestamp: "2024-01-15T10:01:00.000Z",
				message: {
					model: "claude-3-5-haiku-20241022",
					content: [
						{
							type: "tool_use",
							id: "toolu_task2",
							name: "Agent",
							input: { prompt: "Task 2" },
						},
					],
				},
			}),
			// First agent completes
			JSON.stringify({
				type: "user",
				timestamp: "2024-01-15T10:02:00.000Z",
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_task1",
							content: "Task completed",
						},
					],
				},
			}),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		// task1 completed, only task2 should remain
		expect(result.agents).toHaveLength(1);
		expect(result.agents).toContainEqual({
			type: "S",
			model: "h",
			id: "toolu_task2",
		});
	});

	it("should detect multiple agents from single message with multiple tool_use items", async () => {
		const transcriptPath = join(testDir, "claude-code-multiple-tools.jsonl");
		const lines = [
			JSON.stringify({
				type: "assistant",
				timestamp: "2024-01-15T10:00:00.000Z",
				message: {
					model: "claude-opus-4-5-20251101",
					content: [
						{
							type: "tool_use",
							id: "toolu_task_a",
							name: "Agent",
							input: { prompt: "Task A" },
						},
						{
							type: "text",
							text: "Running two tasks in parallel...",
						},
						{
							type: "tool_use",
							id: "toolu_task_b",
							name: "Agent",
							input: { prompt: "Task B" },
						},
					],
				},
			}),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.agents).toHaveLength(2);
		expect(result.agents).toContainEqual({
			type: "S",
			model: "o",
			id: "toolu_task_a",
		});
		expect(result.agents).toContainEqual({
			type: "S",
			model: "o",
			id: "toolu_task_b",
		});
	});

	it("should detect Skill from Claude Code transcript structure", async () => {
		const transcriptPath = join(testDir, "claude-code-skill.jsonl");
		const lines = [
			JSON.stringify({
				type: "assistant",
				timestamp: "2024-01-15T10:00:00.000Z",
				message: {
					model: "claude-opus-4-20250514",
					content: [
						{
							type: "tool_use",
							id: "toolu_skill1",
							name: "Skill",
							input: { skill: "prometheus" },
						},
					],
				},
			}),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.activeSkill).toBe("prometheus");
	});

	it("should extract subagent_type from Agent tool input", async () => {
		const transcriptPath = join(testDir, "task-with-subagent-type.jsonl");
		const lines = [
			JSON.stringify({
				type: "assistant",
				timestamp: "2024-01-15T10:00:00.000Z",
				message: {
					model: "claude-opus-4-20250514",
					content: [
						{
							type: "tool_use",
							id: "toolu_task_sisyphus",
							name: "Agent",
							input: {
								prompt: "Do something",
								subagent_type: "sisyphus-junior",
							},
						},
					],
				},
			}),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.agents).toHaveLength(1);
		expect(result.agents[0]).toEqual({
			type: "S",
			model: "o",
			id: "toolu_task_sisyphus",
			name: "sisyphus-junior",
		});
	});

	it("should extract multiple subagent_types from parallel Agent calls", async () => {
		const transcriptPath = join(testDir, "multiple-subagent-types.jsonl");
		const lines = [
			JSON.stringify({
				type: "assistant",
				timestamp: "2024-01-15T10:00:00.000Z",
				message: {
					model: "claude-opus-4-5-20251101",
					content: [
						{
							type: "tool_use",
							id: "toolu_explore",
							name: "Agent",
							input: { prompt: "Search codebase", subagent_type: "explore" },
						},
						{
							type: "tool_use",
							id: "toolu_oracle",
							name: "Agent",
							input: { prompt: "Analyze architecture", subagent_type: "oracle" },
						},
					],
				},
			}),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.agents).toHaveLength(2);
		expect(result.agents).toContainEqual({
			type: "S",
			model: "o",
			id: "toolu_explore",
			name: "explore",
		});
		expect(result.agents).toContainEqual({
			type: "S",
			model: "o",
			id: "toolu_oracle",
			name: "oracle",
		});
	});

	it("should handle Agent tool without subagent_type (name is undefined)", async () => {
		const transcriptPath = join(testDir, "task-no-subagent-type.jsonl");
		const lines = [
			JSON.stringify({
				type: "assistant",
				timestamp: "2024-01-15T10:00:00.000Z",
				message: {
					model: "claude-sonnet-4-20250514",
					content: [
						{
							type: "tool_use",
							id: "toolu_legacy",
							name: "Agent",
							input: { prompt: "Old style task call" },
						},
					],
				},
			}),
		];
		await writeFile(transcriptPath, lines.join("\n"));

		const result = await parseTranscript(transcriptPath);

		expect(result.agents).toHaveLength(1);
		expect(result.agents[0]).toEqual({
			type: "S",
			model: "s",
			id: "toolu_legacy",
			name: undefined,
		});
	});

	it("should reuse a persisted aggregate without rereading an unchanged transcript", async () => {
		const transcriptPath = join(testDir, "persistent-cache.jsonl");
		const lines = [
			JSON.stringify({ tool: "Agent", status: "started", toolUseId: "warm-agent", model: "opus" }),
			JSON.stringify({ tool: "Skill", name: "prometheus" }),
		];
		await writeFile(transcriptPath, lines.join("\n") + "\n", "utf8");

		resetTranscriptReadStats();
		const cold = await parseTranscript(transcriptPath);
		const coldBytes = getTranscriptReadStats();
		expect(coldBytes).toBeGreaterThan(0);
		const key = createHash("sha256").update(transcriptPath).digest("hex").slice(0, 24);
		const cacheFiles = (await readdir(join(testDir, "cache"))).filter(
			(name) => name === `hud-transcript-${key}.json`,
		);
		expect(cacheFiles).toHaveLength(1);
		const cachePath = join(testDir, "cache", cacheFiles[0]);
		const cached = JSON.parse(await readFile(cachePath, "utf8"));
		expect(cached.offset).toBe((await stat(transcriptPath)).size);

		resetTranscriptReadStats();
		const warm = await parseTranscript(transcriptPath);
		expect(getTranscriptReadStats()).toBeLessThanOrEqual(512);
		expect(warm).toEqual(cold);
	});

	it("should complete a partial UTF-8 line and then remove an agent on appended completion", async () => {
		const transcriptPath = join(testDir, "append-cache.jsonl");
		const start = JSON.stringify({
			type: "assistant",
			message: {
				model: "sonnet",
				content: [
					{
						type: "tool_use",
						id: "append-agent",
						name: "Agent",
						input: { subagent_type: "équipe" },
					},
				],
			},
		});
		await writeFile(transcriptPath, start.slice(0, -2), "utf8");
		expect((await parseTranscript(transcriptPath)).runningAgents).toBe(0);

		await writeFile(transcriptPath, start.slice(-2) + "\n", { flag: "a" });
		resetTranscriptReadStats();
		let result = await parseTranscript(transcriptPath);
		expect(getTranscriptReadStats()).toBeLessThanOrEqual(512);
		expect(result.runningAgents).toBe(1);
		expect(result.agents[0]?.name).toBe("équipe");

		await writeFile(
			transcriptPath,
			JSON.stringify({
				type: "user",
				message: { content: [{ type: "tool_result", tool_use_id: "append-agent" }] },
			}) + "\n",
			{ flag: "a" },
		);
		result = await parseTranscript(transcriptPath);
		expect(result.runningAgents).toBe(0);
	});

	it("should discard a cache when the transcript is truncated and replaced", async () => {
		const transcriptPath = join(testDir, "replacement-cache.jsonl");
		await writeFile(transcriptPath, JSON.stringify({ tool: "Skill", name: "old" }) + "\n", "utf8");
		expect((await parseTranscript(transcriptPath)).activeSkill).toBe("old");
		await writeFile(transcriptPath, JSON.stringify({ tool: "Skill", name: "new" }) + "\n", "utf8");
		expect((await parseTranscript(transcriptPath)).activeSkill).toBe("new");
	});

	it("should recover from a corrupt transcript cache", async () => {
		const transcriptPath = join(testDir, "corrupt-cache.jsonl");
		await writeFile(
			transcriptPath,
			JSON.stringify({ tool: "Skill", name: "recover" }) + "\n",
			"utf8",
		);
		await parseTranscript(transcriptPath);
		const cacheFiles = (await readdir(join(testDir, "cache"))).filter((name) =>
			name.includes("transcript"),
		);
		expect(cacheFiles.length).toBeGreaterThan(0);
		await writeFile(join(testDir, "cache", cacheFiles[cacheFiles.length - 1]), "not-json", "utf8");
		expect((await parseTranscript(transcriptPath)).activeSkill).toBe("recover");
	});

	it("should return empty state when the transcript disappears despite a warm cache", async () => {
		const transcriptPath = join(testDir, "missing-after-cache.jsonl");
		await writeFile(
			transcriptPath,
			JSON.stringify({ tool: "Skill", name: "stale" }) + "\n",
			"utf8",
		);
		expect((await parseTranscript(transcriptPath)).activeSkill).toBe("stale");
		await rm(transcriptPath);
		expect(await parseTranscript(transcriptPath)).toEqual({
			runningAgents: 0,
			activeSkill: null,
			agents: [],
			sessionStartedAt: null,
		});
	});

	it("should reject cache entries with invalid agent shapes", async () => {
		const transcriptPath = join(testDir, "invalid-cache-shape.jsonl");
		await writeFile(transcriptPath, JSON.stringify({ tool: "Skill", name: "safe" }) + "\n", "utf8");
		await parseTranscript(transcriptPath);
		const key = createHash("sha256").update(transcriptPath).digest("hex").slice(0, 24);
		const cachePath = join(testDir, "cache", `hud-transcript-${key}.json`);
		const cache = JSON.parse(await readFile(cachePath, "utf8"));
		cache.agents = [null];
		await writeFile(cachePath, JSON.stringify(cache), "utf8");
		expect((await parseTranscript(transcriptPath)).activeSkill).toBe("safe");
	});

	it("should reset when a same-file rewrite grows past the cached boundary", async () => {
		const transcriptPath = join(testDir, "rewrite-grows.jsonl");
		await writeFile(
			transcriptPath,
			JSON.stringify({ tool: "Skill", name: "before" }) + "\n",
			"utf8",
		);
		expect((await parseTranscript(transcriptPath)).activeSkill).toBe("before");
		await writeFile(
			transcriptPath,
			JSON.stringify({ tool: "Skill", name: "after", padding: "x".repeat(200) }) + "\n",
			"utf8",
		);
		expect((await parseTranscript(transcriptPath)).activeSkill).toBe("after");
	});

	it("should complete a JSONL record split inside a UTF-8 code point", async () => {
		const transcriptPath = join(testDir, "utf8-byte-split.jsonl");
		const line = Buffer.from(JSON.stringify({ tool: "Skill", name: "équipe" }) + "\n", "utf8");
		const splitAt = line.indexOf(Buffer.from("é", "utf8")) + 1;
		await writeFile(transcriptPath, line.subarray(0, splitAt));
		expect((await parseTranscript(transcriptPath)).activeSkill).toBeNull();
		await writeFile(transcriptPath, line.subarray(splitAt), { flag: "a" });
		expect((await parseTranscript(transcriptPath)).activeSkill).toBe("équipe");
	});

	it("should preserve parity for a large multi-chunk transcript", async () => {
		const transcriptPath = join(testDir, "large-multichunk.jsonl");
		const lines = Array.from({ length: 20_000 }, (_, index) =>
			JSON.stringify({
				timestamp: `2024-01-15T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
				tool: "Skill",
				name: `skill-${index}`,
			}),
		);
		await writeFile(transcriptPath, `${lines.join("\n")}\n`, "utf8");
		resetTranscriptReadStats();
		const cold = await parseTranscript(transcriptPath);
		const coldBytes = getTranscriptReadStats();
		expect(cold.activeSkill).toBe("skill-19999");
		expect(coldBytes).toBeGreaterThan(10_000);
		resetTranscriptReadStats();
		const warm = await parseTranscript(transcriptPath);
		expect(warm).toEqual(cold);
		expect(getTranscriptReadStats()).toBeLessThanOrEqual(512);
	});
});

describe("modelToTier", () => {
	it('should return "o" for opus models', () => {
		expect(modelToTier("claude-opus-4-20250514")).toBe("o");
		expect(modelToTier("claude-opus-4-5-20251101")).toBe("o");
	});

	it('should return "h" for haiku models', () => {
		expect(modelToTier("claude-3-5-haiku-20241022")).toBe("h");
		expect(modelToTier("claude-haiku-3-20240307")).toBe("h");
	});

	it('should return "s" for sonnet models', () => {
		expect(modelToTier("claude-sonnet-4-20250514")).toBe("s");
		expect(modelToTier("claude-3-5-sonnet-20241022")).toBe("s");
	});

	it('should default to "s" for unknown models', () => {
		expect(modelToTier("unknown-model")).toBe("s");
		expect(modelToTier("")).toBe("s");
	});
});

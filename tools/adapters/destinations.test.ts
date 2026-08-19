import { describe, expect, test } from "bun:test";

import { planCategoryDestinationPaths, type DestinationCategory } from "./destinations.ts";
import type { Platform } from "../lib/types.ts";

const categories: DestinationCategory[] = ["agents", "commands", "hooks", "skills", "scripts", "rules"];

describe("planCategoryDestinationPaths", () => {
	test("plans every supported platform/category destination with the adapter suffix", () => {
		const cases: Array<[Platform, DestinationCategory, string[]]> = [
			["claude", "agents", [".claude/agents/agent.md"]],
			["claude", "commands", [".claude/commands/command.md"]],
			["claude", "hooks", [".claude/hooks/hook"]],
			["claude", "skills", [".claude/skills/skill"]],
			["claude", "scripts", [".claude/scripts/script"]],
			["claude", "rules", [".claude/rules/rule.md"]],
			["gemini", "commands", [".gemini/commands/command.toml"]],
			["gemini", "hooks", [".gemini/hooks/hook"]],
			["gemini", "skills", [".gemini/skills/skill"]],
			["gemini", "scripts", [".gemini/scripts/script"]],
			["codex", "agents", [".codex/agents/agent.toml"]],
			["codex", "hooks", [".codex/hooks/hook"]],
			["codex", "skills", [".agents/skills/skill"]],
			["codex", "scripts", [".codex/scripts/script"]],
			["codex", "rules", [".codex/rules/rule.md"]],
			["opencode", "agents", [".opencode/agents/agent.md"]],
			["opencode", "commands", [".opencode/commands/command.md"]],
			["opencode", "skills", [".opencode/skills/skill"]],
			["opencode", "scripts", [".opencode/scripts/script"]],
			["opencode", "rules", [".opencode/rules/rule.md", ".opencode/opencode.json"]],
		];

		for (const [platform, category, expected] of cases) {
			expect(planCategoryDestinationPaths(platform, category, category.slice(0, -1)), `${platform}/${category}`).toEqual(expected);
		}
	});

	test("returns no destinations for every unsupported platform/category combination", () => {
		const support = new Set([
			"claude/agents", "claude/commands", "claude/hooks", "claude/skills", "claude/scripts", "claude/rules",
			"gemini/commands", "gemini/hooks", "gemini/skills", "gemini/scripts",
			"codex/agents", "codex/hooks", "codex/skills", "codex/scripts", "codex/rules",
			"opencode/agents", "opencode/commands", "opencode/skills", "opencode/scripts", "opencode/rules",
		]);
		for (const platform of ["claude", "gemini", "codex", "opencode"] as Platform[]) {
			for (const category of categories) {
				if (!support.has(`${platform}/${category}`)) {
					expect(planCategoryDestinationPaths(platform, category, "thing"), `${platform}/${category}`).toEqual([]);
				}
			}
		}
	});

	test("keeps display names as provided and uses normalized relative prefixes", () => {
		expect(planCategoryDestinationPaths("codex", "skills", "nested/name")).toEqual([
			".agents/skills/nested/name",
		]);
		expect(planCategoryDestinationPaths("opencode", "rules", "nested/name")).toEqual([
			".opencode/rules/nested/name.md",
			".opencode/opencode.json",
		]);
	});
});

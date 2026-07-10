import { describe, it, expect } from "bun:test";

import { assertMappedTier } from "./model-map.ts";
import type { ModelMap } from "./types.ts";

describe("assertMappedTier", () => {
	it("does not throw when the tier is present in modelMap.tiers via `assertMappedTier`", () => {
		const modelMap: ModelMap = { tiers: { opus: { model: "gpt-5.6-sol" } } };
		expect(() =>
			assertMappedTier(modelMap, "opus", { platform: "codex", agentFile: "oracle.md" }),
		).not.toThrow();
	});

	it("throws naming the agent file and tier when the tier is absent from modelMap.tiers via `assertMappedTier`", () => {
		const modelMap: ModelMap = { tiers: { opus: { model: "gpt-5.6-sol" } } };
		expect(() =>
			assertMappedTier(modelMap, "sonnet", { platform: "codex", agentFile: "oracle.md" }),
		).toThrow(/oracle\.md.*sonnet|sonnet.*oracle\.md/);
	});

	it("throws even when a per-agent override exists for a tier absent from modelMap.tiers via `assertMappedTier`", () => {
		const modelMap: ModelMap = {
			tiers: { opus: { model: "gpt-5.6-sol" } },
			agents: { oracle: { model: "gpt-5.6-sol-special" } },
		};
		expect(() =>
			assertMappedTier(modelMap, "sonnet", {
				platform: "codex",
				agentFile: "oracle.md",
				agentName: "oracle",
			}),
		).toThrow();
	});
});

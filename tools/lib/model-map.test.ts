import { describe, it, expect } from "bun:test";

import { assertMappedTier, listAgentVariants } from "./model-map.ts";
import type { ModelMap } from "./types.ts";

describe("assertMappedTier", () => {
	it("does not throw when the tier is present in modelMap.tiers via `assertMappedTier`", () => {
		const modelMap: ModelMap = { tiers: { opus: { model: "gpt-6.1-sol" } } };
		expect(() =>
			assertMappedTier(modelMap, "opus", { platform: "codex", agentFile: "oracle.md" }),
		).not.toThrow();
	});

	it("throws naming the agent file and tier when the tier is absent from modelMap.tiers via `assertMappedTier`", () => {
		const modelMap: ModelMap = { tiers: { opus: { model: "gpt-6.1-sol" } } };
		expect(() =>
			assertMappedTier(modelMap, "sonnet", { platform: "codex", agentFile: "oracle.md" }),
		).toThrow(/oracle\.md.*sonnet|sonnet.*oracle\.md/);
	});

	it("throws even when a per-agent override exists for a tier absent from modelMap.tiers via `assertMappedTier`", () => {
		const modelMap: ModelMap = {
			tiers: { opus: { model: "gpt-6.1-sol" } },
			agents: { oracle: { model: "gpt-6.1-sol-special" } },
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

describe("listAgentVariants", () => {
	it("variants 섹션이 없으면 빈 배열을 반환한다 via `listAgentVariants`", () => {
		const modelMap: ModelMap = { tiers: { opus: { model: "gpt-6.1-sol" } } };
		expect(listAgentVariants(modelMap, "sisyphus-junior")).toEqual([]);
	});

	it("변형 두 개를 이름순으로 정렬해 `<agent>-<suffix>` 이름과 엔트리로 반환한다 via `listAgentVariants`", () => {
		const modelMap: ModelMap = {
			tiers: { opus: { model: "gpt-6.1-sol" } },
			variants: {
				"sisyphus-junior": {
					light: { model: "gpt-6.1-mini", effort: "low" },
					deep: { model: "gpt-6.1-sol", effort: "high" },
				},
			},
		};
		expect(listAgentVariants(modelMap, "sisyphus-junior")).toEqual([
			{ name: "sisyphus-junior-deep", entry: { model: "gpt-6.1-sol", effort: "high" } },
			{ name: "sisyphus-junior-light", entry: { model: "gpt-6.1-mini", effort: "low" } },
		]);
	});

	it("다른 에이전트의 변형은 반환하지 않는다 via `listAgentVariants`", () => {
		const modelMap: ModelMap = {
			tiers: { opus: { model: "gpt-6.1-sol" } },
			variants: { oracle: { deep: { model: "gpt-6.1-sol" } } },
		};
		expect(listAgentVariants(modelMap, "sisyphus-junior")).toEqual([]);
	});

	it("modelMap이 undefined이면 빈 배열을 반환한다 via `listAgentVariants`", () => {
		expect(listAgentVariants(undefined, "sisyphus-junior")).toEqual([]);
	});
});

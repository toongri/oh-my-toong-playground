import type { ModelMap, ModelMapEntry, Platform } from "./types.ts";

/**
 * Distinguishes the model-map hard-fail from unrelated errors (e.g. malformed
 * YAML frontmatter) so a catch block can re-throw this one instead of
 * swallowing it into a copy-as-is fallback.
 */
export class ModelMapError extends Error {}

/**
 * Hard-fail guard shared by every platform adapter that applies a model-map:
 * a deployed agent's tier must be present in `modelMap.tiers`, or sync aborts
 * naming the offending agent file and tier. A per-agent override in
 * `modelMap.agents` does NOT relieve this check — the tier itself must still
 * be mapped.
 */
export function assertMappedTier(
	modelMap: ModelMap,
	tier: string,
	ctx: { platform: Platform; agentFile: string; agentName?: string },
): void {
	if (tier in modelMap.tiers) return;
	throw new ModelMapError(
		`model-map: agent '${ctx.agentFile}' declares tier '${tier}' not mapped in ${ctx.platform} model-map.tiers`,
	);
}

/**
 * Lists the extra roles declared for `agentName` in `modelMap.variants`, each
 * named `<agentName>-<suffix>`. Sorted by name so deploy output is
 * deterministic; empty when the model-map or the agent's variants are absent.
 */
export function listAgentVariants(
	modelMap: ModelMap | undefined,
	agentName: string,
): { name: string; entry: ModelMapEntry }[] {
	return Object.entries(modelMap?.variants?.[agentName] ?? {})
		.map(([suffix, entry]) => ({ name: `${agentName}-${suffix}`, entry }))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

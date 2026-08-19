import type { DeployCategory, Platform } from "../lib/types.ts";

/** Deployable component categories, including platform hook files. */
export type DestinationCategory = DeployCategory | "hooks";

/**
 * Return the concrete, deploy-root-relative paths written for a component.
 *
 * The planner is intentionally pure: it only captures the destination matrix
 * shared by adapters and sync orchestration, without touching the filesystem.
 */
export function planCategoryDestinationPaths(
	platform: Platform,
	category: DestinationCategory,
	displayName: string,
): string[] {
	switch (platform) {
		case "claude":
			return claudeDestination(category, displayName);
		case "gemini":
			return geminiDestination(category, displayName);
		case "codex":
			return codexDestination(category, displayName);
		case "opencode":
			return opencodeDestination(category, displayName);
	}
}

function claudeDestination(category: DestinationCategory, name: string): string[] {
	switch (category) {
		case "agents":
		case "commands":
		case "rules":
			return [`.claude/${category}/${name}.md`];
		case "hooks":
		case "skills":
		case "scripts":
			return [`.claude/${category}/${name}`];
		default:
			return [];
	}
}

function geminiDestination(category: DestinationCategory, name: string): string[] {
	switch (category) {
		case "commands":
			return [`.gemini/commands/${name}.toml`];
		case "hooks":
		case "skills":
		case "scripts":
			return [`.gemini/${category}/${name}`];
		default:
			return [];
	}
}

function codexDestination(category: DestinationCategory, name: string): string[] {
	switch (category) {
		case "agents":
			return [`.codex/agents/${name}.toml`];
		case "hooks":
		case "scripts":
		case "rules":
			return [`.codex/${category}/${name}${category === "rules" ? ".md" : ""}`];
		case "skills":
			return [`.agents/skills/${name}`];
		default:
			return [];
	}
}

function opencodeDestination(category: DestinationCategory, name: string): string[] {
	switch (category) {
		case "agents":
		case "commands":
			return [`.opencode/${category}/${name}.md`];
		case "skills":
		case "scripts":
			return [`.opencode/${category}/${name}`];
		case "rules":
			return [`.opencode/rules/${name}.md`, ".opencode/opencode.json"];
		default:
			return [];
	}
}

import { ParsedInput, HookInput } from "./types.ts";
import { buildCatalog, formatCatalog } from "./catalog.ts";
import { scanSkillDirectories, readEnabledPlugins } from "./scanner.ts";

export function parseInput(raw: string): ParsedInput {
	let input: HookInput = {};
	try {
		input = JSON.parse(raw);
	} catch {
		// Use defaults
	}

	const sessionId = input.sessionId || input.session_id || "default";
	const cwd = input.cwd || process.cwd();
	const hookEventName = input.hook_event_name || "UserPromptSubmit";

	return { sessionId, cwd, hookEventName };
}

export async function main(): Promise<void> {
	try {
		const input = parseInput("{}");

		// Read enabled plugins from user settings
		const enabledPlugins = readEnabledPlugins();

		// Scan skill directories
		const discoveredSkills = await scanSkillDirectories(input.cwd);

		// Build catalog from hashmap + discovered skills
		const entries = buildCatalog(discoveredSkills, enabledPlugins);

		// Format catalog text
		const additionalContext = formatCatalog(entries);

		// eslint-disable-next-line no-console -- 카탈로그 stdout 주입
		console.log(additionalContext);
	} catch {
		// Fail open on any error
		// eslint-disable-next-line no-console -- 카탈로그 stdout 주입
		console.log(formatCatalog([]));
	}
}

// Run main when executed directly
if (import.meta.main) {
	main();
}

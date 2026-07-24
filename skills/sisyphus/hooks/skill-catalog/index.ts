import { ParsedInput, HookInput, Harness } from "./types.ts";
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

// Detect which harness this script is running under. Same priority
// discipline as lib/state-core.ts's resolveSessionIdOrThrow: OMT_SESSION_ID
// is authoritative when present (Claude sets it for its own session) and
// wins even if CODEX_THREAD_ID is ALSO present — falling through to
// CODEX_THREAD_ID only tests its presence when OMT_SESSION_ID is absent.
//
// This is not a symmetric "prefer Claude" default: it closes a real leak.
// Launching Claude Code from inside a Codex shell (`codex exec` spawning
// Claude as a subprocess) lets CODEX_THREAD_ID — set by the Codex PARENT —
// survive into the Claude CHILD's inherited environment, while Claude's own
// OMT_SESSION_ID is freshly set for the actual current session. Testing
// CODEX_THREAD_ID's mere presence (the old check) misread that inherited,
// stale parent value as "this is a Codex session", scanning `.agents/skills`
// instead of `.claude/skills` and silently dropping every platforms:[claude]
// skill from the catalog. Checking OMT_SESSION_ID first trusts the signal
// the CURRENT harness itself set, not one a parent process of the other type
// may have left behind — the same leaked-env-var class ledger-core.sh's
// injected `env -u OMT_SESSION_ID` prefix guards against in the opposite
// direction (hooks/ledger-core.sh).
export function detectHarness(): Harness {
	if (process.env.OMT_SESSION_ID) return "claude";
	return process.env.CODEX_THREAD_ID ? "codex" : "claude";
}

export async function main(): Promise<void> {
	try {
		const input = parseInput("{}");
		const harness = detectHarness();

		// Read enabled plugins from user settings — same harness value
		// detectHarness() already resolved, not re-derived (single decision point).
		const enabledPlugins = readEnabledPlugins(harness);

		// Scan skill directories (harness-scoped — see scanner.ts)
		const discoveredSkills = await scanSkillDirectories(input.cwd, harness);

		// Build catalog from hashmap + discovered skills
		const entries = buildCatalog(discoveredSkills, enabledPlugins);

		// Format catalog text
		const additionalContext = formatCatalog(entries, harness);

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

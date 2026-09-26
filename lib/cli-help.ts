/**
 * Shared `help` subcommand renderer for OMT state CLIs (ultragoal-state.ts and siblings).
 *
 * Each CLI declares its own command roster (name + authority + one-line effect) as its
 * single source of truth, then hands it to renderHelp() to print — so the AI driving the
 * CLI can see, in one place, which commands it may run itself versus which require a
 * human or are internal-only.
 *
 * Exports:
 *   CliCommand              — { name, authority, effect } roster entry type
 *   renderHelp(cliName, cs) — grouped, alphabetically-sorted-within-group help text
 */

export type CliCommandAuthority = "ai" | "user" | "system" | "hook";

export interface CliCommand {
	name: string;
	authority: CliCommandAuthority;
	effect: string;
}

const SECTIONS: { authority: CliCommandAuthority; header: string }[] = [
	{ authority: "ai", header: "AI-USABLE" },
	{
		authority: "user",
		header: "USER-ONLY (AI must NOT run these — show the user the full command and your reason, then end the turn and wait)",
	},
	{ authority: "system", header: "SYSTEM-ONLY (internal; not for manual use)" },
	{ authority: "hook", header: "HOOK-ONLY (invoked by hooks, not manually)" },
];

export function renderHelp(cliName: string, commands: CliCommand[]): string {
	const lines: string[] = [`${cliName} commands:`];
	for (const { authority, header } of SECTIONS) {
		const group = commands
			.filter((c) => c.authority === authority)
			.sort((a, b) => a.name.localeCompare(b.name));
		if (group.length === 0) continue;
		lines.push("", header);
		for (const c of group) lines.push(`  ${c.name} — ${c.effect}`);
	}
	return lines.join("\n") + "\n";
}

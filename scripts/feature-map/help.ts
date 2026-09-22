import { renderHelp, type CliCommand } from "@lib/cli-help";

export type FeatureMapCommand = CliCommand & {
	usage: string;
	details: string;
	examples: string[];
};

/** The complete operational command contract for the feature-map CLI. */
export const FEATURE_MAP_COMMANDS: FeatureMapCommand[] = [
	{
		name: "query",
		authority: "ai",
		usage: "query [--text TEXT] [--changed-by ID] [--project DIR]",
		effect: "finds feature maps by text or state changer",
		details:
			"Returns matching summaries with the absolute source path and current revision. It first looks up the fixed manifest; an unconfigured store returns not_found with reason storage_not_configured and next_action ask_user_for_storage.",
		examples: [
			"bun scripts/feature-map/feature-map.ts query --text inventory --project .",
			"bun scripts/feature-map/feature-map.ts query --changed-by product --project .",
		],
	},
	{
		name: "get",
		authority: "ai",
		usage: "get <id> [--project DIR]",
		effect: "reads one feature map",
		details:
			"Returns the complete Markdown document plus its absolute source path and current revision. A missing feature is not_found with reason feature_not_found; an unconfigured store is reported separately.",
		examples: ["bun scripts/feature-map/feature-map.ts get stock.view --project ."],
	},
	{
		name: "save",
		authority: "ai",
		usage: "save --file PATH --expect <new|sha256> [--project DIR]",
		effect: "validates and saves one feature map with an expected revision",
		details:
			"The input must be Markdown with YAML front matter and a nonblank body, including schema_version: 1, id, and title. The --file PATH is resolved relative to the invocation working directory, independently of --project. The CLI accepts --expect new for a new file or a raw 64-character SHA-256 revision for an update; the library API uses null for a new file. A mismatch is a conflict and never overwrites the file. CLI/API writers use locks and expected-revision guards; direct edits remain allowed and can be checked with validate.",
		examples: [
			"bun scripts/feature-map/feature-map.ts save --file ./stock.view.md --expect new --project .",
			"bun scripts/feature-map/feature-map.ts save --file ./stock.view.md --expect <revision-from-get> --project .",
		],
	},
	{
		name: "validate",
		authority: "ai",
		usage: "validate [--project DIR]",
		effect: "checks feature-map files and their Markdown schema",
		details:
			"Validates front matter, required fields, nonblank Markdown bodies, filename/id matches, duplicate feature IDs, and dangling state_changed_by references. It returns valid or invalid; run it after directly reading or editing a feature file.",
		examples: ["bun scripts/feature-map/feature-map.ts validate --project ."],
	},
	{
		name: "status",
		authority: "ai",
		usage: "status [--project DIR]",
		effect: "reports manifest and storage configuration status",
		details:
			"Uses the fixed ~/.feature-maps/<project-key>/manifest.yaml location. The first lookup bootstraps storage: null and returns not_found, reason storage_not_configured, next_action ask_user_for_storage. It checks the manifest and configured storage directory accessibility; an invalid manifest or unavailable configured directory is a runtime error and is never auto-reset. Invalid feature files are reported by validate, not status.",
		examples: ["bun scripts/feature-map/feature-map.ts status --project ."],
	},
	{
		name: "configure",
		authority: "ai",
		usage: "configure --location PATH [--project DIR]",
		effect: "sets the feature-map storage location",
		details:
			"ask the user to agree on a storage location first, then run this command. relative paths resolve against the manifest directory. The chosen missing directory is created; no data migration is performed.",
		examples: [
			"bun scripts/feature-map/feature-map.ts configure --location ./docs/features --project .",
		],
	},
];

const OVERVIEW_GUIDANCE = `
Run the source CLI directly:
  bun scripts/feature-map/feature-map.ts help
  bun scripts/feature-map/feature-map.ts --help

Every non-help command accepts --project DIR. status, query, and get first look up
the fixed ~/.feature-maps/<project-key>/manifest.yaml. The first lookup may create
only that manifest with storage: null; report not_found, reason
storage_not_configured, next_action ask_user_for_storage and ask the user to agree
on a location before configure. A missing feature is not_found with reason
feature_not_found. Never auto-reset a configured corrupt or unreadable store.

JSON output uses stable status/reason fields. Typical statuses include
"status": "ok" (query/get/save), "ready" (status), "valid" or "invalid"
(validate), "conflict", and "not_found"; query/get include source path and
revision.
Exit codes:
  0: success or expected not_found
  1: runtime error, invalid validation, or revision conflict
  2: usage error

Command usage:
${FEATURE_MAP_COMMANDS.map((entry) => `  feature-map ${entry.usage}`).join("\n")}

Use help <command> for details and examples.
`;

function commandHelp(command: FeatureMapCommand): string {
	const examples = command.examples.map((example) => `  ${example}`).join("\n");
	return [
		`feature-map ${command.name}`,
		"",
	`Usage: feature-map ${command.usage}`,
		"",
	`Effect: ${command.effect}`,
		"",
	command.details,
		"",
	"Examples:",
		examples,
		"",
	].join("\n");
}

export function renderFeatureMapHelp(command?: string): string {
	if (command === undefined || command === "") {
		const roster = FEATURE_MAP_COMMANDS.map(({ name, authority, usage, effect }) => ({
			name,
			authority,
			effect: `${usage} — ${effect}`,
		}));
		return `${renderHelp("feature-map", roster)}${OVERVIEW_GUIDANCE}`;
	}

	const found = FEATURE_MAP_COMMANDS.find((entry) => entry.name === command);
	if (!found) {
		const names = FEATURE_MAP_COMMANDS.map((entry) => entry.name).join(", ");
		throw new Error(`Unknown feature-map command '${command}'. Available commands: ${names}`);
	}
	return commandHelp(found);
}

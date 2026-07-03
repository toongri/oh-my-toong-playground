#!/usr/bin/env bun

import fs from "fs";
import path from "path";

import {
	exitWithError,
	detectHostRole,
	resolveChairmanExclusion,
	normalizeBool,
	ensureDir,
	atomicWriteJson,
	parseArgs,
	generateJobId,
	computeTerminalDoneCount,
	findProjectRoot,
} from "@lib/job-utils";

import {
	type JobConfig,
	assertMembersOrExit,
	computeStatus as frameworkComputeStatus,
	buildUiPayload as frameworkBuildUiPayload,
	spawnWorkers as frameworkSpawnWorkers,
	cmdResults as frameworkCmdResults,
	cmdStop as frameworkCmdStop,
	cmdClean as frameworkCmdClean,
	cmdCollect as frameworkCmdCollect,
	cmdResumeMember,
	gcStaleJobs,
} from "@lib/generic-job";

import { getOmtDir } from "@lib/omt-dir";

// ---------------------------------------------------------------------------
// Type-safe narrowing helpers (avoid unsound `as` assertions on unknown data)
// ---------------------------------------------------------------------------

function isNullish(value: unknown): value is null | undefined {
	return value === null || value === undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

// ---------------------------------------------------------------------------
// Council JobConfig
// ---------------------------------------------------------------------------

const COUNCIL_CONFIG: JobConfig = {
	entitySingular: "member",
	entityPlural: "members",
	entityDirName: "members",
	jobPrefix: "council-",
	uiLabel: "[Council]",
	configTopLevelKey: "council",
};

const SCRIPT_DIR = import.meta.dirname;
const PROJECT_ROOT = findProjectRoot(SCRIPT_DIR);
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const WORKER_PATH = path.join(SCRIPT_DIR, "worker.ts");

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, "council.config.yaml");
const REPO_CONFIG_FILE = path.join(PROJECT_ROOT, "council.config.yaml");

// ---------------------------------------------------------------------------
// Council-specific config parsing (preserved)
// ---------------------------------------------------------------------------

function resolveDefaultConfigFile() {
	if (fs.existsSync(SKILL_CONFIG_FILE)) return SKILL_CONFIG_FILE;
	if (fs.existsSync(REPO_CONFIG_FILE)) return REPO_CONFIG_FILE;
	return SKILL_CONFIG_FILE;
}

interface CouncilMemberConfig {
	name?: unknown;
	command?: unknown;
	emoji?: unknown;
	color?: unknown;
	model?: unknown;
	effort_level?: unknown;
	output_format?: unknown;
	env?: Record<string, string>;
}

interface CouncilConfig {
	council: {
		chairman: Record<string, unknown>;
		members: CouncilMemberConfig[];
		settings: Record<string, unknown>;
	};
}

async function parseCouncilConfig(configPath: string): Promise<CouncilConfig> {
	const fallback: CouncilConfig = {
		council: {
			chairman: { role: "auto" },
			members: [
				{ name: "claude", command: "claude -p", emoji: "🧠", color: "CYAN" },
				{ name: "codex", command: "codex exec", emoji: "🤖", color: "BLUE" },
				{ name: "gemini", command: "gemini", emoji: "💎", color: "GREEN" },
			],
			settings: { exclude_chairman_from_members: true, timeout: 120 },
		},
	};

	if (!fs.existsSync(configPath)) return fallback;

	const fileText = fs.readFileSync(configPath, "utf8");
	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(fileText);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		exitWithError(`Invalid YAML in ${configPath}: ${message}`);
	}

	if (!isPlainObject(parsed)) {
		exitWithError(
			`Invalid config in ${configPath}: expected a YAML mapping/object at the document root`,
		);
	}
	if (!parsed.council) {
		exitWithError(`Invalid config in ${configPath}: missing required top-level key 'council:'`);
	}
	if (!isPlainObject(parsed.council)) {
		exitWithError(`Invalid config in ${configPath}: 'council' must be a mapping/object`);
	}

	const merged: CouncilConfig = {
		council: {
			chairman: { ...fallback.council.chairman },
			members: Array.isArray(fallback.council.members) ? [...fallback.council.members] : [],
			settings: { ...fallback.council.settings },
		},
	};

	const council = parsed.council;

	if (!isNullish(council.chairman)) {
		if (!isPlainObject(council.chairman)) {
			exitWithError(`Invalid config in ${configPath}: 'council.chairman' must be a mapping/object`);
		}
		merged.council.chairman = { ...merged.council.chairman, ...council.chairman };
	}

	if (Object.prototype.hasOwnProperty.call(council, "members")) {
		const rawMembers = council.members;
		if (!Array.isArray(rawMembers)) {
			exitWithError(`Invalid config in ${configPath}: 'council.members' must be a list/array`);
		}
		merged.council.members = rawMembers;
	}

	if (!isNullish(council.settings)) {
		if (!isPlainObject(council.settings)) {
			exitWithError(`Invalid config in ${configPath}: 'council.settings' must be a mapping/object`);
		}
		merged.council.settings = { ...merged.council.settings, ...council.settings };
	}

	return merged;
}

// ---------------------------------------------------------------------------
// Council-specific computeStatus wrapper (maps reviewers -> members in output)
// ---------------------------------------------------------------------------

interface CouncilMemberStatus {
	member: string;
	state: string;
	startedAt: string | null;
	finishedAt: string | null;
	exitCode: number | null;
	message: string | null;
}

// Arrow function wrapping framework's computeStatus — framework now returns `members` directly.
const computeStatus = async (
	jobDir: string,
): Promise<{
	jobDir: string;
	id: string | null;
	chairmanRole: string | null;
	overallState: string;
	counts: Record<string, number>;
	members: CouncilMemberStatus[];
}> => {
	const result = await frameworkComputeStatus(jobDir, COUNCIL_CONFIG);
	return result;
};

// Council-specific UI strings
const COUNCIL_UI_STRINGS = {
	dispatch: {
		completed: "Dispatched council prompts",
		inProgress: "Dispatching council prompts",
	},
	synthesize: {
		completed: "Council results ready",
		inProgress: "Ready to synthesize",
		pending: "Waiting to synthesize",
	},
};

// ---------------------------------------------------------------------------
// Council-specific buildUiPayload wrapper (accepts members[] in statusPayload)
// ---------------------------------------------------------------------------

interface CouncilMemberStatusInput {
	member?: unknown;
	state?: unknown;
	exitCode?: unknown;
}

interface CodexPlanStep {
	step: string;
	status: string;
}

interface ClaudeTodo {
	content: string;
	status: string;
	activeForm: string;
}

// Arrow function wrapping framework's buildUiPayload — adapts `members` field and patches UI strings.
const buildUiPayload = (statusPayload: {
	overallState?: string;
	counts?: Record<string, number>;
	members?: CouncilMemberStatusInput[];
}): {
	progress: { done: number; total: number; overallState: string };
	codex: { update_plan: { plan: CodexPlanStep[] } };
	claude: { todo_write: { todos: ClaudeTodo[] } };
} => {
	// Pass members directly to framework
	const adapted = {
		overallState: statusPayload.overallState,
		counts: statusPayload.counts,
		members: (statusPayload.members || []).map((m) => ({
			member: m && !isNullish(m.member) ? m.member : null,
			state: m && !isNullish(m.state) ? m.state : "unknown",
			exitCode: m && !isNullish(m.exitCode) ? m.exitCode : null,
		})),
	};
	const result = frameworkBuildUiPayload(adapted, COUNCIL_CONFIG);

	// Patch dispatch and synth activeForm strings with council-specific wording
	const todos = result.claude.todo_write.todos;
	if (todos.length > 0) {
		const dispatchTodo = todos[0];
		if (dispatchTodo.activeForm === "Dispatched review prompts") {
			dispatchTodo.activeForm = COUNCIL_UI_STRINGS.dispatch.completed;
		} else if (dispatchTodo.activeForm === "Dispatching review prompts") {
			dispatchTodo.activeForm = COUNCIL_UI_STRINGS.dispatch.inProgress;
		}
		const synthTodo = todos[todos.length - 1];
		if (synthTodo.activeForm === "Results ready") {
			synthTodo.activeForm = COUNCIL_UI_STRINGS.synthesize.completed;
		}
		// 'Ready to synthesize' and 'Waiting to synthesize' match between framework and council
	}

	return result;
};

// ---------------------------------------------------------------------------
// Council-specific start command
// ---------------------------------------------------------------------------

function printHelp() {
	process.stdout.write(`Agent Council (job mode)

Usage:
  job.ts start [--config path] [--chairman auto|claude|codex|...] [--jobs-dir path] [--json] "question"
  job.ts start --stdin
  job.ts status [--json|--text|--checklist] [--verbose] <jobDir>
  job.ts collect [--timeout-ms N] <jobDir>
  job.ts results [--json] <jobDir>
  job.ts resume-member <jobDir> <member> "<prompt>"
  job.ts stop <jobDir>
  job.ts clean <jobDir>

Notes:
  - start returns immediately and runs members in parallel via detached Node workers
  - poll status with repeated short calls to update TODO/plan UIs in host agents
`);
}

async function cmdStatus(options: Record<string, unknown>, jobDir: string) {
	const payload = await computeStatus(jobDir);

	const wantChecklist = Boolean(options.checklist) && !options.json;
	if (wantChecklist) {
		const done = computeTerminalDoneCount(payload.counts);
		const headerId = payload.id ? ` (${payload.id})` : "";
		process.stdout.write(`Agent Council${headerId}\n`);
		process.stdout.write(
			`Progress: ${done}/${payload.counts.total} done  (running ${payload.counts.running}, queued ${payload.counts.queued})\n`,
		);
		for (const m of payload.members) {
			const state = String(m.state || "");
			const mark =
				state === "done"
					? "[x]"
					: state === "running" || state === "queued"
						? "[ ]"
						: state
							? "[!]"
							: "[ ]";
			const exitInfo = !isNullish(m.exitCode) ? ` (exit ${m.exitCode})` : "";
			process.stdout.write(`${mark} ${m.member} \u2014 ${state}${exitInfo}\n`);
		}
		return;
	}

	const wantText = Boolean(options.text) && !options.json;
	if (wantText) {
		const done = computeTerminalDoneCount(payload.counts);
		process.stdout.write(
			`members ${done}/${payload.counts.total} done; running=${payload.counts.running} queued=${payload.counts.queued}\n`,
		);
		if (options.verbose) {
			for (const m of payload.members) {
				process.stdout.write(
					`- ${m.member}: ${m.state}${!isNullish(m.exitCode) ? ` (exit ${m.exitCode})` : ""}\n`,
				);
			}
		}
		return;
	}

	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function cmdStart(options: Record<string, unknown>, prompt: string) {
	const configPath =
		asOptionalString(options.config) || process.env.COUNCIL_CONFIG || resolveDefaultConfigFile();
	const jobsDir =
		asOptionalString(options["jobs-dir"]) ||
		process.env.COUNCIL_JOBS_DIR ||
		path.join(getOmtDir(), "jobs");

	ensureDir(jobsDir);
	gcStaleJobs(jobsDir, COUNCIL_CONFIG);

	const hostRole = detectHostRole(SKILL_DIR);
	const config = await parseCouncilConfig(configPath);
	const chairmanRoleRaw =
		asOptionalString(options.chairman) ||
		process.env.COUNCIL_CHAIRMAN ||
		asOptionalString(config.council.chairman.role) ||
		"auto";

	// Pre-normalize via the same normalizeBool the framework applies internally, so passing an
	// already-normalized boolean|null through is idempotent (identical outcome for every input shape)
	// while satisfying resolveChairmanExclusion's `boolean | null | undefined` parameter type.
	const rawExcludeSetting = config.council.settings.exclude_chairman_from_members;
	const configExcludeSetting: boolean | null | undefined =
		typeof rawExcludeSetting === "boolean" ? rawExcludeSetting : normalizeBool(rawExcludeSetting);

	const { chairmanRole, excludeChairmanFromMembers, filterMember } = resolveChairmanExclusion({
		options,
		configExcludeSetting,
		hostRole,
		chairmanRoleRaw,
	});

	const timeoutSetting = Number(config.council.settings.timeout || 0);
	const timeoutOverride = !isNullish(options.timeout) ? Number(options.timeout) : null;
	const timeoutSec =
		timeoutOverride !== null && Number.isFinite(timeoutOverride) && timeoutOverride > 0
			? timeoutOverride
			: timeoutSetting > 0
				? timeoutSetting
				: 0;

	const requestedMembers = config.council.members || [];
	const members = requestedMembers.filter(filterMember);
	assertMembersOrExit(members, COUNCIL_CONFIG, configPath);

	const jobId = generateJobId();
	const jobDir = path.join(jobsDir, `council-${jobId}`);
	const membersDir = path.join(jobDir, "members");
	ensureDir(membersDir);

	fs.writeFileSync(path.join(jobDir, "prompt.txt"), String(prompt), "utf8");

	const jobMeta = {
		id: `council-${jobId}`,
		createdAt: new Date().toISOString(),
		configPath,
		hostRole,
		chairmanRole,
		settings: {
			excludeChairmanFromMembers,
			timeoutSec: timeoutSec || null,
		},
		members: members.map((m) => ({
			name: String(m.name),
			command: String(m.command),
			emoji: m.emoji ? String(m.emoji) : null,
			color: m.color ? String(m.color) : null,
			model: m.model || null,
			effort_level: m.effort_level || null,
			output_format: m.output_format || null,
			env: m.env ?? {},
		})),
	};
	atomicWriteJson(path.join(jobDir, "job.json"), jobMeta);

	// Use framework spawnWorkers — it calls detectCliType + buildAugmentedCommand internally
	frameworkSpawnWorkers({
		entities: members,
		workerPath: WORKER_PATH,
		jobDir,
		entitiesDir: membersDir,
		timeoutSec,
		config: COUNCIL_CONFIG,
	});

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ jobDir, ...jobMeta }, null, 2)}\n`);
	} else {
		process.stdout.write(`${jobDir}\n`);
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const options = parseArgs(process.argv);
	const [command, ...rest] = options._;

	if (!command || options.help || options.h) {
		printHelp();
		return;
	}

	if (command === "start") {
		let prompt;
		if (options.stdin) {
			prompt = fs.readFileSync(0, "utf8");
		} else {
			prompt = rest.join(" ").trim();
		}
		if (!prompt) exitWithError("start: missing prompt");
		await cmdStart(options, prompt);
		return;
	}
	if (command === "status") {
		const jobDir = rest[0];
		if (!jobDir) exitWithError("status: missing jobDir");
		await cmdStatus(options, jobDir);
		return;
	}
	if (command === "collect") {
		const jobDir = rest[0];
		if (!jobDir) exitWithError("collect: missing jobDir");
		await frameworkCmdCollect(options, jobDir, COUNCIL_CONFIG);
		return;
	}
	if (command === "results") {
		const jobDir = rest[0];
		if (!jobDir) exitWithError("results: missing jobDir");
		frameworkCmdResults(options, jobDir, COUNCIL_CONFIG);
		return;
	}
	if (command === "resume-member") {
		const jobDirArg = rest[0];
		const nameArg = rest[1];
		const promptArg = rest.slice(2).join(" ");
		if (!jobDirArg) exitWithError("resume-member: missing jobDir");
		if (!nameArg) exitWithError("resume-member: missing member name");
		if (!promptArg) exitWithError("resume-member: missing prompt");
		await cmdResumeMember(jobDirArg, nameArg, promptArg, COUNCIL_CONFIG);
		return;
	}
	if (command === "stop") {
		const jobDir = rest[0];
		if (!jobDir) exitWithError("stop: missing jobDir");
		frameworkCmdStop(options, jobDir, COUNCIL_CONFIG);
		return;
	}
	if (command === "clean") {
		const jobDir = rest[0];
		if (!jobDir) exitWithError("clean: missing jobDir");
		const defaultJobsDir =
			asOptionalString(options["jobs-dir"]) ||
			process.env.COUNCIL_JOBS_DIR ||
			path.join(getOmtDir(), "jobs");
		frameworkCmdClean(options, jobDir, COUNCIL_CONFIG, defaultJobsDir);
		return;
	}

	exitWithError(`Unknown command: ${command}`);
}

if (import.meta.main) {
	main();
}

export {
	detectHostRole,
	ensureDir,
	safeFileName,
	atomicWriteJson,
	readJsonIfExists,
	parseArgs,
	generateJobId,
} from "@lib/job-utils";

export { buildUiPayload, parseCouncilConfig, computeStatus, COUNCIL_CONFIG };

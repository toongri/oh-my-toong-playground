/**
 * Deterministic work-log extraction for the session ledger.
 *
 * Turns a Claude Code transcript or a Codex rollout into the same plain-text
 * work log the summarizer reads. User and assistant messages get stable ids
 * (`U<n>`, `A<n>`) counted from the start of the file, so ids survive windowing.
 * The byte caps below were tuned by blind-judged replays; change them only
 * together with a re-run of those replays.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Message {
	id: string;
	text: string;
}

export interface WorkLog {
	lines: string[];
	users: Message[];
	assistants: Message[];
	editedFiles: string[];
}

const PASTE_LIMIT = 3000;
const SKILL_LIMIT = 4000;
const READ_LIMIT = 1200;
const AGENT_RESULT_LIMIT = 20000;
const TOOL_ERROR_LIMIT = 600;
const COMMAND_LIMIT = 2800;
const SKILL_PREFIX = "Base directory for this skill: ";
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const HOOK_CONTEXT =
	/<(ultrawork-mode|analyze-mode|search-mode|session-restore|pins|session-recording)>[\s\S]*?<\/\1>/g;
const OUTCOME_LINE =
	/\b(Tasks:|Tests?:|Test Files|Time:|passed|failed|failing|successful|errors?\b|FAIL\b|PASS\b|exit code|Exit code)|[✓✗✘]/i;
const KEY_ARGS = ["file_path", "path", "pattern", "description", "subagent_type", "skill", "url", "query"];

function clean(text: string): string {
	return text.replace(REMINDER, "").replace(HOOK_CONTEXT, "").trim();
}

function utf8Head(text: string, bytes: number): string {
	return Buffer.from(text).subarray(0, bytes).toString("utf8").replace(/�+$/, "");
}

function utf8Tail(text: string, bytes: number): string {
	const buf = Buffer.from(text);
	return buf.subarray(Math.max(0, buf.length - bytes)).toString("utf8").replace(/^�+/, "");
}

function byteLength(text: string): number {
	return Buffer.byteLength(text);
}

/** A long user message is almost always pasted material; keep its head and tail and mark the cut. */
export function capUserText(text: string): string {
	const size = byteLength(text);
	if (size <= PASTE_LIMIT) return text;
	return `${utf8Head(text, 1500)} …[pasted content: ${size - 2700} bytes cut]… ${utf8Tail(text, 1200)}`;
}

/** Head and tail of a long output, plus the outcome lines (test and build summaries) from the cut part. */
const OUTPUT_HEAD = 1000;
const OUTPUT_TAIL = 800;

export function outputExcerpt(body: string): string {
	const size = byteLength(body);
	if (size <= OUTPUT_HEAD + OUTPUT_TAIL) return body;
	const buf = Buffer.from(body);
	const middle = buf.subarray(OUTPUT_HEAD, buf.length - OUTPUT_TAIL).toString("utf8");
	const kept = middle
		.split("\n")
		.filter((line) => OUTCOME_LINE.test(line))
		.slice(0, 25)
		.map((line) => line.trim().slice(0, 200));
	const outcome = kept.length > 0 ? ` …[outcome lines from the cut part:] ${kept.join(" | ")}` : "";
	return `${utf8Head(body, OUTPUT_HEAD)} …[${size - OUTPUT_HEAD - OUTPUT_TAIL} bytes cut]…${outcome} … ${utf8Tail(body, OUTPUT_TAIL)}`;
}

function commandLine(command: string): string {
	const flat = command.trim().split("\n").join(" ⏎ ");
	if (flat.length <= COMMAND_LIMIT) return flat;
	return `${flat.slice(0, 2000)} …[${flat.length - COMMAND_LIMIT} chars cut]… ${flat.slice(-800)}`;
}

class LogBuilder {
	lines: string[] = [];
	users: Message[] = [];
	assistants: Message[] = [];
	edited = new Set<string>();
	private userCount = 0;
	private assistantCount = 0;
	private seenResults = new Set<string>();

	/** Ids are counted even outside the window so they stay stable. */
	user(text: string, inWindow: boolean, label = "user", storedText = text): void {
		this.userCount += 1;
		if (!inWindow) return;
		const id = `U${this.userCount}`;
		this.users.push({ id, text: storedText });
		this.lines.push(`[${id} ${label}] ${text}`);
	}

	assistant(text: string, inWindow: boolean): void {
		this.assistantCount += 1;
		if (!inWindow) return;
		const id = `A${this.assistantCount}`;
		this.assistants.push({ id, text });
		this.lines.push(`[${id} assistant] ${text}`);
	}

	/** The same notification can arrive twice (as a user record and as a queued attachment). */
	agentResult(body: string): void {
		if (body.includes("<task-notification>") && !body.includes("<result>")) {
			const summary = body.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() ?? body.replace(/\s+/g, " ");
			if (this.seenResults.has(summary)) return;
			this.seenResults.add(summary);
			this.lines.push(`[background task] ${summary}`);
			return;
		}
		const excerpt = utf8Head(body, AGENT_RESULT_LIMIT);
		const key = excerpt.slice(0, 600);
		if (this.seenResults.has(key)) return;
		this.seenResults.add(key);
		this.lines.push(`[agent result] ${excerpt}${byteLength(body) > AGENT_RESULT_LIMIT ? " …(truncated)" : ""}`);
	}

	result(): WorkLog {
		return { lines: this.lines, users: this.users, assistants: this.assistants, editedFiles: [...this.edited].sort() };
	}
}

function notificationBody(text: string): string {
	const match = text.match(/<summary>([\s\S]*?)<\/summary>[\s\S]*?<result>([\s\S]*?)<\/result>/);
	return match ? `${match[1]} :: ${match[2]}` : text;
}

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
const rec = (value: unknown): Json => (isRecord(value) ? value : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string =>
	typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);

function readJsonLines(path: string): Json[] {
	const records: Json[] = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const parsed: unknown = JSON.parse(line);
			if (isRecord(parsed)) records.push(parsed);
		} catch {
			// A partially written last line is expected while the session is live.
		}
	}
	return records;
}

// ─── Claude Code transcript ─────────────────────────────────────────────────

function claudeToolLine(name: string, input: Json): string {
	if (name === "Bash") return `[tool Bash] ${str(input.description)} :: ${commandLine(str(input.command))}`;
	if (name === "AskUserQuestion") {
		const questions = list(input.questions).map((q) => str(rec(q).question));
		return `[ask] ${questions.join(" | ")}`;
	}
	if (name === "Agent" || name === "Task") return `[agent ${str(input.subagent_type)}] ${str(input.description)}`;
	const parts = KEY_ARGS.filter((k) => k in input).map((k) =>
		k === "file_path" || k === "path" ? `${k}=${str(input[k])}` : `${k}=${str(input[k]).slice(0, 200)}`,
	);
	return `[tool ${name}] ${parts.join(" ")}`;
}

function claudeResultExcerpt(toolName: string, body: string): string {
	// File-writing tools echo what the agent already knows; file reads can be re-read.
	if (["Edit", "Write", "NotebookEdit", "TaskCreate", "TaskUpdate", "TodoWrite", "Agent", "Task"].includes(toolName)) {
		return "";
	}
	if (toolName === "Read") {
		const size = byteLength(body);
		return utf8Head(body, READ_LIMIT) + (size > READ_LIMIT ? ` …[${size - READ_LIMIT} bytes of file not shown]` : "");
	}
	return outputExcerpt(body);
}

function textOf(content: unknown, separator = "\n"): string {
	if (typeof content === "string") return content;
	return list(content)
		.map(rec)
		.filter((block) => block.type === "text" || block.type === "input_text")
		.map((block) => str(block.text))
		.join(separator);
}

/** Index of the first record after the last compaction boundary (0 when there is none). */
export function claudeWindowStart(records: Json[]): number {
	let start = 0;
	records.forEach((record, index) => {
		if (record.type === "system" && record.subtype === "compact_boundary") start = index + 1;
	});
	return start;
}

export function extractClaude(records: Json[], windowStart = 0): WorkLog {
	const log = new LogBuilder();
	const pendingAsk = new Set<string>();
	const toolNames = new Map<string, string>();

	records.forEach((record, index) => {
		const inWindow = index >= windowStart;
		if (record.isSidechain) return;

		const attachment = rec(record.attachment);
		if (record.type === "attachment" && attachment.type === "queued_command") {
			const prompt = typeof attachment.prompt === "string" ? attachment.prompt : textOf(attachment.prompt);
			if (attachment.commandMode === "task-notification" || prompt.includes("<task-notification>")) {
				if (inWindow) log.agentResult(notificationBody(prompt));
			} else if (rec(attachment.origin).kind === "human" && prompt.trim()) {
				log.user(capUserText(clean(prompt)), inWindow, "user, sent while the agent was working");
			}
			return;
		}

		const content = rec(record.message).content;
		if (record.type === "user") {
			if (record.isCompactSummary) return;
			const joined = textOf(content);
			// Skill bodies arrive as meta records, so recognize them before dropping meta.
			if (joined.startsWith(SKILL_PREFIX)) {
				if (inWindow) {
					const name = joined.split("\n")[0].slice(SKILL_PREFIX.length).replace(/\/$/, "").split("/").pop();
					const truncated = byteLength(joined) > SKILL_LIMIT ? " …(skill body truncated)" : "";
					log.lines.push(`[skill ${name}] ${utf8Head(joined, SKILL_LIMIT)}${truncated}`);
				}
				return;
			}
			if (record.isMeta) return;
			const text = clean(joined);
			if (text.includes("<task-notification>")) {
				if (inWindow) log.agentResult(notificationBody(text));
				return;
			}
			if (text.startsWith("<bash-stdout>") || text.startsWith("<bash-stderr>")) {
				if (inWindow) {
					const output = text.replace(/<\/?bash-(stdout|stderr)>/g, " ").trim();
					log.lines.push(`[result of user shell] ${outputExcerpt(output) || "(no output)"}`);
				}
				return;
			}
			if (text.startsWith("<bash-input>")) {
				const command = text.replace(/<\/?bash-input>/g, "").trim();
				log.user(command, inWindow, "user ran shell", `(ran in shell) ${command}`);
				return;
			}
			if (text.startsWith("<command-")) {
				const match = text.match(/<command-name>([\s\S]*?)<\/command-name>[\s\S]*?<command-args>([\s\S]*?)<\/command-args>/);
				if (match) log.user(`${match[1]} ${match[2]}`.trim(), inWindow);
			} else if (text && !text.startsWith("[Request interrupted") && !text.includes("<tool_use_error>")) {
				log.user(capUserText(text), inWindow);
			}
			if (!inWindow) return;
			for (const block of list(content).map(rec)) {
				if (block.type !== "tool_result") continue;
				const toolUseId = str(block.tool_use_id);
				const body = clean(typeof block.content === "string" ? block.content : textOf(block.content, " "));
				const isError = Boolean(block.is_error) || body.includes("<tool_use_error>");
				if (pendingAsk.has(toolUseId) && !isError) {
					const answer = body.replace(/\s*Read the answers carefully[\s\S]*$/, "");
					log.user(capUserText(answer), inWindow, "user answer");
				} else if (isError) {
					log.lines.push(`[tool error] ${body.slice(0, TOOL_ERROR_LIMIT)}`);
				} else {
					const excerpt = claudeResultExcerpt(toolNames.get(toolUseId) ?? "", body);
					if (excerpt) log.lines.push(`[result] ${excerpt}`);
				}
			}
			return;
		}

		if (record.type !== "assistant") return;
		for (const block of list(content).map(rec)) {
			if (block.type === "text" && str(block.text).trim()) {
				log.assistant(str(block.text).trim(), inWindow);
			} else if (block.type === "tool_use") {
				const id = str(block.id);
				const name = str(block.name);
				if (name === "AskUserQuestion") pendingAsk.add(id);
				if (!inWindow) continue;
				const input = rec(block.input);
				toolNames.set(id, name);
				if (["Edit", "Write", "NotebookEdit"].includes(name) && input.file_path) log.edited.add(str(input.file_path));
				log.lines.push(claudeToolLine(name, input));
			}
		}
	});
	return log.result();
}

// ─── Codex rollout ──────────────────────────────────────────────────────────

/** Index of the first record after the last compaction (0 when there is none). */
export function codexWindowStart(records: Json[]): number {
	let start = 0;
	records.forEach((record, index) => {
		if (record.type === "compacted") start = index + 1;
	});
	return start;
}

/** A finished subagent's final message lives in its own rollout, named after its thread id. */
export function findCodexRollout(threadId: string, sessionsRoot = join(homedir(), ".codex", "sessions")): string | null {
	if (!threadId || !existsSync(sessionsRoot)) return null;
	const suffix = `${threadId}.jsonl`;
	const stack = [sessionsRoot];
	for (let dir = stack.pop(); dir !== undefined; dir = stack.pop()) {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (entry.name.endsWith(suffix)) return full;
		}
	}
	return null;
}

function codexFinalMessage(rolloutPath: string): string {
	let last = "";
	for (const record of readJsonLines(rolloutPath)) {
		const payload = rec(record.payload);
		if (payload.type === "task_complete" && payload.last_agent_message) last = str(payload.last_agent_message);
	}
	return last;
}

function codexCommand(command: unknown): string {
	// ["/bin/zsh", "-lc", "<script>"] — the script is what the agent ran.
	return Array.isArray(command) ? str(command[command.length - 1]) : str(command);
}

function readSkill(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return `(skill file ${path} not readable)`;
	}
}

export function extractCodex(records: Json[], windowStart = 0, sessionsRoot?: string): WorkLog {
	const log = new LogBuilder();
	records.forEach((record, index) => {
		const inWindow = index >= windowStart;
		const payload = rec(record.payload);
		if (record.type !== "event_msg" || payload.type !== "item_completed") return;
		const item = rec(payload.item);
		if (item.type === "UserMessage") {
			const parts = list(item.content).map(rec);
			const text = parts
				.filter((p) => p.type === "text")
				.map((p) => str(p.text))
				.join("\n")
				.trim();
			if (inWindow) {
				for (const skill of parts.filter((p) => p.type === "skill")) {
					const body = readSkill(str(skill.path));
					const truncated = byteLength(body) > SKILL_LIMIT ? " …(skill body truncated)" : "";
					log.lines.push(`[skill ${str(skill.name)}] ${utf8Head(body, SKILL_LIMIT)}${truncated}`);
				}
			}
			if (text) log.user(capUserText(clean(text)), inWindow);
			return;
		}
		if (item.type === "AgentMessage") {
			const text = list(item.content)
				.map((p) => str(rec(p).text))
				.join("\n")
				.trim();
			if (text) log.assistant(text, inWindow);
			return;
		}
		if (!inWindow) return;
		switch (item.type) {
			case "CommandExecution": {
				log.lines.push(`[tool Bash] :: ${commandLine(codexCommand(item.command))}`);
				const output = str(item.aggregated_output ?? item.stdout).trim();
				const exit = item.exit_code === undefined || item.exit_code === null ? "" : `exit ${str(item.exit_code)}: `;
				log.lines.push(`[result] ${exit}${outputExcerpt(output) || "(no output)"}`);
				return;
			}
			case "FileChange":
				for (const [path, change] of Object.entries(rec(item.changes))) {
					log.edited.add(path);
					log.lines.push(`[tool Edit] file_path=${path} (${str(rec(change).type) || "change"})`);
				}
				return;
			case "McpToolCall": {
				log.lines.push(`[tool ${str(item.server)}.${str(item.tool)}] ${JSON.stringify(item.arguments ?? {}).slice(0, 200)}`);
				const text = textOf(rec(item.result).content);
				if (text) log.lines.push(`[result] ${outputExcerpt(text)}`);
				return;
			}
			case "Extension":
				log.lines.push(`[tool ${str(item.kind) || "extension"}] query=${str(item.query).slice(0, 200)}`);
				return;
			case "SubAgentActivity":
				if (item.kind === "started") {
					log.lines.push(`[agent] ${str(item.agent_path)}`);
				} else if (item.kind === "completed") {
					const path = findCodexRollout(str(item.agent_thread_id), sessionsRoot);
					const final = path ? codexFinalMessage(path) : "";
					log.agentResult(`Agent ${str(item.agent_path)} finished :: ${final || "(final message not found)"}`);
				}
				return;
		}
	});
	return log.result();
}

export function readTranscript(path: string): Json[] {
	return readJsonLines(path);
}

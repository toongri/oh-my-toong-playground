#!/usr/bin/env bun

/**
 * Native compaction probe for Codex 0.153+.
 *
 * This is intentionally standalone: it talks JSON-RPC to `codex app-server`
 * instead of going through `codex exec`, so `thread/compact/start` can be
 * requested through the native protocol.  It uses a fresh HOME/CODEX_HOME,
 * a trusted temporary project, and no approval/sandbox bypass flags.
 *
 * The only durable output is a redacted evidence JSON file under
 * ~/.omt/oh-my-toong-playground/evidence/ledger-recovery-improvement/native-probe.
 * Temporary auth, config, hooks, and session history are removed on exit.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";

type JsonObject = Record<string, unknown>;

const CODEX = process.env.CODEX_BIN ?? "codex";
const EVIDENCE_DIR = process.env.OMT_NATIVE_PROBE_EVIDENCE_DIR ?? path.join(os.homedir(), ".omt", "oh-my-toong-playground", "evidence", "ledger-recovery-improvement", "native-probe");

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function redact(value: unknown, key = ""): unknown {
	if (/auth|token|secret|password|credential|cookie/i.test(key)) return "[REDACTED]";
	if (Array.isArray(value)) return value.map((entry) => redact(entry));
	if (!isObject(value)) return value;
	return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, redact(entry, entryKey)]));
}

function jsonLine(value: unknown): string {
	return JSON.stringify(redact(value));
}

async function writeText(filePath: string, contents: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, contents, "utf8");
}

export type LineReaderState = { buffer: string; decoder: TextDecoder };

export function decodeChunk(state: LineReaderState, chunk: Uint8Array): void {
	state.buffer += state.decoder.decode(chunk, { stream: true });
}

export function flushDecoded(state: LineReaderState): void {
	state.buffer += state.decoder.decode();
}

async function readLine(reader: ReadableStreamDefaultReader<Uint8Array>, state: LineReaderState): Promise<string | null> {
	for (;;) {
		const newline = state.buffer.indexOf("\n");
		if (newline >= 0) {
			const line = state.buffer.slice(0, newline);
			state.buffer = state.buffer.slice(newline + 1);
			return line;
		}
		const next = await reader.read();
		if (next.done) {
			flushDecoded(state);
			if (state.buffer.length === 0) return null;
			const line = state.buffer;
			state.buffer = "";
			return line;
		}
		decodeChunk(state, next.value);
	}
}

export async function readUntil(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	state: LineReaderState,
	seen: JsonObject[],
	match: (message: JsonObject) => boolean,
	deadline: number,
): Promise<JsonObject | null> {
	while (Date.now() < deadline) {
		const remaining = Math.max(1, deadline - Date.now());
		const readPromise = readLine(reader, state).then((line) => ({ kind: "line" as const, line })).catch(() => ({ kind: "error" as const }));
		const raced = await Promise.race([
			readPromise,
			new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), remaining)),
		]);
		if (raced.kind !== "line") {
			if (raced.kind === "timeout") await reader.cancel();
			return null;
		}
		const line = raced.line;
		if (line === null) return null;
		if (line.trim() === "") continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			seen.push({ type: "malformed", line: line.slice(0, 500) });
			continue;
		}
		if (!isObject(parsed)) continue;
		seen.push(parsed);
		if (match(parsed)) return parsed;
	}
	return null;
}

export function isAcceptedHookOrder(inputs: readonly unknown[], threadId: string): boolean {
	const postCompactIndex = inputs.findIndex((input) => isObject(input) && input.hook_event_name === "PostCompact" && input.trigger === "manual" && input.session_id === threadId);
	const compactSessionStartIndex = inputs.findIndex((input) => isObject(input) && input.hook_event_name === "SessionStart" && input.source === "compact" && input.session_id === threadId);
	return postCompactIndex >= 0 && compactSessionStartIndex >= 0 && postCompactIndex < compactSessionStartIndex;
}

async function main(): Promise<number> {
	const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "codex-ledger-recovery-native-"));
	const home = path.join(scratch, "home");
	const codexHome = path.join(home, ".codex");
	const cwd = path.join(scratch, "work");
	const hookCapture = path.join(scratch, "hooks.jsonl");
	const evidencePath = path.join(EVIDENCE_DIR, `probe-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.json`);
	const messages: JsonObject[] = [];
	let proc: Bun.ReadableSubprocess | undefined;
	let evidence: JsonObject;
	try {
		const versionProbe = Bun.spawn([CODEX, "--version"], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: process.env });
		const [versionOutput, versionExit] = await Promise.all([new Response(versionProbe.stdout).text(), versionProbe.exited]);
		if (versionExit !== 0) throw new Error(`codex --version exited ${versionExit}`);
		const codexVersion = versionOutput.trim();
		if (!codexVersion) throw new Error("codex --version returned no output");
		await fs.mkdir(codexHome, { recursive: true });
		await fs.mkdir(cwd, { recursive: true });
		const sourceCodexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
		const authSource = path.join(sourceCodexHome, "auth.json");
		try {
			await fs.copyFile(authSource, path.join(codexHome, "auth.json"));
		} catch (error) {
			evidence = { status: "blocked", reason: "auth-copy-failed", detail: error instanceof Error ? error.message : String(error) };
			await writeText(evidencePath, `${jsonLine(evidence)}\n`);
			return 2;
		}

		await writeText(path.join(codexHome, "config.toml"), `[projects.${JSON.stringify(cwd)}]\ntrust_level = "trusted"\n`);
		const hookCommand = `/bin/sh -c ${shellQuote(`cat >> ${shellQuote(hookCapture)}; printf '\\n' >> ${shellQuote(hookCapture)}`)}`;
		await writeText(
			path.join(codexHome, "hooks.json"),
			JSON.stringify({ hooks: { SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand }] }], PostCompact: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand }] }] } }, null, 2),
		);

		const env = {
			PATH: process.env.PATH ?? "/opt/homebrew/bin:/usr/bin:/bin",
			TMPDIR: process.env.TMPDIR ?? "/tmp",
			HOME: home,
			CODEX_HOME: codexHome,
		};
		proc = Bun.spawn([CODEX, "app-server", "--listen", "stdio://"], { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
		const stdoutReader = proc.stdout.getReader();
		const stderrPromise = new Response(proc.stderr).text();
		const state: LineReaderState = { buffer: "", decoder: new TextDecoder() };
		const stdin = proc.stdin;
		if (typeof stdin === "number" || stdin === undefined) throw new Error("app-server stdin was not piped");
		const send = (message: JsonObject) => stdin.write(`${JSON.stringify(message)}\n`);
		const waitDeadline = Date.now() + 15_000;
		send({ id: 1, method: "initialize", params: { clientInfo: { name: "omt-ledger-recovery-native-probe", version: "1" }, capabilities: { experimentalApi: true } } });
		const initialized = await readUntil(stdoutReader, state, messages, (message) => message.id === 1, waitDeadline);
		if (!initialized || isObject(initialized.error)) throw new Error(`initialize failed: ${jsonLine(initialized)}`);
		send({ method: "initialized" });
		send({ id: 6, method: "hooks/list", params: { cwds: [cwd] } });
		const hooksList = await readUntil(stdoutReader, state, messages, (message) => message.id === 6, Date.now() + 15_000);
		const hookTrustUpdates: JsonObject = {};
		const hookData = isObject(hooksList?.result) && Array.isArray(hooksList.result.data) ? hooksList.result.data : [];
		for (const data of hookData) {
			if (!isObject(data) || !Array.isArray(data.hooks)) continue;
			for (const hook of data.hooks) {
				if (!isObject(hook) || typeof hook.key !== "string" || typeof hook.currentHash !== "string") continue;
				hookTrustUpdates[hook.key] = { trusted_hash: hook.currentHash };
			}
		}
		const trustApproval = Object.keys(hookTrustUpdates).length === 0 ? null : await (async () => {
			send({ id: 7, method: "config/batchWrite", params: { filePath: path.join(codexHome, "config.toml"), reloadUserConfig: true, edits: [{ keyPath: "hooks.state", mergeStrategy: "upsert", value: hookTrustUpdates }] } });
			return readUntil(stdoutReader, state, messages, (message) => message.id === 7, Date.now() + 15_000);
		})();
		if (!trustApproval || isObject(trustApproval.error)) throw new Error(`hook trust approval failed: ${jsonLine(trustApproval)}`);
		send({ id: 2, method: "thread/start", params: { cwd, approvalPolicy: "never", sandbox: "read-only", experimental: true } });
		const started = await readUntil(stdoutReader, state, messages, (message) => message.id === 2, Date.now() + 20_000);
		const thread = isObject(started?.result) && isObject(started.result.thread) ? started.result.thread : null;
		const threadId = typeof thread?.id === "string" ? thread.id : null;
		if (!threadId) throw new Error(`thread/start failed: ${jsonLine(started)}`);
		const turnInput = [{ type: "text", text: "Read the fixture directory listing if available and summarize exactly two harmless facts. Do not modify files or run external actions." }];
		send({ id: 3, method: "turn/start", params: { threadId, input: turnInput, approvalPolicy: "never", cwd, sandboxPolicy: { type: "readOnly", networkAccess: false } } });
		const firstTurnResponse = await readUntil(stdoutReader, state, messages, (message) => message.id === 3, Date.now() + 45_000);
		const completedTurn = await readUntil(stdoutReader, state, messages, (message) => message.method === "turn/completed" && isObject(message.params) && message.params.threadId === threadId, Date.now() + 120_000);
		if (!firstTurnResponse || isObject(firstTurnResponse.error) || !completedTurn) throw new Error(`minimal turn did not complete: ${jsonLine(firstTurnResponse)}`);
		send({ id: 4, method: "thread/compact/start", params: { threadId } });
		const compactResponse = await readUntil(stdoutReader, state, messages, (message) => message.id === 4, Date.now() + 45_000);
		const compactionItemCompleted = await readUntil(
			stdoutReader,
			state,
			messages,
			(message) => message.method === "item/completed" && isObject(message.params) && isObject(message.params.item) && message.params.item.type === "contextCompaction",
			Date.now() + 120_000,
		);
		const completedTurnsBeforeCompaction = messages.filter((message) => message.method === "turn/completed").length;
		const compactionTurnCompleted = await readUntil(stdoutReader, state, messages, (message) => message.method === "turn/completed" && messages.filter((entry) => entry.method === "turn/completed").length > completedTurnsBeforeCompaction, Date.now() + 120_000);
		const completedTurnsBeforeFollowup = messages.filter((message) => message.method === "turn/completed").length;
		send({ id: 5, method: "turn/start", params: { threadId, input: [{ type: "text", text: "State the two facts you just summarized, briefly. Do not modify files." }], approvalPolicy: "never", cwd, sandboxPolicy: { type: "readOnly", networkAccess: false } } });
		const followupResponse = await readUntil(stdoutReader, state, messages, (message) => message.id === 5, Date.now() + 45_000);
		const completedFollowup = await readUntil(stdoutReader, state, messages, (message) => message.method === "turn/completed" && messages.filter((entry) => entry.method === "turn/completed").length > completedTurnsBeforeFollowup, Date.now() + 120_000);
		await new Promise((resolve) => setTimeout(resolve, 2_000));
		proc.kill();
		const stderr = await stderrPromise;
		const execProbe = Bun.spawn([CODEX, "exec", "--json", "--skip-git-repo-check", "-s", "read-only", "-C", cwd, "Reply with exactly one word: ready."], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
		const execStdoutPromise = new Response(execProbe.stdout).text();
		const execStderrPromise = new Response(execProbe.stderr).text();
		const execTimer = setTimeout(() => execProbe.kill(), 120_000);
		const [execStdout, execStderr, execExit] = await Promise.all([execStdoutPromise, execStderrPromise, execProbe.exited]);
		clearTimeout(execTimer);
		let hookInputs: unknown[] = [];
		try {
			const raw = await fs.readFile(hookCapture, "utf8");
			hookInputs = raw.split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
				try { return [JSON.parse(line)]; } catch { return [{ type: "malformed", line: line.slice(0, 500) }]; }
			});
		} catch { /* no hook invocation is itself evidence */ }
		const methods = messages.filter((message) => typeof message.method === "string").map((message) => message.method);
		const postCompactIndex = hookInputs.findIndex((input) => isObject(input) && input.hook_event_name === "PostCompact" && input.trigger === "manual" && input.session_id === threadId);
		const compactSessionStartIndex = hookInputs.findIndex((input) => isObject(input) && input.hook_event_name === "SessionStart" && input.source === "compact" && input.session_id === threadId);
		const postCompactHook = postCompactIndex >= 0 ? hookInputs[postCompactIndex] : undefined;
		const compactSessionStartHook = compactSessionStartIndex >= 0 ? hookInputs[compactSessionStartIndex] : undefined;
		const chainMeasured = Boolean(compactResponse && !isObject(compactResponse.error) && compactionItemCompleted && compactionTurnCompleted && completedFollowup && postCompactHook && compactSessionStartHook && isAcceptedHookOrder(hookInputs, threadId));
		evidence = {
			status: chainMeasured ? "measured" : "inconclusive",
			codexVersion,
			transport: "app-server stdio JSON-RPC",
			manualCompaction: "thread/compact/start",
			turns: { firstResponse: firstTurnResponse ? { hasResult: isObject(firstTurnResponse.result), error: firstTurnResponse.error ?? null } : null, firstCompleted: Boolean(completedTurn), compactionItemCompleted: Boolean(compactionItemCompleted), compactionTurnCompleted: Boolean(compactionTurnCompleted), followupResponse: followupResponse ? { hasResult: isObject(followupResponse.result), error: followupResponse.error ?? null } : null, followupCompleted: Boolean(completedFollowup) },
			threadId,
			compactResponse: compactResponse ? { hasResult: isObject(compactResponse.result), error: compactResponse.error ?? null } : null,
			execComparison: { exitCode: execExit, stdoutEventCount: execStdout.split("\n").filter((line) => line.trim()).length, stderr: execStderr.slice(0, 2000) },
			hooksList: hooksList ? { result: hooksList.result ?? null, error: hooksList.error ?? null } : null,
			trustApproval: trustApproval ? { result: trustApproval.result ?? null, error: trustApproval.error ?? null } : null,
			observedNotificationMethods: methods,
			observedMessages: messages,
			hookInputs,
			stderr: stderr ? stderr.slice(0, 4000) : "",
			acceptance: { compactionItemCompleted: Boolean(compactionItemCompleted), compactionTurnCompleted: Boolean(compactionTurnCompleted), followupCompleted: Boolean(completedFollowup), postCompactManualSameThread: Boolean(postCompactHook), sessionStartCompactSameThread: Boolean(compactSessionStartHook), postCompactBeforeSessionStart: postCompactIndex >= 0 && compactSessionStartIndex >= 0 && postCompactIndex < compactSessionStartIndex },
			interpretation: chainMeasured ? "Complete same-thread native compaction and recovery hook chain observed." : "Native compaction ran, but the complete same-thread recovery hook chain was not observed.",
		};
		await writeText(evidencePath, `${jsonLine(evidence)}\n`);
		process.stdout.write(`${JSON.stringify({ evidencePath, status: evidence.status, observedNotificationMethods: methods, hookInputCount: hookInputs.length })}\n`);
		return evidence.status === "measured" ? 0 : 2;
	} catch (error) {
		evidence = { status: "blocked", reason: "probe-error", detail: error instanceof Error ? error.message : String(error), observedMessages: messages };
		await writeText(evidencePath, `${jsonLine(evidence)}\n`);
		process.stderr.write(`ledger-recovery-native: blocked — ${evidence.detail}\n`);
		return 2;
	} finally {
		if (proc) {
			try { proc.kill(); } catch { /* already exited */ }
		}
		await fs.rm(scratch, { recursive: true, force: true });
	}
}

if (import.meta.main) process.exit(await main());

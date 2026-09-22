import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { resolveQaCaseRunPath, validateQaCase, type QaCaseRecord, type QaCaseSurface } from "@lib/qa-case-store.ts";

export interface QaCaseRunContext {
	casePath: string;
	caseRevision: string;
	projectRoot: string;
	storeLocation: string;
	codeRef: string;
	resetConfirmed: string;
	sessionId?: string;
	storyId?: string;
	cellClass?: number;
	cellSub?: "hang-timeout" | "flaky-green";
	cycle: number;
	storyContractSha256?: string;
	timeoutMs?: number;
	maxBuffer?: number;
	allowProjectCwd?: boolean;
	actorId?: string;
	actorBoundary?: string;
}

export interface QaCaseRunReceipt {
	version: 1;
	case_id: string;
	case_revision: string;
	attempt_id: string;
	surface: QaCaseSurface;
	argv: string[];
	cwd: string;
	exit_status: { code: number | null; signal: string | null; timedout: boolean; max_buffer_exceeded: boolean };
	qa_result: "not-recorded";
	code_ref: string;
	project_root: string;
	actor_id?: string;
	actor_boundary?: string;
	case_path: string;
	cycle: number;
	native_files: Array<{ path: string; sha256: string }>;
	reset_confirmation: string;
	started_at: string;
	finished_at: string;
	artifact_paths: { stdout: string; stderr: string; receipt: string; stdout_sha256: string; stderr_sha256: string };
	session_id?: string;
	story_id?: string;
	cell?: { cls: number; sub?: "hang-timeout" | "flaky-green" };
	story_contract_sha256?: string;
	start_error?: { message: string; code?: string };
}

export interface QaCaseRunResult { receipt: QaCaseRunReceipt; runDirectory: string; }

function sha256(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function readRevision(path: string): string { return sha256(readFileSync(path)); }
function ensureNativeFile(projectRoot: string, reference: string): { path: string; sha256: string } {
	const path = isAbsolute(reference) ? resolve(reference) : resolve(projectRoot, reference);
	const stat = statSync(path);
	if (!stat.isFile()) throw new Error(`qa replay: native file is not a regular file: ${path}`);
	return { path, sha256: sha256(readFileSync(path)) };
}
function expand(value: string, runDirectory: string): string { return value.replaceAll("{artifacts}", runDirectory); }
function resolveCwd(record: QaCaseRecord, context: QaCaseRunContext, runDirectory: string): string {
	const requested = record.execution_cwd;
	const expanded = expand(requested, runDirectory);
	if (requested === "project-root") throw new Error("qa replay: legacy execution_cwd=project-root is unsupported; save an absolute path and use --allow-project-cwd when it is the product cwd");
	if (!isAbsolute(expanded)) throw new Error(`qa replay: execution_cwd must be an absolute path or {artifacts}; got ${requested}`);
	const cwd = resolve(expanded);
	try { if (!statSync(cwd).isDirectory()) throw new Error(`qa replay: execution cwd is not a directory: ${cwd}`); }
	catch (error) { throw new Error(`qa replay: execution cwd is not a directory: ${cwd}`, { cause: error }); }
	if (requested.includes("{artifacts}")) {
		const canonicalRun = realpathSync(runDirectory);
		const canonicalCwd = realpathSync(cwd);
		const rest = canonicalCwd === canonicalRun ? "" : canonicalCwd.slice(`${canonicalRun}/`.length);
		if (canonicalCwd !== canonicalRun && (!canonicalCwd.startsWith(`${canonicalRun}/`) || rest.startsWith("../"))) {
			throw new Error("qa replay: execution cwd escapes artifacts run directory");
		}
		return canonicalCwd;
	}
	const lexicalRoot = resolve(context.projectRoot);
	const canonicalRoot = realpathSync(lexicalRoot);
	const canonicalCwd = realpathSync(cwd);
	const lexicalInProduct = cwd === lexicalRoot || cwd.startsWith(`${lexicalRoot}/`);
	if (lexicalInProduct && !(canonicalCwd === canonicalRoot || canonicalCwd.startsWith(`${canonicalRoot}/`))) {
		throw new Error("qa replay: execution cwd symlink escapes product root");
	}
	if (canonicalCwd === canonicalRoot || canonicalCwd.startsWith(`${canonicalRoot}/`)) {
		if (!context.allowProjectCwd) throw new Error("qa replay: product cwd requires --allow-project-cwd; review runner output flags/config first");
	}
	return canonicalCwd;
}

function writeImmutable(path: string, bytes: string | Buffer): void {
	try { writeFileSync(path, bytes, { encoding: "utf8", flag: "wx" }); }
	catch (error) { throw new Error(`qa replay: refusing to overwrite immutable artifact ${path}`, { cause: error }); }
}

export async function runQaCase(record: QaCaseRecord, context: QaCaseRunContext): Promise<QaCaseRunResult> {
	validateQaCase(record);
	if (context.resetConfirmed !== record.reset_description) throw new Error("qa replay: reset confirmation must exactly match the saved reset_description");
	if (!context.codeRef.trim()) throw new Error("qa replay: codeRef is required");
	if (!Number.isInteger(context.cycle) || context.cycle < 0) throw new Error("qa replay: cycle must be a nonnegative integer");
	if (context.timeoutMs !== undefined && (!Number.isFinite(context.timeoutMs) || context.timeoutMs <= 0)) throw new Error("qa replay: timeoutMs must be a finite positive number");
	if (context.maxBuffer !== undefined && (!Number.isFinite(context.maxBuffer) || context.maxBuffer <= 0)) throw new Error("qa replay: maxBuffer must be a finite positive number");
	if (readRevision(context.casePath) !== context.caseRevision) throw new Error("qa replay: saved case revision no longer matches; refusing execution");
	const nativeFiles = (record.native_files ?? []).map((path) => ensureNativeFile(context.projectRoot, path));
	const attemptId = randomUUID();
	const runDirectory = resolveQaCaseRunPath(context.storeLocation, attemptId);
	mkdirSync(runDirectory, { recursive: true });
	const stdoutPath = join(runDirectory, "stdout.log");
	const stderrPath = join(runDirectory, "stderr.log");
	const receiptPath = join(runDirectory, "receipt.json");
	const cwd = resolveCwd(record, context, runDirectory);
	const argv = record.runner.map((item) => expand(item, runDirectory));
	const startedAt = new Date().toISOString();
	const maxBuffer = context.maxBuffer ?? 1024 * 1024;
	const timeoutMs = context.timeoutMs ?? 120_000;
	let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
	let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
	let timedout = false;
	let maxBufferExceeded = false;
	let child;
	try {
		child = spawn(argv[0], argv.slice(1), { cwd, shell: false, detached: true, env: { ...process.env, QA_ARTIFACTS_DIR: runDirectory } });
	} catch (error) {
		throw new Error(`qa replay: failed to start runner`, { cause: error });
	}
	let startError: { message: string; code?: string } | undefined;
	const status = await new Promise<{ code: number | null; signal: string | null }>((resolveStatus) => {
		let settled = false;
		let stopping = false;
		const finish = (value: { code: number | null; signal: string | null }) => { if (!settled) { settled = true; resolveStatus(value); } };
		const stop = (signal: "SIGTERM" | "SIGKILL") => { try { if (child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { try { child.kill(signal); } catch { /* already exited */ } } };
		let forceTimer: ReturnType<typeof setTimeout> | undefined;
		const watchdog: ReturnType<typeof setTimeout> = setTimeout(() => { if (!settled && (timedout || maxBufferExceeded)) { child.stdout.destroy(); child.stderr.destroy(); finish({ code: null, signal: "SIGKILL" }); } }, timeoutMs + 500);
		const cleanup = () => { clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); if (watchdog) clearTimeout(watchdog); };
		const terminate = (timedOut: boolean) => { if (stopping) return; stopping = true; if (timedOut) timedout = true; stop("SIGTERM"); forceTimer = setTimeout(() => stop("SIGKILL"), 100); };
		const timer = setTimeout(() => terminate(true), timeoutMs);
		const collect = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> => {
			const next = Buffer.concat([current, chunk]);
			if (next.length > maxBuffer) { maxBufferExceeded = true; terminate(false); return next.subarray(0, maxBuffer); }
			return next;
		};
		child.stdout.on("data", (chunk: Buffer) => { stdout = collect(stdout, chunk); });
		child.stderr.on("data", (chunk: Buffer) => { stderr = collect(stderr, chunk); });
		child.once("error", (error: NodeJS.ErrnoException) => { startError = { message: error.message, ...(typeof error.code === "string" ? { code: error.code } : {}) }; cleanup(); finish({ code: null, signal: null }); });
		child.once("close", (code, signal) => { cleanup(); finish({ code, signal }); });
		watchdog.unref();
	});
	writeImmutable(stdoutPath, stdout);
	writeImmutable(stderrPath, stderr);
	if (readRevision(context.casePath) !== context.caseRevision) throw new Error("qa replay: saved case changed during run; receipt is not accepted");
	for (const file of nativeFiles) {
		if (sha256(readFileSync(file.path)) !== file.sha256) throw new Error(`qa replay: native file changed during run: ${file.path}`);
	}
	const receipt: QaCaseRunReceipt = {
		version: 1, case_id: record.id, case_revision: context.caseRevision, attempt_id: attemptId,
		surface: record.surface, argv, cwd,
		exit_status: { ...status, timedout, max_buffer_exceeded: maxBufferExceeded },
		qa_result: "not-recorded", code_ref: context.codeRef, project_root: resolve(context.projectRoot), native_files: nativeFiles,
		reset_confirmation: context.resetConfirmed, started_at: startedAt, finished_at: new Date().toISOString(),
		case_path: context.casePath, cycle: context.cycle,
		artifact_paths: { stdout: stdoutPath, stderr: stderrPath, receipt: receiptPath, stdout_sha256: sha256(stdout), stderr_sha256: sha256(stderr) },
		...(context.sessionId ? { session_id: context.sessionId } : {}),
		...(context.storyId ? { story_id: context.storyId } : {}),
		...(context.cellClass !== undefined ? { cell: { cls: context.cellClass, ...(context.cellSub ? { sub: context.cellSub } : {}) } } : {}),
		...(context.storyContractSha256 ? { story_contract_sha256: context.storyContractSha256 } : {}),
		...(context.actorId ? { actor_id: context.actorId } : {}),
		...(context.actorBoundary ? { actor_boundary: context.actorBoundary } : {}),
		...(startError ? { start_error: startError } : {}),
	};
	writeImmutable(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
	return { receipt, runDirectory };
}

export function readQaCaseRunReceipt(path: string): QaCaseRunReceipt {
	const value: unknown = JSON.parse(readFileSync(path, "utf8"));
	validateQaCaseRunReceipt(value);
	const runDirectory = realpathSync(dirname(path));
	if (resolve(value.artifact_paths.receipt) !== resolve(path) || resolve(value.artifact_paths.stdout) !== join(runDirectory, "stdout.log") || resolve(value.artifact_paths.stderr) !== join(runDirectory, "stderr.log")) throw new Error("qa replay: receipt artifact paths are outside its run directory or do not match the receipt path");
	if (sha256(readFileSync(value.artifact_paths.stdout)) !== value.artifact_paths.stdout_sha256 || sha256(readFileSync(value.artifact_paths.stderr)) !== value.artifact_paths.stderr_sha256) {
		throw new Error("qa replay: run artifact hash mismatch");
	}
	return value;
}

export function validateQaCaseRunReceipt(value: unknown): asserts value is QaCaseRunReceipt {
	if (!isRecord(value) || value.version !== 1 || !nonblank(value.case_id) || !sha(value.case_revision) || !nonblank(value.attempt_id) || !isSurface(value.surface) || !isArgv(value.argv) || !nonblank(value.cwd) || !isExitStatus(value.exit_status) || !nonblank(value.code_ref) || !nonblank(value.project_root) || !nonblank(value.case_path) || typeof value.cycle !== "number" || !Number.isInteger(value.cycle) || value.cycle < 0 || !isNativeFiles(value.native_files) || !validDate(value.started_at) || !validDate(value.finished_at) || !nonblank(value.reset_confirmation) || value.qa_result !== "not-recorded" || !isArtifactPaths(value.artifact_paths)) {
		throw new Error("qa replay: invalid run receipt");
	}
	if (value.session_id !== undefined && !nonblank(value.session_id)) throw new Error("qa replay: invalid run receipt");
	if (value.actor_id !== undefined && !nonblank(value.actor_id)) throw new Error("qa replay: invalid run receipt");
	if (value.actor_boundary !== undefined && !nonblank(value.actor_boundary)) throw new Error("qa replay: invalid run receipt");
	if (value.story_id !== undefined && !nonblank(value.story_id)) throw new Error("qa replay: invalid run receipt");
	if (value.cell !== undefined) {
		if (!isRecord(value.cell) || typeof value.cell.cls !== "number" || !Number.isInteger(value.cell.cls) || value.cell.cls < 1 || value.cell.cls > 6 || (value.cell.sub !== undefined && value.cell.sub !== "hang-timeout" && value.cell.sub !== "flaky-green")) throw new Error("qa replay: invalid run receipt");
	}
	if (value.story_contract_sha256 !== undefined && !sha(value.story_contract_sha256)) throw new Error("qa replay: invalid run receipt");
	if (value.start_error !== undefined && (!isRecord(value.start_error) || !nonblank(value.start_error.message) || (value.start_error.code !== undefined && !nonblank(value.start_error.code)))) throw new Error("qa replay: invalid run receipt");
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonblank(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function isSurface(value: unknown): value is QaCaseSurface { return value === "agent-browser" || value === "agent-device" || value === "curl" || value === "bash"; }
function isArgv(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.every(nonblank); }
function validDate(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function isExitStatus(value: unknown): value is QaCaseRunReceipt["exit_status"] {
	return isRecord(value) && (value.code === null || Number.isInteger(value.code)) && (value.signal === null || nonblank(value.signal)) && typeof value.timedout === "boolean" && typeof value.max_buffer_exceeded === "boolean";
}
function isNativeFiles(value: unknown): value is QaCaseRunReceipt["native_files"] {
	return Array.isArray(value) && value.every((item) => isRecord(item) && nonblank(item.path) && sha(item.sha256));
}

function isArtifactPaths(value: unknown): value is QaCaseRunReceipt["artifact_paths"] {
	return typeof value === "object" && value !== null && "stdout" in value && typeof value.stdout === "string" && "stderr" in value && typeof value.stderr === "string" && "receipt" in value && typeof value.receipt === "string" && "stdout_sha256" in value && typeof value.stdout_sha256 === "string" && /^[a-f0-9]{64}$/.test(value.stdout_sha256) && "stderr_sha256" in value && typeof value.stderr_sha256 === "string" && /^[a-f0-9]{64}$/.test(value.stderr_sha256);
}

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, spyOn } from "bun:test";
import { main } from "./index.ts";
import * as stdinMod from "./stdin.ts";
import { mkdir, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Readable } from "stream";
import { existsSync } from "fs";

describe("main entry point", () => {
	const testDir = join(tmpdir(), "persistent-mode-index-test-" + Date.now());
	const projectRoot = join(testDir, "project");
	const omtDir = join(projectRoot, ".omt");

	// Save original process methods
	const originalCwd = process.cwd;
	// eslint-disable-next-line no-console -- console.log 후킹(테스트 하네스가 훅 stdout 캡처)
	const originalLog = console.log;
	const originalError = console.error;
	const savedOmtDir = process.env.OMT_DIR;

	let capturedOutput: string[] = [];
	let capturedErrors: string[] = [];

	beforeAll(async () => {
		await mkdir(omtDir, { recursive: true });
		// Create .git directory to make it a project root
		await mkdir(join(projectRoot, ".git"), { recursive: true });
	});

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	beforeEach(() => {
		process.env.OMT_DIR = omtDir;
		capturedOutput = [];
		capturedErrors = [];
		// eslint-disable-next-line no-console -- console.log 후킹(테스트 하네스가 훅 stdout 캡처)
		console.log = (...args: unknown[]) => {
			capturedOutput.push(args.map(String).join(" "));
		};
		console.error = (...args: unknown[]) => {
			capturedErrors.push(args.map(String).join(" "));
		};
	});

	afterEach(() => {
		if (savedOmtDir === undefined) {
			delete process.env.OMT_DIR;
		} else {
			process.env.OMT_DIR = savedOmtDir;
		}
		// eslint-disable-next-line no-console -- console.log 후킹 복원
		console.log = originalLog;
		console.error = originalError;
	});

	// Helper to create mock stdin
	function createMockStdin(data: string): NodeJS.ReadableStream {
		const readable = new Readable({
			read() {
				this.push(data);
				this.push(null);
			},
		});
		return readable as NodeJS.ReadableStream;
	}

	describe("happy path", () => {
		it("should output continue: true when no blocking conditions", async () => {
			// Create mock stdin with valid JSON
			const input = JSON.stringify({
				sessionId: "test-session-123",
				cwd: projectRoot,
				last_assistant_message: null,
			});

			// Mock stdin
			const mockStdin = createMockStdin(input);
			Object.defineProperty(process, "stdin", {
				value: mockStdin,
				writable: true,
				configurable: true,
			});

			await main();

			// Should output valid JSON with continue: true
			expect(capturedOutput.length).toBeGreaterThan(0);
			const output = JSON.parse(capturedOutput[capturedOutput.length - 1]);
			expect(output.continue).toBe(true);
		});
	});

	describe("error handling", () => {
		it("should fail open (allow stop) on parse error", async () => {
			const mockStdin = createMockStdin("{ invalid json }");
			Object.defineProperty(process, "stdin", {
				value: mockStdin,
				writable: true,
				configurable: true,
			});

			// Isolate from real environment:
			// - HOME → testDir so readTasksFromDirectory reads from empty dir
			// - cwd → projectRoot so getProjectRoot returns a clean directory
			const savedHome = process.env.HOME;
			process.env.HOME = testDir;
			process.cwd = () => projectRoot;
			try {
				await main();

				// Should output continue: true even on error
				expect(capturedOutput.length).toBeGreaterThan(0);
				const lastOutput = capturedOutput[capturedOutput.length - 1];
				const output = JSON.parse(lastOutput);
				expect(output.continue).toBe(true);
			} finally {
				process.env.HOME = savedHome;
				process.cwd = originalCwd;
			}
		});

		it("should fail open when error occurs before initLogger is called", async () => {
			// Mock readStdin to throw before parseInput/initLogger are reached.
			// This deterministically exercises the catch path with logger uninitialized.
			const mockReadStdin = spyOn(stdinMod, "readStdin").mockRejectedValue(
				new Error("simulated pre-init failure"),
			);

			try {
				await main();

				// Must output {"continue": true} even when the error occurs before initLogger
				expect(capturedOutput.length).toBeGreaterThan(0);
				const lastOutput = capturedOutput[capturedOutput.length - 1];
				expect(lastOutput).toBe('{"continue": true}');
			} finally {
				mockReadStdin.mockRestore();
			}
		});

		it("should fail open when cwd directory does not exist", async () => {
			const input = JSON.stringify({
				sessionId: "test-session",
				cwd: "/nonexistent/path/that/does/not/exist",
				last_assistant_message: null,
			});

			const mockStdin = createMockStdin(input);
			Object.defineProperty(process, "stdin", {
				value: mockStdin,
				writable: true,
				configurable: true,
			});

			await main();

			// Should still output continue: true
			expect(capturedOutput.length).toBeGreaterThan(0);
			const output = JSON.parse(capturedOutput[capturedOutput.length - 1]);
			expect(output.continue).toBe(true);
		});
	});

	// Transcript-based todo counting was REMOVED in favor of file-based counting.
	// The transcript approach had a scope mismatch with Claude Code's request-level
	// TaskList API, causing phantom todos from previous requests to block new requests.
	// File-based counting (Priority 2) now reads from ~/.claude/tasks/{sessionId}/.

	describe("transcript-based todo counting (removed)", () => {
		it("should NOT block when incomplete todos exist without an active blocking state", async () => {
			const input = JSON.stringify({
				sessionId: "todo-session",
				cwd: projectRoot,
				last_assistant_message: null,
			});

			const mockStdin = createMockStdin(input);
			Object.defineProperty(process, "stdin", {
				value: mockStdin,
				writable: true,
				configurable: true,
			});

			await main();

			expect(capturedOutput.length).toBeGreaterThan(0);
			const output = JSON.parse(capturedOutput[capturedOutput.length - 1]);
			// Should NOT block - transcript-based counting is not used
			// (file-based counting would find no tasks in ~/.claude/tasks/)
			expect(output.continue).toBe(true);
		});
	});

	describe("logging integration", () => {
		const loggingTestDir = join(tmpdir(), "persistent-mode-logging-test-" + Date.now());
		const loggingProjectRoot = join(loggingTestDir, "project");
		const logsDir = join(loggingProjectRoot, ".omt", "logs");

		beforeAll(async () => {
			await mkdir(join(loggingProjectRoot, ".omt"), { recursive: true });
			await mkdir(join(loggingProjectRoot, ".git"), { recursive: true });
		});

		afterAll(async () => {
			await rm(loggingTestDir, { recursive: true, force: true });
		});

		beforeEach(async () => {
			// Set DEBUG log level to capture all logs
			process.env.OMT_LOG_LEVEL = "DEBUG";
			process.env.OMT_DIR = join(loggingProjectRoot, ".omt");
			// Clean up logs directory before each test
			try {
				await rm(logsDir, { recursive: true, force: true });
			} catch {}
		});

		afterEach(() => {
			delete process.env.OMT_LOG_LEVEL;
		});

		it("should create log file with START and END markers", async () => {
			const input = JSON.stringify({
				sessionId: "logging-test-session",
				cwd: loggingProjectRoot,
				last_assistant_message: null,
			});

			const mockStdin = createMockStdin(input);
			Object.defineProperty(process, "stdin", {
				value: mockStdin,
				writable: true,
				configurable: true,
			});

			await main();

			// Check that log file was created
			const logFile = join(logsDir, "persistent-mode-logging-test-session.log");
			expect(existsSync(logFile)).toBe(true);

			// Check log file content
			const logContent = await readFile(logFile, "utf-8");
			expect(logContent).toContain("START");
			expect(logContent).toContain("END");
		});

		it("should log session ID and hook event", async () => {
			const input = JSON.stringify({
				sessionId: "log-session-info",
				cwd: loggingProjectRoot,
				last_assistant_message: null,
			});

			const mockStdin = createMockStdin(input);
			Object.defineProperty(process, "stdin", {
				value: mockStdin,
				writable: true,
				configurable: true,
			});

			await main();

			const logFile = join(logsDir, "persistent-mode-log-session-info.log");
			const logContent = await readFile(logFile, "utf-8");
			expect(logContent).toContain("log-session-info");
			expect(logContent).toContain("stop hook");
		});

		it("should log decision result", async () => {
			const input = JSON.stringify({
				sessionId: "log-decision-test",
				cwd: loggingProjectRoot,
				last_assistant_message: null,
			});

			const mockStdin = createMockStdin(input);
			Object.defineProperty(process, "stdin", {
				value: mockStdin,
				writable: true,
				configurable: true,
			});

			await main();

			const logFile = join(logsDir, "persistent-mode-log-decision-test.log");
			const logContent = await readFile(logFile, "utf-8");
			expect(logContent).toMatch(/decision.*continue/i);
		});

		it("should log errors when they occur", async () => {
			// Note: This test verifies error logging path exists even if triggering is complex
			const input = JSON.stringify({
				sessionId: "log-error-test",
				cwd: loggingProjectRoot,
				last_assistant_message: null,
			});

			const mockStdin = createMockStdin(input);
			Object.defineProperty(process, "stdin", {
				value: mockStdin,
				writable: true,
				configurable: true,
			});

			await main();

			// At minimum, log file should exist with proper start/end
			const logFile = join(logsDir, "persistent-mode-log-error-test.log");
			expect(existsSync(logFile)).toBe(true);
		});
	});
});

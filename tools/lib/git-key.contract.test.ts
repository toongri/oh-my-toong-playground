/**
 * AC-A: Live external-contract tests for deriveClaudeProjectKey.
 *
 * Layer 2 of the Expanded Test Plan: runs the REAL `claude mcp add --scope local`
 * binary with CLAUDE_CONFIG_DIR pointing at a tmp dir, then byte-matches the
 * `projects[]` key Claude wrote against deriveClaudeProjectKey(fixturePath).
 *
 * Skips only when `claude` is absent from PATH.
 * When `claude` IS present, all 3 shapes MUST run non-skipped (skip ≠ AC pass).
 *
 * --- Shape taxonomy ---
 *
 * Shape 1 "standalone": plain `git init` repo — Claude runs from the repo root.
 *   git common-dir = <root>/.git → key = <root>
 *
 * Shape 2 "bare worktree": bare+worktree pattern — Claude runs from the worktree.
 *   git common-dir = <container>/.bare → key = <container>/.bare
 *
 * Shape 3 "container": a worktree directory that has a .git FILE pointing at the
 *   bare dir (i.e. the directory was created via `git worktree add`).  This is the
 *   "container" shape: the dir contains a .git FILE (not a dir), making it look
 *   like a container that delegates to the bare repo.  Claude runs from that second
 *   worktree dir.  Both derive and Claude should agree on key = <container>/.bare.
 *   This cross-checks the live oracle: projects["/Users/toong/repos/algocare-home/.bare"]
 *   which was written when Claude ran from algocare-home/<worktree-name>.
 *
 * --- Contract mismatch notes (NOT tested here, documented for Layer 3) ---
 *
 * Claude does NOT always key by git common-dir. When run from a plain directory
 * that has a .git FILE but is NOT a registered worktree (e.g. the algocare-home
 * container dir itself, or a manually-created gitfile dir), Claude falls back to
 * realpath(cwd). These cases are excluded from contract tests because they expose
 * a known divergence between deriveClaudeProjectKey and Claude's actual behavior.
 * Layer 3 (live oracle) documents the worktree-only shapes where both agree.
 */

import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { deriveClaudeProjectKey } from "./git-key.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function claudePresent(): boolean {
  const r = spawnSync("command", ["-v", "claude"], { shell: true });
  return r.status === 0;
}

// Evaluated once at module load so all three tests share the same skip decision.
const HAS_CLAUDE = claudePresent();

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "git-key-contract-"));
}

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "T",
  GIT_AUTHOR_EMAIL: "t@t.com",
  GIT_COMMITTER_NAME: "T",
  GIT_COMMITTER_EMAIL: "t@t.com",
};

/**
 * Seeds an empty commit into a bare repo so worktrees can be added.
 */
function seedBareRepo(bareDir: string): void {
  const tmpWt = fs.mkdtempSync(path.join(os.tmpdir(), "git-key-seed-"));
  try {
    execFileSync(
      "git",
      ["--git-dir", bareDir, "worktree", "add", "--orphan", "-b", "main", tmpWt],
      { stdio: "pipe", env: GIT_ENV },
    );
    execFileSync("git", ["-C", tmpWt, "commit", "--allow-empty", "-m", "init"], {
      stdio: "pipe",
      env: GIT_ENV,
    });
    fs.rmSync(tmpWt, { recursive: true, force: true });
    execFileSync("git", ["--git-dir", bareDir, "worktree", "prune"], { stdio: "pipe" });
  } catch {
    fs.rmSync(tmpWt, { recursive: true, force: true });
    throw new Error("Failed to seed bare repo");
  }
}

/**
 * Runs `claude mcp add --scope local <name> -- echo hello` with CLAUDE_CONFIG_DIR
 * pointing at configDir (the tmp config home), CWD set to cwd.
 *
 * Returns the projects[] key that Claude wrote into configDir/.claude.json.
 * Throws if claude exits non-zero or the key cannot be found.
 */
function runClaudeMcpAdd(configDir: string, cwd: string): string {
  const serverName = `contract-probe-${Date.now()}`;
  const result = spawnSync(
    "claude",
    ["mcp", "add", "--scope", "local", serverName, "--", "echo", "hello"],
    {
      cwd,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      stdio: "pipe",
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    throw new Error(
      `claude mcp add failed (exit ${result.status}):\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
  }

  const configFile = path.join(configDir, ".claude.json");
  if (!fs.existsSync(configFile)) {
    throw new Error(`Expected ${configFile} to exist after claude mcp add`);
  }

  const raw = fs.readFileSync(configFile, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("projects" in parsed) ||
    typeof (parsed as Record<string, unknown>).projects !== "object"
  ) {
    throw new Error(`Unexpected .claude.json shape: ${raw.slice(0, 200)}`);
  }

  const projects = (parsed as { projects: Record<string, unknown> }).projects;
  const keys = Object.keys(projects);

  if (keys.length === 0) {
    throw new Error("No project keys written to .claude.json by claude mcp add");
  }
  if (keys.length > 1) {
    // More than one key means claude picked up a pre-existing config — unexpected
    // since configDir is a fresh tmp dir. Surface as error.
    throw new Error(`Multiple project keys found: ${keys.join(", ")} — expected exactly 1`);
  }

  return keys[0]!;
}

/**
 * Asserts that `keyString` is ABSENT from the real $HOME/.claude.json.
 * String-level check (not JSON parse) so it is robust against formatting
 * differences and definitively catches any real-file pollution.
 */
function assertKeyAbsentFromRealConfig(keyString: string): void {
  const realConfig = path.join(os.homedir(), ".claude.json");
  if (!fs.existsSync(realConfig)) return;

  const raw = fs.readFileSync(realConfig, "utf8");
  if (raw.includes(keyString)) {
    throw new Error(
      `ISOLATION BREACH: key "${keyString}" found in real $HOME/.claude.json — ` +
        `CLAUDE_CONFIG_DIR isolation failed!`,
    );
  }
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describe("deriveClaudeProjectKey (contract: live claude binary)", () => {
  const tmpdirs: string[] = [];

  afterEach(() => {
    for (const d of tmpdirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  // AC-A.1
  it.skipIf(!HAS_CLAUDE)("contract standalone", () => {
    // Build fixture: plain `git init` repo
    const root = mktemp();
    tmpdirs.push(root);
    git(["init", root], os.tmpdir());

    const configDir = mktemp();
    tmpdirs.push(configDir);

    // Run the REAL claude mcp add from the standalone repo root
    const claudeKey = runClaudeMcpAdd(configDir, root);
    const derivedKey = deriveClaudeProjectKey(root);

    // Primary contract assertion: byte-match
    expect(derivedKey).toBe(claudeKey);

    // Key must be present in the tmp config
    const raw = fs.readFileSync(path.join(configDir, ".claude.json"), "utf8");
    expect(raw).toContain(claudeKey);

    // Key must NOT appear in the real $HOME/.claude.json
    assertKeyAbsentFromRealConfig(claudeKey);
  });

  // AC-A.2
  it.skipIf(!HAS_CLAUDE)("contract bare worktree", () => {
    // Build fixture: bare+worktree pattern
    // Layout: <container>/.bare (bare repo) + <container>/wt (registered worktree)
    // Claude runs from the WORKTREE. The worktree has a .git FILE created by git
    // pointing at the bare dir. Expected key = realpath(<container>/.bare).
    const container = mktemp();
    tmpdirs.push(container);

    const bareDir = path.join(container, ".bare");
    const wtDir = path.join(container, "wt");

    git(["init", "--bare", bareDir], os.tmpdir());
    seedBareRepo(bareDir);

    fs.mkdirSync(wtDir, { recursive: true });
    execFileSync("git", ["--git-dir", bareDir, "worktree", "add", wtDir], {
      stdio: "pipe",
      env: GIT_ENV,
    });

    const configDir = mktemp();
    tmpdirs.push(configDir);

    // Run claude mcp add from the WORKTREE (not from the bare dir)
    const claudeKey = runClaudeMcpAdd(configDir, wtDir);
    const derivedKey = deriveClaudeProjectKey(wtDir);

    // Primary contract assertion: byte-match
    expect(derivedKey).toBe(claudeKey);

    // Key must be present in the tmp config
    const raw = fs.readFileSync(path.join(configDir, ".claude.json"), "utf8");
    expect(raw).toContain(claudeKey);

    // Key must NOT appear in the real $HOME/.claude.json
    assertKeyAbsentFromRealConfig(claudeKey);
  });

  // AC-A.3
  it.skipIf(!HAS_CLAUDE)("contract container", () => {
    // Build fixture: two worktrees off a bare repo.
    // The "container" shape is a directory that has a .git FILE (not a directory),
    // created by `git worktree add`, pointing at the bare dir. This is the same
    // physical structure as algocare-home/<worktree-name>: a dir with .git FILE
    // whose content is "gitdir: <path-to-bare>".
    //
    // Layout:
    //   <container>/.bare  (bare repo)
    //   <container>/wt1    (first worktree — used to seed)
    //   <container>/wt2    (second worktree — the "container" shape being tested)
    //
    // Claude runs from wt2. Both wt1 and wt2 have a .git FILE (gitfile shape).
    // Expected: key = realpath(<container>/.bare) — ends with "/.bare".
    //
    // Live oracle: projects["/Users/toong/repos/algocare-home/.bare"] was written
    // when Claude ran from algocare-home/<worktree-name> (a gitfile-shape dir).
    const container = mktemp();
    tmpdirs.push(container);

    const bareDir = path.join(container, ".bare");
    const wt1Dir = path.join(container, "wt1");
    const wt2Dir = path.join(container, "wt2");

    git(["init", "--bare", bareDir], os.tmpdir());
    seedBareRepo(bareDir);

    // Add first worktree (for branch creation)
    execFileSync("git", ["--git-dir", bareDir, "worktree", "add", wt1Dir], {
      stdio: "pipe",
      env: GIT_ENV,
    });

    // Add second worktree — this is the "container" shape
    execFileSync(
      "git",
      ["--git-dir", bareDir, "worktree", "add", "-b", "container-branch", wt2Dir],
      { stdio: "pipe", env: GIT_ENV },
    );

    // Verify wt2 has a .git FILE (gitfile shape, not a directory)
    const wt2GitPath = path.join(wt2Dir, ".git");
    const wt2GitStat = fs.statSync(wt2GitPath);
    expect(wt2GitStat.isFile()).toBe(true); // must be a FILE, not a dir

    const configDir = mktemp();
    tmpdirs.push(configDir);

    // Run claude mcp add from the second worktree (gitfile-shape "container")
    const claudeKey = runClaudeMcpAdd(configDir, wt2Dir);
    const derivedKey = deriveClaudeProjectKey(wt2Dir);

    // Primary contract assertion: byte-match
    expect(derivedKey).toBe(claudeKey);

    // Key must end with "/.bare" — the bare dir name
    // This cross-checks the live oracle pattern.
    expect(claudeKey.endsWith("/.bare")).toBe(true);

    // Key must be present in the tmp config
    const raw = fs.readFileSync(path.join(configDir, ".claude.json"), "utf8");
    expect(raw).toContain(claudeKey);

    // Key must NOT appear in the real $HOME/.claude.json
    assertKeyAbsentFromRealConfig(claudeKey);
  });
});

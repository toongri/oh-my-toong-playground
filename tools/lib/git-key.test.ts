import { describe, it, expect, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { deriveClaudeProjectKey, ProjectKeyError } from "./git-key.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "git-key-test-"));
}

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function initGitConfig(repoDir: string): void {
  git(["config", "user.email", "test@example.com"], repoDir);
  git(["config", "user.name", "Test User"], repoDir);
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "T",
  GIT_AUTHOR_EMAIL: "t@t.com",
  GIT_COMMITTER_NAME: "T",
  GIT_COMMITTER_EMAIL: "t@t.com",
};

/**
 * Seeds an empty commit into a bare repo.
 * git commit requires a work tree, so we create a temporary one first.
 */
function seedBareRepo(bareDir: string): void {
  const tmpWt = fs.mkdtempSync(path.join(os.tmpdir(), "git-key-seed-"));
  try {
    execFileSync("git", ["--git-dir", bareDir, "worktree", "add", "--orphan", "-b", "main", tmpWt], {
      stdio: "pipe",
      env: GIT_ENV,
    });
    execFileSync("git", ["-C", tmpWt, "commit", "--allow-empty", "-m", "init"], {
      stdio: "pipe",
      env: GIT_ENV,
    });
    // Remove the temporary worktree (prune after force-removal)
    fs.rmSync(tmpWt, { recursive: true, force: true });
    execFileSync("git", ["--git-dir", bareDir, "worktree", "prune"], {
      stdio: "pipe",
    });
  } catch {
    fs.rmSync(tmpWt, { recursive: true, force: true });
    throw new Error("Failed to seed bare repo");
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveClaudeProjectKey", () => {
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

  it("standalone literal-git", () => {
    // Branch (a): standard `git init` repo — common-dir is <root>/.git
    const root = mktemp();
    tmpdirs.push(root);

    git(["init", root], os.tmpdir());
    initGitConfig(root);

    const key = deriveClaudeProjectKey(root);
    // key must equal the real canonical path of the worktree root
    expect(key).toBe(fs.realpathSync(root));
    // sanity: key does NOT end with /.git
    expect(key.endsWith("/.git")).toBe(false);
  });

  it("bare worktree", () => {
    // Branch (b): bare repo pattern — common-dir IS the bare dir (e.g. .bare)
    // Layout: <container>/.bare  (bare repo) + <container>/wt (worktree)
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

    const key = deriveClaudeProjectKey(wtDir);

    // key must equal the real canonical path of the bare dir
    const realBare = fs.realpathSync(bareDir);
    expect(key).toBe(realBare);
    // key must NOT be the worktree path
    expect(key).not.toBe(fs.realpathSync(wtDir));
  });

  it("container gitfile", () => {
    // Branch (b) variant: container dir holding a `.git` FILE (not a dir)
    // that points to a bare-pattern common-dir. basename(commonDir) !== ".git"
    // Layout: <root>/.bare (bare), <root>/linked (has .git FILE → .bare)
    const container = mktemp();
    tmpdirs.push(container);

    const bareDir = path.join(container, ".bare");
    const linkedDir = path.join(container, "linked");

    git(["init", "--bare", bareDir], os.tmpdir());
    seedBareRepo(bareDir);

    fs.mkdirSync(linkedDir, { recursive: true });
    // Create a .git FILE pointing at the bare repo (gitfile format)
    fs.writeFileSync(path.join(linkedDir, ".git"), `gitdir: ${bareDir}\n`);

    const key = deriveClaudeProjectKey(linkedDir);

    // commonDir = bareDir; basename(bareDir) = ".bare" !== ".git" → branch (b)
    const realBare = fs.realpathSync(bareDir);
    expect(key).toBe(realBare);
  });

  it("non-git realpath", () => {
    // Branch (c): not a git repository — key = fs.realpathSync(targetPath)
    // Use a symlinked tmpdir to verify symlink resolution
    const real = mktemp();
    tmpdirs.push(real);
    const link = path.join(os.tmpdir(), `git-key-link-${Date.now()}`);

    fs.symlinkSync(real, link);
    try {
      const key = deriveClaudeProjectKey(link);
      // key must equal the canonical resolved path of the symlink
      expect(key).toBe(fs.realpathSync(link));
      // key must NOT be the raw symlink path (which may differ from realpath on macOS /private/var/...)
      expect(key).not.toBe(link);
    } finally {
      fs.rmSync(link, { force: true });
    }
  });

  it("linked worktree off standalone", () => {
    // Branch (a): linked worktree added from a standalone (non-bare) repo.
    // common-dir = <base>/.git  → basename === ".git" → return dirname = base toplevel
    const base = mktemp();
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), "git-key-wt-"));
    tmpdirs.push(base);
    tmpdirs.push(wt);

    git(["init", base], os.tmpdir());
    initGitConfig(base);
    execFileSync("git", ["-C", base, "commit", "--allow-empty", "-m", "init"], {
      stdio: "pipe",
      env: GIT_ENV,
    });
    git(["-C", base, "worktree", "add", wt], base);

    const keyFromWt = deriveClaudeProjectKey(wt);
    const keyFromBase = deriveClaudeProjectKey(base);

    // Both should resolve to the same key (the base repo root)
    expect(keyFromWt).toBe(keyFromBase);
    // key === realpath of base top-level
    expect(keyFromWt).toBe(fs.realpathSync(base));
    // key is NOT the worktree path
    expect(keyFromWt).not.toBe(fs.realpathSync(wt));
  });

  it("git failure errors", () => {
    // Branch (d): git exits non-zero for a reason OTHER than "not a git repository"
    // Must throw — must NOT silently fall to branch (c).
    //
    // Strategy: create a fake `git` script that exits 128 with a message that does
    // NOT contain "not a git repository", and override PATH so execFileSync picks it up.
    const dir = mktemp();
    tmpdirs.push(dir);

    const fakeGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-git-"));
    tmpdirs.push(fakeGitDir);

    const fakeGit = path.join(fakeGitDir, "git");
    fs.writeFileSync(
      fakeGit,
      "#!/bin/sh\necho 'error: dubious ownership in repository' >&2\nexit 128\n",
    );
    fs.chmodSync(fakeGit, 0o755);

    const fakeEnv = { ...process.env, PATH: `${fakeGitDir}:${process.env.PATH}` };
    expect(() => deriveClaudeProjectKey(dir, fakeEnv)).toThrow();
  });

  it("git failure throws identifiable ProjectKeyError with remediation message", () => {
    // Branch (d): the thrown error must be an identifiable ProjectKeyError so the
    // sync orchestrator can surface it as a non-zero exit instead of a warning.
    const dir = mktemp();
    tmpdirs.push(dir);

    const fakeGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-git-"));
    tmpdirs.push(fakeGitDir);

    const fakeGit = path.join(fakeGitDir, "git");
    fs.writeFileSync(
      fakeGit,
      "#!/bin/sh\necho 'error: dubious ownership in repository' >&2\nexit 128\n",
    );
    fs.chmodSync(fakeGit, 0o755);

    const fakeEnv = { ...process.env, PATH: `${fakeGitDir}:${process.env.PATH}` };

    let caught: unknown;
    try {
      deriveClaudeProjectKey(dir, fakeEnv);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ProjectKeyError);
    // The message must carry actionable remediation (git version / ownership).
    expect((caught as Error).message).toMatch(/git >= 2\.31/);
    expect((caught as Error).message).toMatch(/ownership/);
    // The original error must be preserved for diagnosis.
    expect((caught as ProjectKeyError).cause).toBeDefined();
  });
});

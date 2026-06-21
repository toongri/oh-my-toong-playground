import { describe, it, expect, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { resolveDeployTargets, DeployTargetsError } from "./resolve-deploy-targets.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rdt-test-"));
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
 * git commit requires a work tree, so a temporary one is created and pruned.
 */
function seedBareRepo(bareDir: string): void {
  const tmpWt = fs.mkdtempSync(path.join(os.tmpdir(), "rdt-seed-"));
  try {
    execFileSync("git", ["--git-dir", bareDir, "worktree", "add", "--orphan", "-b", "main", tmpWt], {
      stdio: "pipe",
      env: GIT_ENV,
    });
    execFileSync("git", ["-C", tmpWt, "commit", "--allow-empty", "-m", "init"], {
      stdio: "pipe",
      env: GIT_ENV,
    });
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

describe("resolveDeployTargets", () => {
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

  it("AC1.1: bare-structure container with 2 worktrees returns exactly those 2 worktree paths", () => {
    // Layout:
    //   <container>/.bare   (bare git repo)
    //   <container>/wt1     (worktree 1)
    //   <container>/wt2     (worktree 2)
    // resolveDeployTargets(<container>) must return [wt1, wt2] (bare entry excluded)
    const container = mktemp();
    tmpdirs.push(container);

    const bareDir = path.join(container, ".bare");
    const wt1 = path.join(container, "wt1");
    const wt2 = path.join(container, "wt2");

    execFileSync("git", ["init", "--bare", "-b", "main", bareDir], { stdio: "pipe" });
    seedBareRepo(bareDir);

    execFileSync("git", ["--git-dir", bareDir, "worktree", "add", "-b", "feat/a", wt1], {
      stdio: "pipe",
      env: GIT_ENV,
    });
    execFileSync("git", ["--git-dir", bareDir, "worktree", "add", "-b", "feat/b", wt2], {
      stdio: "pipe",
      env: GIT_ENV,
    });

    const result = resolveDeployTargets(container);

    // Order-insensitive set comparison; realpath normalizes macOS /var → /private/var
    const realWt1 = fs.realpathSync(wt1);
    const realWt2 = fs.realpathSync(wt2);
    expect(new Set(result)).toEqual(new Set([realWt1, realWt2]));
    expect(result).toHaveLength(2);
  });

  it("AC1.2: plain non-bare directory (no .bare child) returns [path] unchanged", () => {
    const dir = mktemp();
    tmpdirs.push(dir);

    const result = resolveDeployTargets(dir);

    expect(result).toEqual([dir]);
  });

  it("AC1.3: bare-structure path with .bare present but zero worktrees throws DeployTargetsError naming no-worktrees cause", () => {
    // A bare repo with no additional worktrees beyond the pruned seed worktree
    const container = mktemp();
    tmpdirs.push(container);

    const bareDir = path.join(container, ".bare");
    execFileSync("git", ["init", "--bare", "-b", "main", bareDir], { stdio: "pipe" });
    seedBareRepo(bareDir);
    // After seedBareRepo, the seed worktree is pruned — zero real worktrees remain

    expect(() => resolveDeployTargets(container)).toThrow(DeployTargetsError);

    let caught: unknown;
    try {
      resolveDeployTargets(container);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DeployTargetsError);
    // Message must name the "no worktrees" cause
    const msg = (caught as Error).message;
    expect(msg).toMatch(/no worktree/i);
  });

  it("AC1.4: bare-structure path where git enumeration fails throws DeployTargetsError (not silent [])", () => {
    // Create a container with a .bare child that is NOT a valid git repo
    // so that `git --git-dir=<path>/.bare worktree list` exits non-zero
    const container = mktemp();
    tmpdirs.push(container);

    const bareDir = path.join(container, ".bare");
    // Create .bare as a directory that is NOT a git repo
    fs.mkdirSync(bareDir);
    // Optionally place a non-git file inside so it is a plain dir
    fs.writeFileSync(path.join(bareDir, "not-a-git-repo"), "");

    expect(() => resolveDeployTargets(container)).toThrow(DeployTargetsError);

    let caught: unknown;
    try {
      resolveDeployTargets(container);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DeployTargetsError);
    // The error must NOT be a silent return
    expect(caught).toBeInstanceOf(DeployTargetsError);
    // cause must be preserved
    expect((caught as DeployTargetsError).cause).toBeDefined();
  });
});

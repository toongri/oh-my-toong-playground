import { describe, it, expect, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { assertCleanWorktree, assertDefaultBranch, PreflightGitError } from "./preflight-git.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mktemp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "preflight-git-test-"));
}

const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "T",
	GIT_AUTHOR_EMAIL: "t@t.com",
	GIT_COMMITTER_NAME: "T",
	GIT_COMMITTER_EMAIL: "t@t.com",
	// Isolate fixture-building commands (git init/commit/config/...) from the
	// host's global/system git config so fixtures are built deterministically
	// regardless of the host's git config. This does NOT protect
	// assertCleanWorktree's own behavior: GIT_ENV is only passed to the
	// execFileSync calls below that construct each fixture, never to
	// assertCleanWorktree itself (that goes through runGit in
	// preflight-git.ts, which invokes git at a fixed absolute path and
	// passes only HOME/XDG_CONFIG_HOME through, ignoring both GIT_ENV and
	// the ambient process.env). One mechanism partially keeps the
	// untracked-file tests honest: status is pinned with
	// `--untracked-files=normal`, which overrides any
	// `status.showUntrackedFiles` config regardless of its source — but NOT
	// `core.excludesFile` (verified empirically: a pinned run still hides
	// untracked files matched by a global excludes file). Because runGit
	// passes real HOME through, the host's actual global gitignore
	// (`~/.config/git/ignore` or `~/.gitconfig`'s `core.excludesFile`)
	// reaches every fixture below — on a host whose global ignore matches
	// `*.txt`, the untracked/dirty fixture files created here would be
	// silently excluded and the reject-tests would fail loudly against
	// correct code (a noisy failure, not a silent pass, but the coupling is
	// real).
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
};

/** git init -b main + one commit — hermetic fixture, never relies on machine-global init.defaultBranch. */
function initRepo(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
	execFileSync("git", ["init", "-b", "main", dir], { stdio: "pipe", env: GIT_ENV });
	execFileSync("git", ["-C", dir, "commit", "--allow-empty", "-m", "init"], {
		stdio: "pipe",
		env: GIT_ENV,
	});
}

/**
 * Writes a fake `git` executable into `binDir` that lies to the 3 read-only
 * queries `runGit` issues — `status` reports an empty (clean) tree,
 * `branch`/`symbolic-ref` both report "main" — and returns `binDir` so the
 * caller can prepend it to `PATH`. Mirrors the reviewer-reproduced PATH-shim
 * bypass: a program resolved by name search, not by fixed identity, answers
 * the gate's questions instead of the real git binary.
 */
function writeFakeGitShim(): string {
	const binDir = mktemp();
	const shimPath = path.join(binDir, "git");
	fs.writeFileSync(
		shimPath,
		[
			"#!/bin/sh",
			"# args: -C <repoDir> <command> [rest...] -- lies: clean tree, branch=main",
			'case "$3" in',
			"  status) exit 0 ;;",
			'  branch) echo "main"; exit 0 ;;',
			'  symbolic-ref) echo "main"; exit 0 ;;',
			"esac",
			"",
		].join("\n"),
	);
	fs.chmodSync(shimPath, 0o755);
	return binDir;
}

/**
 * Wires a local bare repo as `origin` and points refs/remotes/origin/HEAD at
 * its default branch via real git commands (no mocking) — mirrors what
 * `git clone` sets up for a real GitHub-hosted origin.
 */
function addOriginWithHead(dir: string, bareDir: string): void {
	execFileSync("git", ["init", "--bare", "-b", "main", bareDir], { stdio: "pipe" });
	execFileSync("git", ["-C", dir, "remote", "add", "origin", bareDir], {
		stdio: "pipe",
		env: GIT_ENV,
	});
	execFileSync("git", ["-C", dir, "push", "origin", "main"], { stdio: "pipe", env: GIT_ENV });
	execFileSync("git", ["-C", dir, "remote", "set-head", "origin", "main"], {
		stdio: "pipe",
		env: GIT_ENV,
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assertDefaultBranch", () => {
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

	it("default branch (main) checked out with origin/HEAD set does not throw", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		const bareDir = mktemp();
		tmpdirs.push(bareDir);

		initRepo(dir);
		addOriginWithHead(dir, bareDir);

		expect(() => assertDefaultBranch(dir)).not.toThrow();
	});

	it("default branch (main) checked out still does not throw when a local branch literally named origin/main also exists", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		const bareDir = mktemp();
		tmpdirs.push(bareDir);

		initRepo(dir);
		addOriginWithHead(dir, bareDir);
		// Creates (without checking out) a local branch named "origin/main".
		// `git symbolic-ref --short refs/remotes/origin/HEAD` then becomes
		// ambiguous between this local branch and the remote-tracking ref of
		// the same name, so `--short` backs off to the longer
		// "remotes/origin/main" form instead of "origin/main" — a form the
		// `origin/` prefix strip below doesn't recognize.
		execFileSync("git", ["-C", dir, "branch", "origin/main"], {
			stdio: "pipe",
			env: GIT_ENV,
		});

		expect(() => assertDefaultBranch(dir)).not.toThrow();
	});

	it("default branch containing a slash (release/1.0) checked out does not throw", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		const bareDir = mktemp();
		tmpdirs.push(bareDir);

		// Default branch name itself contains a slash — exercises that the
		// `refs/remotes/origin/` prefix strip is anchored and removes only
		// that one prefix, leaving the rest of the ref (including its
		// internal slash) untouched.
		fs.mkdirSync(dir, { recursive: true });
		execFileSync("git", ["init", "-b", "release/1.0", dir], { stdio: "pipe", env: GIT_ENV });
		execFileSync("git", ["-C", dir, "commit", "--allow-empty", "-m", "init"], {
			stdio: "pipe",
			env: GIT_ENV,
		});
		execFileSync("git", ["init", "--bare", "-b", "release/1.0", bareDir], { stdio: "pipe" });
		execFileSync("git", ["-C", dir, "remote", "add", "origin", bareDir], {
			stdio: "pipe",
			env: GIT_ENV,
		});
		execFileSync("git", ["-C", dir, "push", "origin", "release/1.0"], {
			stdio: "pipe",
			env: GIT_ENV,
		});
		execFileSync("git", ["-C", dir, "remote", "set-head", "origin", "release/1.0"], {
			stdio: "pipe",
			env: GIT_ENV,
		});

		expect(() => assertDefaultBranch(dir)).not.toThrow();
	});

	it("feature branch checked out throws PreflightGitError naming both branches", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		const bareDir = mktemp();
		tmpdirs.push(bareDir);

		initRepo(dir);
		addOriginWithHead(dir, bareDir);
		execFileSync("git", ["-C", dir, "checkout", "-b", "feature/x"], {
			stdio: "pipe",
			env: GIT_ENV,
		});

		expect(() => assertDefaultBranch(dir)).toThrow(PreflightGitError);

		let caught: unknown;
		try {
			assertDefaultBranch(dir);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(PreflightGitError);
		const msg = (caught as Error).message;
		expect(msg).toContain("feature/x");
		expect(msg).toContain("main");
	});

	it("detached HEAD throws PreflightGitError", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		const bareDir = mktemp();
		tmpdirs.push(bareDir);

		initRepo(dir);
		addOriginWithHead(dir, bareDir);
		const sha = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { env: GIT_ENV })
			.toString()
			.trim();
		execFileSync("git", ["-C", dir, "checkout", sha], { stdio: "pipe", env: GIT_ENV });

		expect(() => assertDefaultBranch(dir)).toThrow(PreflightGitError);
	});

	it("missing origin/HEAD throws PreflightGitError instead of silently passing", () => {
		const dir = mktemp();
		tmpdirs.push(dir);

		// main branch checked out, but no origin configured at all — must reject,
		// not silently pass, since the default branch cannot be determined.
		initRepo(dir);

		expect(() => assertDefaultBranch(dir)).toThrow(PreflightGitError);

		let caught: unknown;
		try {
			assertDefaultBranch(dir);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(PreflightGitError);
		const msg = (caught as Error).message;
		expect(msg).toMatch(/git remote set-head origin -a/);
	});

	it("unrecognized origin/HEAD ref shape (not under refs/remotes/origin/) fails closed with a format-specific message", () => {
		const dir = mktemp();
		tmpdirs.push(dir);

		initRepo(dir);
		// Points refs/remotes/origin/HEAD at a ref outside refs/remotes/origin/
		// (no such shape a real `git remote set-head` ever produces, but nothing
		// stops refs/remotes/origin/HEAD from being written directly) so the
		// `refs/remotes/origin/` prefix strip in resolveDefaultBranch cannot
		// apply — this must fail closed with a format-specific message, not
		// silently slice a wrong prefix into an empty/garbage branch name.
		execFileSync(
			"git",
			["-C", dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/heads/main"],
			{ stdio: "pipe", env: GIT_ENV },
		);

		let caught: unknown;
		try {
			assertDefaultBranch(dir);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(PreflightGitError);
		const msg = (caught as Error).message;
		expect(msg).toContain("예상치 못한 형식");
	});

	it("feature branch still throws when a fake `git` shim on PATH lies that it's main", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		const bareDir = mktemp();
		tmpdirs.push(bareDir);
		const shimBinDir = writeFakeGitShim();
		tmpdirs.push(shimBinDir);

		initRepo(dir);
		addOriginWithHead(dir, bareDir);
		execFileSync("git", ["-C", dir, "checkout", "-b", "feature/x"], {
			stdio: "pipe",
			env: GIT_ENV,
		});

		const savedPath = process.env.PATH;
		try {
			// Real-world bypass a reviewer reproduced: PATH was the one env var
			// runGit's allow-list still passed through, and PATH is exactly what
			// decides which `git` binary answers the gate's questions. A shim
			// placed ahead of the real git on PATH intercepts `branch
			// --show-current` and `symbolic-ref` and reports "main" for both,
			// making a feature branch look like the default branch.
			process.env.PATH = `${shimBinDir}:${savedPath ?? ""}`;

			expect(() => assertDefaultBranch(dir)).toThrow(PreflightGitError);
		} finally {
			process.env.PATH = savedPath;
		}
	});
});

describe("assertCleanWorktree", () => {
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

	it("staged change only throws PreflightGitError", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		initRepo(dir);
		fs.writeFileSync(path.join(dir, "staged.txt"), "staged content");
		execFileSync("git", ["-C", dir, "add", "staged.txt"], { stdio: "pipe", env: GIT_ENV });

		expect(() => assertCleanWorktree(dir)).toThrow(PreflightGitError);
	});

	it("unstaged change to a tracked file throws PreflightGitError", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		initRepo(dir);
		fs.writeFileSync(path.join(dir, "tracked.txt"), "v1");
		execFileSync("git", ["-C", dir, "add", "tracked.txt"], { stdio: "pipe", env: GIT_ENV });
		execFileSync("git", ["-C", dir, "commit", "-m", "add tracked"], {
			stdio: "pipe",
			env: GIT_ENV,
		});
		fs.writeFileSync(path.join(dir, "tracked.txt"), "v2");

		expect(() => assertCleanWorktree(dir)).toThrow(PreflightGitError);
	});

	it("untracked file only throws PreflightGitError naming the file", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		initRepo(dir);
		fs.writeFileSync(path.join(dir, "untracked.txt"), "new file");

		expect(() => assertCleanWorktree(dir)).toThrow(PreflightGitError);

		let caught: unknown;
		try {
			assertCleanWorktree(dir);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(PreflightGitError);
		const msg = (caught as Error).message;
		expect(msg).toContain("untracked.txt");
	});

	it("gitignored file only does not throw", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		fs.mkdirSync(dir, { recursive: true });
		execFileSync("git", ["init", "-b", "main", dir], { stdio: "pipe", env: GIT_ENV });
		fs.writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\n");
		execFileSync("git", ["-C", dir, "add", ".gitignore"], { stdio: "pipe", env: GIT_ENV });
		execFileSync("git", ["-C", dir, "commit", "-m", "add gitignore"], {
			stdio: "pipe",
			env: GIT_ENV,
		});
		fs.writeFileSync(path.join(dir, "ignored.txt"), "should be ignored");

		expect(() => assertCleanWorktree(dir)).not.toThrow();
	});

	it("untracked file still throws when status.showUntrackedFiles=no is configured, while gitignored stays excluded", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		initRepo(dir);
		execFileSync("git", ["-C", dir, "config", "status.showUntrackedFiles", "no"], {
			stdio: "pipe",
			env: GIT_ENV,
		});
		fs.writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\n");
		execFileSync("git", ["-C", dir, "add", ".gitignore"], { stdio: "pipe", env: GIT_ENV });
		execFileSync("git", ["-C", dir, "commit", "-m", "add gitignore"], {
			stdio: "pipe",
			env: GIT_ENV,
		});
		fs.writeFileSync(path.join(dir, "ignored.txt"), "should stay ignored");
		fs.writeFileSync(path.join(dir, "untracked.txt"), "must not be hidden by config");

		expect(() => assertCleanWorktree(dir)).toThrow(PreflightGitError);

		// Remove the untracked file and confirm the gitignored-only tree still
		// passes even with the config bypass attempt in place — proves both
		// properties hold simultaneously, not just the untracked rejection.
		fs.rmSync(path.join(dir, "untracked.txt"));
		expect(() => assertCleanWorktree(dir)).not.toThrow();
	});

	it("dirty tree still throws when GIT_DIR/GIT_WORK_TREE point elsewhere in the environment", () => {
		const dirtyDir = mktemp();
		tmpdirs.push(dirtyDir);
		const cleanDir = mktemp();
		tmpdirs.push(cleanDir);
		initRepo(dirtyDir);
		initRepo(cleanDir);
		fs.writeFileSync(path.join(dirtyDir, "junk.txt"), "dirty");

		const savedEnv = { ...process.env };
		try {
			process.env.GIT_DIR = path.join(cleanDir, ".git");
			process.env.GIT_WORK_TREE = cleanDir;

			expect(() => assertCleanWorktree(dirtyDir)).toThrow(PreflightGitError);
		} finally {
			for (const key of Object.keys(process.env)) {
				if (!(key in savedEnv)) delete process.env[key];
			}
			Object.assign(process.env, savedEnv);
		}
	});

	it("dirty tree still throws when GIT_CONFIG_PARAMETERS injects a wildcard core.excludesFile", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		initRepo(dir);
		fs.writeFileSync(path.join(dir, "untracked.txt"), "must not be hidden by config injection");

		const excludesFile = path.join(mktemp(), "excl-all.txt");
		tmpdirs.push(path.dirname(excludesFile));
		fs.mkdirSync(path.dirname(excludesFile), { recursive: true });
		fs.writeFileSync(excludesFile, "*\n");

		const savedEnv = { ...process.env };
		try {
			// Real-world bypass a reviewer reproduced: GIT_CONFIG_PARAMETERS is an
			// env-based route to the same config git-config writes, so it can set
			// core.excludesFile to a file containing "*" and hide every untracked
			// file from `git status`, exactly like status.showUntrackedFiles=no
			// but via a variable the prior deny-list didn't enumerate.
			process.env.GIT_CONFIG_PARAMETERS = `'core.excludesFile=${excludesFile}'`;

			expect(() => assertCleanWorktree(dir)).toThrow(PreflightGitError);
		} finally {
			for (const key of Object.keys(process.env)) {
				if (!(key in savedEnv)) delete process.env[key];
			}
			Object.assign(process.env, savedEnv);
		}
	});

	it("file excluded only by the global gitignore does not throw, while a non-excluded untracked file still throws", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		const homeDir = mktemp();
		tmpdirs.push(homeDir);
		initRepo(dir);

		fs.mkdirSync(path.join(homeDir, ".config", "git"), { recursive: true });
		fs.writeFileSync(path.join(homeDir, ".config", "git", "ignore"), "ignored-globally/\n");
		fs.mkdirSync(path.join(dir, "ignored-globally"));
		fs.writeFileSync(path.join(dir, "ignored-globally", "f.txt"), "x");

		const savedHome = process.env.HOME;
		const savedXdg = process.env.XDG_CONFIG_HOME;
		try {
			// Global excludes file resolution (~/.config/git/ignore or
			// $XDG_CONFIG_HOME/git/ignore) is HOME-driven, not repo-driven — the
			// same mechanism this machine's real ~/.config/git/ignore relies on
			// to exclude .omo/. runGit must pass HOME through so this file is
			// found; otherwise everything it excludes reports as untracked and
			// assertCleanWorktree never passes on an otherwise-clean tree.
			process.env.HOME = homeDir;
			delete process.env.XDG_CONFIG_HOME;

			expect(() => assertCleanWorktree(dir)).not.toThrow();

			// A file the global ignore pattern does NOT cover must still be
			// caught — proves the fix respects the global gitignore without
			// blinding the gate to real dirt.
			fs.writeFileSync(path.join(dir, "other.txt"), "not covered by the global pattern");
			expect(() => assertCleanWorktree(dir)).toThrow(PreflightGitError);
		} finally {
			if (savedHome === undefined) delete process.env.HOME;
			else process.env.HOME = savedHome;
			if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = savedXdg;
		}
	});

	it("file excluded only by $XDG_CONFIG_HOME/git/ignore does not throw, while a non-excluded untracked file still throws", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		const xdgConfigHome = mktemp();
		tmpdirs.push(xdgConfigHome);
		initRepo(dir);

		fs.mkdirSync(path.join(xdgConfigHome, "git"), { recursive: true });
		fs.writeFileSync(path.join(xdgConfigHome, "git", "ignore"), "xdg-ignored/\n");
		fs.mkdirSync(path.join(dir, "xdg-ignored"));
		fs.writeFileSync(path.join(dir, "xdg-ignored", "f.txt"), "x");

		const savedXdg = process.env.XDG_CONFIG_HOME;
		try {
			// When XDG_CONFIG_HOME is set, git resolves its global excludes file
			// from $XDG_CONFIG_HOME/git/ignore instead of $HOME/.config/git/ignore
			// — verified directly against the real git binary: with both HOME and
			// XDG_CONFIG_HOME set, only the XDG_CONFIG_HOME pattern is honored, the
			// HOME/.config/git/ignore pattern is not. runGit must pass
			// XDG_CONFIG_HOME through so this file is found on a host where it's
			// set; otherwise everything it excludes reports as untracked and
			// assertCleanWorktree never passes on an otherwise-clean tree there.
			process.env.XDG_CONFIG_HOME = xdgConfigHome;

			expect(() => assertCleanWorktree(dir)).not.toThrow();

			// A file the XDG global ignore pattern does NOT cover must still be
			// caught — proves the fix respects the XDG global gitignore without
			// blinding the gate to real dirt.
			fs.writeFileSync(path.join(dir, "other.txt"), "not covered by the xdg pattern");
			expect(() => assertCleanWorktree(dir)).toThrow(PreflightGitError);
		} finally {
			if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = savedXdg;
		}
	});

	it("a git invocation failure (non-zero exit) surfaces as PreflightGitError, not a plain Error", () => {
		// No fixture repo needed: pointing runGit at a directory git cannot
		// enter forces a non-zero exit from the real git binary, exercising
		// runGit's own failure-normalization path (not resolveDefaultBranch's
		// separate catch, which assertCleanWorktree never goes through).
		let caught: unknown;
		try {
			assertCleanWorktree("/nonexistent-preflight-git-test-dir");
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(PreflightGitError);
		expect(caught).not.toBeUndefined();
	});

	it("dirty tree still throws when a fake `git` shim on PATH lies that it's clean", () => {
		const dir = mktemp();
		tmpdirs.push(dir);
		const shimBinDir = writeFakeGitShim();
		tmpdirs.push(shimBinDir);

		initRepo(dir);
		fs.writeFileSync(path.join(dir, "untracked.txt"), "must not be hidden by a PATH shim");

		const savedPath = process.env.PATH;
		try {
			// Real-world bypass a reviewer reproduced: `execFileSync("git", ...)`
			// resolves the binary by searching PATH, and PATH was the one env var
			// runGit's allow-list still passed through. A shim placed ahead of the
			// real git on PATH intercepts `status --porcelain
			// --untracked-files=normal` and reports an empty (clean) result no
			// matter what's actually on disk — no trace left in the repo itself.
			process.env.PATH = `${shimBinDir}:${savedPath ?? ""}`;

			expect(() => assertCleanWorktree(dir)).toThrow(PreflightGitError);
		} finally {
			process.env.PATH = savedPath;
		}
	});
});

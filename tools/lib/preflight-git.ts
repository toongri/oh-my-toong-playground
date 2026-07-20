import { execFileSync } from "node:child_process";

/**
 * Thrown when the OMT repo is not safely deployable, normalized across three
 * distinct sources so a single `instanceof PreflightGitError` catch at the
 * entry point handles all of them:
 * - `assertDefaultBranch` — the current branch is not the default branch,
 *   HEAD is detached, or origin/HEAD cannot be resolved at all.
 * - `assertCleanWorktree` — the working tree has staged, unstaged, or
 *   untracked changes.
 * - `runGit` — the underlying git invocation itself failed (e.g. the fixed
 *   `GIT_BINARY` path is missing, ENOENT).
 * There is no bypass for this error by design — `make sync` from a
 * non-default branch or a dirty tree is a structural hazard (an AI agent
 * deploying from an unreviewed branch or an uncommitted state without
 * approval), so any of these three must fail closed, not pass silently.
 */
export class PreflightGitError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, cause !== undefined ? { cause } : undefined);
		this.name = "PreflightGitError";
	}
}

/**
 * Absolute path to the git binary `runGit` invokes. Never resolved via a
 * PATH search and never overridable by an env var or CLI flag — see the
 * environment-hardening history below for why.
 *
 * If this binary is absent on a future host, `execFileSync` throws ENOENT
 * and `runGit` normalizes that into a loud `PreflightGitError` (see its doc
 * comment below) — there is no silent-pass path for a missing binary, only
 * a loud failure. Widening this constant later (e.g. to a different fixed
 * path for a different OS) is safe for the same reason a missing binary is
 * safe: any wrong value fails loudly, it cannot fail open.
 */
const GIT_BINARY = "/usr/bin/git";

/**
 * `runGit` invokes git by the fixed absolute path above, never by name
 * search, and passes only `HOME`/`XDG_CONFIG_HOME` through to the process
 * env (both omitted when the caller doesn't have them set). This is the
 * fourth step of an environment-hardening sequence that each closed one
 * axis, or corrected one blind spot, the previous step left open:
 *
 * 1. Deny-list (enumerate dangerous vars, drop them, pass everything else):
 *    failed because it enumerated `GIT_DIR`, `GIT_WORK_TREE`,
 *    `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, numbered
 *    `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` via `GIT_CONFIG_COUNT`, ...
 *    but missed `GIT_CONFIG_PARAMETERS` — a real git env var that injects
 *    arbitrary config, including `core.excludesFile` (hides untracked files
 *    from `git status`, same effect as `status.showUntrackedFiles=no`). A
 *    dirty tree passed the gate silently. A deny-list's failure mode is
 *    structural: it must name every current and future git env var that can
 *    redirect or inject state, and missing even one is a silent bypass, not
 *    a loud failure.
 *
 * 2. Allow-list (`["PATH"]`, drop everything else): closed the entire
 *    env-var-injection axis — verified empirically against a real git
 *    binary (macOS, git 2.x) with `env -i PATH="$PATH" git ...`:
 *    `symbolic-ref --short refs/remotes/origin/HEAD`, `branch
 *    --show-current`, and `status --porcelain --untracked-files=normal` all
 *    behaved identically to the full-environment case, including failure
 *    paths (missing origin/HEAD exits non-zero, detached HEAD gives empty
 *    output) — none of them needed `HOME`, any `GIT_CONFIG_*`, or anything
 *    beyond `PATH`. But `PATH` itself was still on the list, kept only so
 *    `execFileSync("git", ...)` could locate the `git` binary by name
 *    search — and a name search is exactly the axis that stayed open: *any*
 *    program the caller can place earlier on `PATH` and name `git` answers
 *    the gate's 3 questions instead of the real git binary, with zero trace
 *    left in the repository itself (unlike editing `preflight-git.ts`,
 *    which `git status` and code review would show). Reproduced directly: a
 *    5-line shell shim on `PATH` made a dirty, non-default-branch checkout
 *    report itself as clean and on `main`.
 *
 * 3. Empty env + fixed absolute path: removed the name search entirely, so
 *    `PATH` no longer had anything to decide — git ran at a fixed location
 *    (`GIT_BINARY`) the caller's environment couldn't redirect. Step 2's
 *    empirical check ("`HOME` skips `~/.gitconfig`, `git config --global
 *    --list` itself errors without it, and that error never reaches the 3
 *    queries this module issues") only exercised `~/.gitconfig`. It never
 *    exercised git's *global excludes file*
 *    (`$XDG_CONFIG_HOME/git/ignore`, falling back to
 *    `$HOME/.config/git/ignore`) — a second, independent thing `HOME`
 *    locates. `status --porcelain` reads that file too, and this repo's own
 *    real-world `~/.config/git/ignore` (which lists `.omo/`) exposed the
 *    gap directly: under `env: {}` the global entry became invisible to
 *    git, so `.omo/` — excluded only there, never in the repo's own
 *    `.gitignore` — reported as untracked. A fully-committed tree could
 *    never pass `assertCleanWorktree`, permanently blocking `make sync`
 *    until someone edited the repo's tracked `.gitignore` to duplicate a
 *    rule that belongs in the user's global config.
 *
 * 4. Reopen `HOME` and `XDG_CONFIG_HOME` only (this step): both exist for
 *    one reason each — they are how git locates the global excludes file
 *    that step 3's fully-empty env made unreachable. This is not a
 *    re-widened allow-list of the deny-list kind (step 1's failure was
 *    *enumerating without a reason for each entry*); each of these two has
 *    a named purpose tied directly to the requirement `assertCleanWorktree`
 *    exists to satisfy ("gitignored is not dirty" — see below). Everything
 *    step 2 and step 3 closed stays closed: `PATH` is still absent (no name
 *    search — `GIT_BINARY`'s fixed absolute path still decides which
 *    binary runs), and `GIT_DIR`/`GIT_WORK_TREE`/every `GIT_CONFIG_*` var
 *    still never reach the child process, so none of them can redirect the
 *    repo or inject config the way the deny-list-era bypass did.
 *
 *    Trade-off, stated plainly: reopening `HOME` also reopens the path to
 *    `~/.gitconfig`'s `core.excludesFile` pointing at a file containing
 *    `*` — the same "someone edits their own global git config to hide a
 *    file" axis `.git/info/exclude` already represents in
 *    `assertCleanWorktree`'s doc comment below, at the same
 *    accident-prevention (not adversary-resistant) tier this whole gate
 *    operates at. It is not a new category of exposure, just the same one
 *    reached through a second door.
 *
 * Every failure from the underlying `execFileSync` call — a missing
 * `GIT_BINARY` (ENOENT), a non-zero git exit, or anything else
 * `execFileSync` can throw — is normalized to `PreflightGitError` inside
 * this function, so all three call sites (`resolveDefaultBranch`,
 * `resolveCurrentBranch`, `assertCleanWorktree`) get a `PreflightGitError`
 * without each needing its own try/catch.
 */
function runGit(repoDir: string, args: string[]): string {
	const env: NodeJS.ProcessEnv = {};
	if (process.env.HOME !== undefined) env.HOME = process.env.HOME;
	if (process.env.XDG_CONFIG_HOME !== undefined) env.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;

	try {
		return execFileSync(GIT_BINARY, ["-C", repoDir, ...args], {
			stdio: ["pipe", "pipe", "pipe"],
			env,
		})
			.toString()
			.trim();
	} catch (err) {
		throw new PreflightGitError(`git 명령 실행에 실패했습니다: ${GIT_BINARY} -C ${repoDir} ${args.join(" ")}`, err);
	}
}

/**
 * Resolves the repo's default branch via refs/remotes/origin/HEAD (the same
 * ref `git clone` sets up). Throws PreflightGitError — never silently
 * passes — if origin/HEAD is unset, since "can't tell" must fail the gate,
 * not bypass it.
 */
function resolveDefaultBranch(repoDir: string): string {
	let ref: string;
	try {
		// No `--short`: `--short` means "shorten unless ambiguous", and a local
		// branch literally named e.g. "origin/main" makes that short name
		// ambiguous between the local branch and the remote-tracking ref of the
		// same name — git then backs off to the longer "remotes/origin/main"
		// form, which the prefix strip below doesn't recognize. The full ref
		// (refs/remotes/origin/<branch>) has no such ambiguity: it is what
		// `git remote set-head` writes, and it names exactly one thing.
		ref = runGit(repoDir, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
	} catch (err) {
		throw new PreflightGitError(
			`origin/HEAD가 설정되어 있지 않아 default 브랜치를 확인할 수 없습니다. ` +
				`\`git remote set-head origin -a\` 실행 후 다시 시도하세요. Original error: ${err}`,
			err,
		);
	}
	const prefix = "refs/remotes/origin/";
	if (!ref.startsWith(prefix)) {
		// Fail closed: an unrecognized ref shape means the default branch
		// cannot be confidently determined, so this must reject rather than
		// silently return a wrong branch name.
		throw new PreflightGitError(`origin/HEAD가 예상치 못한 형식(${ref})으로 반환되었습니다.`);
	}
	return ref.slice(prefix.length);
}

/** detached HEAD yields an empty string from `git branch --show-current`. */
function resolveCurrentBranch(repoDir: string): string {
	return runGit(repoDir, ["branch", "--show-current"]);
}

/**
 * Fails deployment when the OMT repo's current branch is not its default
 * branch. This is the structural gate against `make sync` running from an
 * unreviewed branch without approval — an accident-prevention device, not an
 * adversary-resistant one. By design there is no env var or CLI flag to
 * bypass it.
 *
 * @param repoDir - The OMT repo root (getRootDir() result). Never a deploy
 *   target repo.
 */
export function assertDefaultBranch(repoDir: string): void {
	const defaultBranch = resolveDefaultBranch(repoDir);
	const currentBranch = resolveCurrentBranch(repoDir);

	if (currentBranch === "") {
		throw new PreflightGitError(
			`현재 detached HEAD 상태입니다. default 브랜치(${defaultBranch})로 체크아웃 후 다시 시도하세요.`,
		);
	}

	if (currentBranch !== defaultBranch) {
		throw new PreflightGitError(
			`현재 브랜치(${currentBranch})가 default 브랜치(${defaultBranch})가 아닙니다. ` +
				`${defaultBranch} 브랜치로 체크아웃한 뒤 다시 시도하세요.`,
		);
	}
}

const DIRTY_FILE_LIST_LIMIT = 20;

/**
 * Fails deployment when the OMT repo's working tree has staged, unstaged, or
 * untracked changes. Uses `git status --porcelain --untracked-files=normal`:
 * gitignored files are still omitted by default (so a gitignored-only tree
 * like this repo's `sync.local.yaml` passes), while `--untracked-files=normal`
 * is pinned explicitly so an untracked file is always reported via the `??`
 * prefix regardless of a repo-local/global/`GIT_CONFIG_*`
 * `status.showUntrackedFiles` setting — bare `--porcelain` inherits that
 * config and a `status.showUntrackedFiles=no` setting silently hides
 * untracked files, defeating the gate. `--ignored` must still never be added
 * — that would surface gitignored files as dirty and break the
 * `sync.local.yaml` exception above.
 *
 * This is an accident-prevention gate, not an adversary-resistant one. By
 * design there is no env var or CLI flag to bypass it (see `runGit` above),
 * but two axes stay open to someone who deliberately manipulates the repo
 * itself:
 *
 * 1. `.git/info/exclude` containing `*`, or a repo-local `core.excludesFile`
 *    pointing at a file containing `*`, hides untracked files from `git
 *    status` the same way the `sync.local.yaml` gitignore exception above
 *    does — it IS that mechanism, not a separate hole.
 * 2. `git update-index --assume-unchanged <file>` hides a modified tracked
 *    file from `git status`.
 *
 * Neither is closed in code. Doing so would mean moving the "what's
 * ignorable" judgment from git into an OMT-owned exception list, which
 * reintroduces the enumeration failure mode that step 1 of the
 * environment-hardening sequence above was written to retire. See
 * `docs/sync-deploy-targets.md` for the full trade-off.
 *
 * @param repoDir - The OMT repo root (getRootDir() result). Never a deploy
 *   target repo.
 */
export function assertCleanWorktree(repoDir: string): void {
	const status = runGit(repoDir, ["status", "--porcelain", "--untracked-files=normal"]);
	if (status === "") {
		return;
	}

	const lines = status.split("\n");
	const shown = lines.slice(0, DIRTY_FILE_LIST_LIMIT).join("\n");
	const remainder = lines.length - DIRTY_FILE_LIST_LIMIT;
	const fileList = remainder > 0 ? `${shown}\n... 외 ${remainder}개` : shown;

	throw new PreflightGitError(
		`작업트리에 커밋되지 않은 변경사항이 있습니다. 커밋 후 다시 시도하세요.\n${fileList}`,
	);
}

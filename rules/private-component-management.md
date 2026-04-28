# Private Component Management

공개 OSS를 private fork로 유지하거나 upstream을 지속적으로 sync할 때는 반드시 canonical guide를 먼저 읽어라. 이 규칙은 그 가이드로의 진입점이다.

## When This Rule Applies

- Forking a public GitHub OSS repo into a private repo for internal/company use
- Maintaining an internal mirror of an upstream component while pulling main branch updates
- Adding internal patches or customizations on top of an OSS dependency
- Vendoring an OSS project where direct modification is required

## Canonical Guide

**Location:** `docs/PRIVATE-FORK-MANAGEMENT.en.md`
**Read before:** any first commit on a newly created private fork.

Covers bootstrap procedure, remote config, branch topology, upstream sync workflow, and recovery playbooks.

## Non-Negotiables

- **LFS is not migrated by `git push --mirror`.** Run `git lfs fetch --all` + `git lfs push --all` separately, or LFS files will be silently missing.
- **Submodules are not recursed by `--bare`/`--mirror`.** Each submodule needs its own mirror; `.gitmodules` URLs need rewriting.
- **Disable all inherited GitHub Actions workflows BEFORE first mirror push.** In the new private repo, set Settings → Actions → "Disable Actions" before running `git push --mirror`. Otherwise the mirror push itself can fire `on: push` workflows that publish to npm/Docker/Slack from your private fork. Re-enable selectively after review (Section 5 of the canonical guide).
- **`git remote set-url --push upstream DISABLE` is a single-layer guard, not a safeguard.** Back it with a `pre-push` hook and branch protection. Do not rely on the DISABLE trick alone.
- **Default branch topology: two-branch separation.** `upstream-main` fast-forwarded from upstream; `main` for internal integration via PR merge. Never mix upstream sync and internal patches on one branch.
- **PR contributions back to upstream require a separate public personal fork.** You cannot open a PR from a private repo to a public upstream.

## Branch Naming Convention

| Branch | Role | Push policy |
|--------|------|-------------|
| `upstream-main` | Mirror of upstream/main | Fast-forward only, automation-only |
| `main` (or `company/main`) | Internal integration | PR-only, requires review |
| `feature/*` | Internal feature work | Branched from `main` |

## See Also

- `docs/PRIVATE-FORK-MANAGEMENT.en.md` — full operational manual
- GitHub: https://docs.github.com/en/repositories/creating-and-managing-repositories/duplicating-a-repository

# Private Fork Management Guide

> Operational manual for setting up and maintaining a private GitHub repository that mirrors a public OSS upstream and continuously syncs upstream/main. The reader has already decided to private-fork. This covers how to do it, not whether to do it.

---

## 1. Bootstrap (One-Time)

### Pre-flight check

```bash
git lfs ls-files                   # Detect LFS objects
cat .gitmodules 2>/dev/null        # Detect submodules
find . -size +100M                 # Scan large files
```

### Standard mirror push

**Prerequisite (security-critical)**: Before `git push --mirror`, disable all Actions in the new private repo (Settings → Actions → "Disable Actions"). The mirror push uploads `.github/workflows/` and the push itself triggers `on: push` workflows, which may publish to npm/Docker/Slack via inherited secrets. Re-enable selectively after the Section 5 audit.

```bash
git clone --bare https://github.com/<upstream-org>/<repo>.git
cd <repo>.git
git push --mirror https://github.com/<your-org>/<private-repo>.git
cd .. && rm -rf <repo>.git
```

### LFS migration (if applicable)

`git push --mirror` does NOT transfer LFS objects. Required separately:

```bash
git clone --mirror https://github.com/<upstream-org>/<repo>.git
cd <repo>.git
git lfs fetch --all
git remote set-url origin https://github.com/<your-org>/<private-repo>.git
git lfs push --all origin
```

### Submodule migration (if applicable)

`--bare`/`--mirror` does NOT recurse submodules. For each submodule:

1. Mirror that submodule to its own private repo (repeat the bare-clone + mirror-push above).
2. After working clone, rewrite `.gitmodules` URL, or use:
   ```bash
   git config --global url.<private-base>.insteadOf <public-base>
   ```

### Large repo workaround

If single push exceeds GitHub's 2 GB limit, split per-branch:

```bash
for ref in $(git for-each-ref --format='%(refname)' refs/heads/); do
  git push origin "$ref"
done
git push origin --tags
```

### Post-mirror immediate actions

1. **Verify Actions remain disabled** (set in Section 1 prerequisite). Re-enable selectively after the audit in Section 5.
2. Sanitize `CODEOWNERS` — upstream usernames are invalid in your org.
3. Decide Dependabot/Renovate posture: keep upstream config, disable, or replace with internal equivalents.

---

## 2. Working Clone & Remote Configuration

```bash
git clone https://github.com/<your-org>/<private-repo>.git
cd <private-repo>
git remote add upstream https://github.com/<upstream-org>/<repo>.git
git remote set-url --push upstream DISABLED_DO_NOT_PUSH_TO_UPSTREAM
git config remote.pushDefault origin
```

### Pre-push hook (real safeguard)

The `--push DISABLED` trick is bypassed by explicit URL push or newly added remotes. Install a hook as the actual safety net.

Place at `.git/hooks/pre-push` (or distribute via `scripts/setup-repo.sh`):

```bash
#!/usr/bin/env bash
remote_url="$2"
if [[ "$remote_url" == *"<upstream-org>/<repo>"* ]]; then
  echo "ERROR: Pushing to upstream blocked by hook." >&2
  exit 1
fi
```

```bash
chmod +x .git/hooks/pre-push
```

---

## 3. Branch Topology — Two-Branch Separation

```
upstream/main (read-only ref)
       |
       v  (fast-forward only, automation)
upstream-main  --->  (PR merge into)  ---> main
                                             |
                                             v
                                         feature/*
```

| Branch | Role | Push policy |
|--------|------|-------------|
| `upstream-main` | Mirror of upstream/main | Fast-forward only, automation-only, branch-protected |
| `main` | Internal integration (your patches live here) | PR-only, requires review |
| `feature/*` | Internal feature work | Branched from `main` |

Branch protection (asymmetric — required for sync to work):

- **`main`**: require PR, require status checks, no force-push, no direct push (admins included).
- **`upstream-main`**: require status checks, no force-push, no manual direct push from humans. Direct push is allowed *only* from the sync automation actor (the SYNC_TOKEN owner / GitHub Actions bot identity used in Section 4 Sync Workflow). The automation pushes fast-forward commits from `upstream/main`; humans MUST use a PR.

Why asymmetric: sync (Section 4) is a fast-forward push from upstream and is owned by automation, not humans. Treating both branches identically would block the sync loop on its first run.

**Alternative:** If your team prefers linear history and allows force-push, use a single `company/main` rebased onto upstream/main with `--force-with-lease`. Trade-off: cleaner history, but breaks branches others have based on it.

---

## 4. Sync Workflow

### Manual routine

```bash
git fetch upstream
git checkout upstream-main
git merge --ff-only upstream/main
git push origin upstream-main
# Then open a PR: upstream-main -> main
gh pr create --base main --head upstream-main --title "Sync upstream $(date +%Y-%m-%d)"
```

### Automated (GitHub Actions cron)

Place at `.github/workflows/sync-upstream.yml`:

```yaml
name: Sync upstream
on:
  schedule:
    - cron: '0 9 * * 1'  # Mondays 09:00 UTC
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<full-commit-sha>  # pin Actions by SHA
        with:
          ref: upstream-main
          fetch-depth: 0
          token: ${{ secrets.SYNC_TOKEN }}
      - run: |
          git remote add upstream https://github.com/<upstream-org>/<repo>.git
          git fetch upstream main
          git merge --ff-only upstream/main
          git push origin upstream-main
      - uses: peter-evans/create-pull-request@<full-commit-sha>
        with:
          base: main
          branch: upstream-main
          title: 'Sync upstream'
          body: 'Auto-generated weekly sync.'
```

Pin third-party Actions by full commit SHA to reduce supply-chain risk.

Scheduled workflows only run from the default branch — keep `main` as the default.

---

## 5. Workflow & Secrets Audit (after first sync)

Inherited workflows from upstream `.github/workflows/` (disabled in Section 1 prerequisite). Before re-enabling Actions:

| Check | Why |
|-------|-----|
| External publish steps (`npm publish`, `docker push`, `pypi-publish`) | Could publish private fork code externally if a matching secret name already exists |
| Cron-triggered jobs | Will start running on your schedule immediately |
| Notification steps (Slack/Discord/email webhooks) | May ping upstream's channels if URL is hardcoded |
| Self-hosted runner labels | Your org won't have those runners |
| Required secrets the workflow expects | Document which exist or need to be created |

Disable workflows you don't need. Re-implement what you need using internal secrets and runners.

---

## 6. Internal Patches — Conflict Reduction

- Keep internal patches isolated to dedicated directories (`internal/`, `company/`) where possible. Smaller conflict surface during sync.
- Avoid cherry-picking from `main` to `upstream-main` — lineage breaks when upstream squash-merges.
- If patch count grows beyond ~30, audit: contribute upstream what fits, drop what doesn't, or split into a separate component.

---

## 7. PR Back to Upstream

You cannot open a PR from a private repo directly to a public upstream. To contribute:

1. Create a separate **public** personal fork on GitHub.
2. Cherry-pick or use `git format-patch` to extract the relevant commits from your private `main`.
3. Sanitize: strip internal-only refs (ticket numbers, internal URLs, secret-shaped strings).
4. Push to the public fork, then open a PR to upstream.

---

## 8. Recovery Playbooks

### 8.1 Failed sync rollback

If an automated or manual sync was incorrectly merged:

1. `gh pr list --base main --head upstream-main --state merged` to identify the incorrectly merged PR.
2. Open a revert PR — `gh pr revert <PR#>` (creates the PR automatically), or `git revert -m 1 <merge-commit>` then open a PR manually.
3. Merge the revert PR to `main` (no force-push — keep main protection in place).
4. The next sync may surface a conflict — see Section 4 for resolution.

### 8.2 Accidental upstream push detection

If commits were accidentally pushed to the upstream (public) repo:

1. Immediately delete the branch from upstream: `git push upstream --delete <branch>` or force-delete via GitHub UI.
2. Rotate any potentially exposed secrets immediately (see 8.3 below).
3. Request cache purge from GitHub Support — forks or clones may already carry the content.
4. Post-incident audit: verify the pre-push hook fired (or why it didn't), re-validate `git remote -v` outputs.

### 8.3 SYNC_TOKEN rotation

On token exposure or scheduled renewal:

1. Issue a new fine-grained PAT — scopes: `contents:write`, `pull-requests:write` (no others); expiry ≤ 90 days.
2. Update `SYNC_TOKEN` in private repo Settings → Secrets, then revoke the old token.
3. Confirm the next scheduled cron run completes without error.

### 8.4 Leaked private content removal

If private fork content was pushed externally:

1. Rewrite history to remove the leaked path: `git filter-repo --invert-paths --path <leaked-path>` (or `--replace-text` for inline secrets).
2. Force-push (`--force-with-lease` preferred — one-time exception; restore branch protection immediately after).
3. Request cache purge from GitHub Support — external clones may already carry residual data.
4. Rotate any exposed secrets in parallel (8.3).
5. Prevention: harden the pre-push hook, tighten branch protection, and do a paranoid audit of the path that allowed the leak.

---

> Last verified: 2026-04

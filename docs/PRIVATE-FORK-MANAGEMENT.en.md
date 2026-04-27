# Private Fork Management Guide

> This guide is for engineers and tech leads who need to maintain a private mirror of a public open-source repository inside a company's GitHub organization. It covers the full operational lifecycle: initial bootstrap, continuous upstream sync, internal patch management, compliance, and decommissioning. If you only need light customization without structural changes, read Section 1 first — the wrapper/dependency pattern may eliminate the need to fork entirely.

---

## 1. Decision: Should You Fork At All?

Before creating a fork, evaluate three options in order:

### Option A: Contribute Upstream

If your requirement is a bug fix, missing configuration hook, or generically useful feature, open a PR upstream. No maintenance burden. No drift. This is the right answer more often than engineers admit. Upstream rejection is not the default outcome.

### Option B: Wrapper / Inverted Dependency (Pattern C)

Add upstream as a Git submodule, a versioned language-level package dependency, or a vendored directory. Inject customizations via plugin APIs, middleware, configuration overlays, or adapter layers. Internal IP stays cleanly separated. Sync becomes a version bump.

**When this works:** The upstream project exposes stable extension points (plugin system, hook interfaces, configuration schema, provider pattern).

**When this fails:** You need to modify internals, override non-overridable behavior, or the upstream lacks any extension surface.

This pattern deserves serious evaluation before committing to a fork. A fork creates indefinite maintenance debt. A version bump does not.

### Option C: Private Fork

Justified when:

- Upstream changes need to be blocked or filtered (security patches only, no breaking API changes).
- Internal changes require modifying files that cannot be overridden externally (e.g., core internals, build scripts, embedded configs).
- License compliance requires controlling distribution.
- You need cherry-picked subsets of upstream history, not rolling HEAD.

**Decision criteria summary:**

| Situation | Recommended Path |
|---|---|
| You can contribute the change upstream | Upstream PR |
| Upstream exposes hooks/plugins | Wrapper/dependency |
| You must patch internals | Fork |
| You need to freeze at a stable commit | Fork |
| You need to filter upstream history | Fork |

---

## 2. License Compliance (Read This Before Forking)

**Read this section before writing a single git command.** License violations discovered after months of internal use are painful to remediate. License violations discovered after distributing a binary to a customer may be irreversible.

### License Decision Tree

```
Upstream license?
  ├── MIT / Apache 2.0 / BSD / ISC
  │     → Permissive. Fork freely.
  │     → Preserve LICENSE and NOTICE files on any distribution.
  │
  ├── LGPL 2.1 / MPL 2.0 / EPL 2.0
  │     → Weak copyleft.
  │     → Library-form linking (dynamic): typically OK.
  │     → Static linking or copy-paste integration: copyleft may propagate.
  │     → Verify with legal before bundling into a distributed product.
  │
  ├── GPL v2 / GPL v3
  │     → Strong copyleft.
  │     ├── Internal use only (same legal entity, employees only)
  │     │     → Typically not "distribution" per GNU GPL FAQ.
  │     │     → Reference: https://www.gnu.org/licenses/gpl-faq.en.html
  │     ├── Off-site contractors receiving a binary
  │     │     → Likely distribution. GPL obligations apply.
  │     ├── Customer-facing binary / container / appliance
  │     │     → Distribution. Must offer source.
  │     └── GPLv3 + consumer device ("User Product")
  │           → Installation information requirement applies.
  │
  ├── AGPL v3
  │     → Network copyleft.
  │     │ Reference: https://www.gnu.org/licenses/agpl-3.0.html.en
  │     ├── Customers interact with service over HTTP/network
  │     │     → Source disclosure obligation. Even if you never ship a binary.
  │     ├── B2B SaaS / public API where AGPL code runs in the path
  │     │     → Source disclosure obligation.
  │     └── Strictly internal admin tool, employees only, no external network access
  │           → Safe. Verify and document the boundary.
  │
  └── BSL / SSPL / ELv2 / RSAL / Commons Clause
        → Source-available. NOT OSI-approved open source.
        → Read the license text directly. Legal review required.
        → Do NOT assume permissive; these licenses restrict commercial use, SaaS deployment,
          or competitive product development in ways standard OSS licenses do not.
        → Historical precedents: Elastic→SSPL (2021), Redis→SSPL (2024),
          HashiCorp/Terraform→BSL (2023). Licenses CAN and DO change on subsequent releases.
```

### Practical Rules by License Family

**Permissive (MIT/Apache/BSD/ISC):** Lowest risk. Keep LICENSE intact in your private repo. Ensure LICENSE is bundled in any artifact you distribute (container image, binary, package).

**Weak copyleft (LGPL/MPL/EPL):** Medium risk. Legal review before static linking or copy-paste integration. Dynamic linking to an unmodified library is generally safe under LGPL.

**Strong copyleft (GPL):** Use carefully. Internal-only use is generally safe under the GNU GPL FAQ interpretation. The moment code leaves your legal entity (contractors, customers, partners receiving binaries), assess distribution. Document your "internal only" boundary explicitly.

**Network copyleft (AGPL):** High risk for any networked service. Treat AGPL as "GPL + network = distribution." If any external party interacts with a service that runs AGPL code, source disclosure is likely required. This includes external APIs, customer-facing dashboards, and B2B integrations.

**Source-available (BSL/SSPL/others):** Do not fork without explicit legal sign-off. These are designed to prevent exactly what this guide facilitates.

### "Internal Use Only" — Legal vs. Operational Definition

"Internal use" is a legal concept, not a network topology concept. Relevant factors:

- Who are the users? Employees of the same legal entity = internal. Contractors at a different entity = external.
- What is delivered? Accessing a service = not distribution. Receiving a binary, package, or container = distribution.
- Where does the code run? On-premise customer deployment = distribution. Your own servers = not distribution.
- Is there a separate legal entity receiving the binary? That is distribution regardless of relationship.

Document your answers. When circumstances change (new customer deployment model, new contractor arrangement), re-evaluate.

### Quarterly License Re-Check Protocol

Upstream licenses change. Schedule a quarterly review:

1. Check the upstream repo's LICENSE file. Compare with your recorded baseline version.
2. Check upstream release notes for license change announcements.
3. Re-run the decision tree above with the current license.
4. If the license changed to a more restrictive category, escalate to legal immediately before the next sync.

Automate the check:

```bash
# Record the license hash at bootstrap time
sha256sum LICENSE > .license-baseline.sha256

# Quarterly: compare
sha256sum -c .license-baseline.sha256 || echo "LICENSE FILE CHANGED — review required"
```

---

## 3. Bootstrap (One-Time)

**Reference:** https://docs.github.com/en/repositories/creating-and-managing-repositories/duplicating-a-repository

GitHub's fork button cannot create a private fork of a public repo. The canonical bootstrap is `git clone --bare` followed by `git push --mirror`. This is a one-time operation.

### Pre-Flight Checklist

Run these checks against the upstream repo before cloning. Skipping them causes silent failures that are expensive to repair later.

```bash
# 1. Check for Git LFS usage
git clone --no-checkout https://github.com/upstream-org/upstream-repo.git /tmp/upstream-check
cd /tmp/upstream-check
git lfs ls-files 2>/dev/null | head -20
cat .gitattributes 2>/dev/null | grep "filter=lfs"
# If any output: the repo uses LFS. Follow the LFS migration block below.

# 2. Check for submodules
cat .gitmodules 2>/dev/null
git submodule status 2>/dev/null
# If any output: the repo has submodules. Follow the submodule migration block below.

# 3. Scan for large files (potential LFS candidates)
git log --all --objects | sort -k2 | uniq -f1 -d | \
  git cat-file --batch-check='%(objectsize) %(rest)' | \
  sort -rn | head -20
# Files above 50MB should be in LFS. Files above 100MB will be rejected by GitHub.

# 4. Estimate total pack size
git count-objects -vH
# If "size-pack" > ~2GB, plan for per-branch push (see Large Repo section below).

cd /tmp && rm -rf upstream-check
```

### Standard Bootstrap (No LFS, No Submodules)

```bash
# Step 1: Create empty private repo on GitHub first (via UI or gh CLI)
gh repo create my-org/private-repo --private

# Step 2: Bare-clone upstream
git clone --bare https://github.com/upstream-org/upstream-repo.git upstream-bare
cd upstream-bare

# Step 3: Mirror-push to private repo
git push --mirror git@github.com:my-org/private-repo.git

# Step 4: Clean up
cd ..
rm -rf upstream-bare
```

This transfers: all branches, all tags, all commit history. It does NOT transfer LFS objects, submodule contents, or any GitHub metadata (Issues, PRs, Actions secrets, etc.).

### LFS Migration Block

**WARNING: `git push --mirror` silently skips LFS objects. Your private repo will have LFS pointer files but no backing objects. Clones will fail to resolve LFS files with no error on the push side.** This is the most common bootstrap failure mode.

```bash
# In the bare clone directory, before mirror push:

# Step 1: Fetch all LFS objects from upstream
git lfs fetch --all origin

# Step 2: Push LFS objects to the private remote FIRST
git lfs push --all git@github.com:my-org/private-repo.git

# Step 3: Then mirror-push refs
git push --mirror git@github.com:my-org/private-repo.git

# Verify LFS integrity after clone:
git clone git@github.com:my-org/private-repo.git verify-clone
cd verify-clone
git lfs pull
# Should complete without errors
cd .. && rm -rf verify-clone
```

In CI/CD that runs after bootstrap, always set:

```bash
git lfs install
git lfs pull
```

### Submodule Migration Block

`--bare` and `--mirror` do not recurse into submodules. Each submodule is an independent repository and must be mirrored separately.

```bash
# List all submodule URLs
git config --file .gitmodules --get-regexp url

# For each submodule, create a private mirror:
git clone --bare https://github.com/upstream-org/submodule-repo.git submodule-bare
cd submodule-bare
git push --mirror git@github.com:my-org/private-submodule-repo.git
cd .. && rm -rf submodule-bare

# Rewrite .gitmodules in your private fork to point to private submodule mirrors:
# Option A: Edit .gitmodules directly and commit
# Option B: Use git config url rewrite (no commit needed, per-developer config):
git config --global url."git@github.com:my-org/".insteadOf "https://github.com/upstream-org/"
```

### Large Repo Workaround (>2GB pack size)

GitHub rejects pushes with refs containing objects exceeding limits in a single push. Push branches individually:

```bash
# Push default branch first
git push git@github.com:my-org/private-repo.git refs/heads/main:refs/heads/main

# Push remaining branches
for branch in $(git branch -r | grep -v HEAD | sed 's|origin/||'); do
  git push git@github.com:my-org/private-repo.git "refs/remotes/origin/${branch}:refs/heads/${branch}" || true
done

# Push tags
git push git@github.com:my-org/private-repo.git --tags
```

### Immediately Disable All GitHub Actions Workflows

**This is the first action after mirror push — do it before anyone clones the private repo.**

Upstream's `.github/workflows/*.yml` files are regular repo files. They transferred. They will run. This includes cron jobs that fire on schedule, `pull_request` triggers, and steps that publish to npm/PyPI/Docker Hub/Slack using upstream's registered secrets (which your repo does not have, so they'll fail noisily, but they'll run).

```bash
# Option A: Disable all workflows via gh CLI (fastest)
gh api repos/my-org/private-repo/actions/workflows --jq '.workflows[].id' | \
  xargs -I{} gh api -X PUT repos/my-org/private-repo/actions/workflows/{}/disable

# Verify:
gh api repos/my-org/private-repo/actions/workflows --jq '.workflows[] | {id, name, state}'

# Option B: Manual via GitHub UI
# Settings → Actions → General → "Disable Actions" → Save
# (This disables all workflows; re-enable selectively after audit)

# Option C: Delete all workflow files (nuclear; requires re-adding selectively)
# Only use if you intend to replace all workflows
git rm .github/workflows/*.yml
git commit -m "chore: disable upstream workflows pending audit"
git push origin main
```

After auditing (see Section 8 for the audit checklist), re-enable or rewrite workflows that are safe and needed.

---

## 4. Remote Configuration

### Add Upstream Remote

After cloning your private repo locally:

```bash
git clone git@github.com:my-org/private-repo.git
cd private-repo

# Add upstream as a fetch-only remote
git remote add upstream https://github.com/upstream-org/upstream-repo.git

# Verify
git remote -v
# origin    git@github.com:my-org/private-repo.git (fetch)
# origin    git@github.com:my-org/private-repo.git (push)
# upstream  https://github.com/upstream-org/upstream-repo.git (fetch)
# upstream  https://github.com/upstream-org/upstream-repo.git (push)
```

Reference: https://git-scm.com/docs/git-remote

### Push Protection (Layered Defense)

A single `git remote set-url --push upstream DISABLE` is insufficient. It is trivially bypassed by: specifying the URL explicitly (`git push https://github.com/upstream-org/...`), adding a second remote, new team members who didn't run the command, or `git remote set-url origin <upstream-url>`. Apply all four layers:

**Layer 1: Semantic DISABLE URL**

```bash
git remote set-url --push upstream DISABLED_DO_NOT_PUSH_TO_UPSTREAM
```

This causes an obvious error if someone accidentally runs `git push upstream`. It is a reminder, not a guard.

**Layer 2: Pre-push Hook (the real guard)**

Create `.git/hooks/pre-push` (or distribute via `scripts/setup-repo.sh` — see Section 14):

```bash
#!/usr/bin/env bash
# pre-push hook: block pushes to the upstream public repo
set -euo pipefail

UPSTREAM_HOST="github.com"
UPSTREAM_PATH="upstream-org/upstream-repo"

while read local_ref local_sha remote_ref remote_sha; do
  : # consume stdin to prevent broken pipe
done

# The remote URL is passed as the second argument to the hook
REMOTE_URL="${2:-}"

if echo "${REMOTE_URL}" | grep -q "${UPSTREAM_HOST}/${UPSTREAM_PATH}"; then
  echo "ERROR: Push to upstream repo is blocked."
  echo "Remote: ${REMOTE_URL}"
  echo "Push to origin (private fork) instead."
  exit 1
fi

exit 0
```

```bash
chmod +x .git/hooks/pre-push
```

**Layer 3: Set default push target**

```bash
git config remote.pushDefault origin
```

This ensures `git push` with no arguments always targets `origin`, never `upstream`.

**Layer 4: No upstream credentials**

- If using HTTPS: do not store a PAT that has write access to the upstream org.
- If using SSH: ensure your SSH key is not authorized as a deploy key or collaborator on the upstream repo.
- For team enforcement: use the upstream remote's HTTPS URL (read-only for public repos; SSH keys provide no write access to repos you don't own).

### SSH vs HTTPS Policy

| Scenario | Recommendation |
|---|---|
| Private fork push | SSH (deploy key or personal SSH key) |
| Upstream fetch | HTTPS (no credentials needed for public repos) |
| CI/CD (GitHub Actions) | `GITHUB_TOKEN` with restricted permissions |

Mixing SSH for origin and HTTPS for upstream is intentional — it means no credential stored for upstream will ever permit an accidental push.

---

## 5. Branch Topology

### Default: Pattern A — Two-Branch Separation (Recommended)

```
upstream/main (fetched from public upstream)
      │
      │  git fetch upstream
      │  git merge --ff-only upstream/main
      ▼
upstream-main (private repo, protected branch)
      │
      │  PR merge (via pull request, not direct push)
      ▼
main (private repo, integration branch — company patches live here)
      │
      ├── feature/internal-feature-a
      ├── feature/internal-feature-b
      └── fix/internal-bugfix-c
```

**How it works:**

- `upstream-main` is a protected branch that only fast-forwards from `upstream/main`. No commits are made directly to this branch; only the sync automation (Section 6) writes to it.
- `main` (or `company/main`) contains all internal patches. Upstream updates arrive as a PR from `upstream-main` into `main`. Conflicts are resolved on this PR.
- Feature branches cut from `main` and merge back to `main`.

**Advantages:** No force-push required anywhere. Full audit trail. Conflict resolutions are preserved in history. Automation-friendly — the PR creation is scriptable.

**Disadvantage:** Merge commits accumulate over time in `main`. For long-running forks this creates a noisy history. Acceptable for most teams.

### Branch Protection Rules

**On `upstream-main`:**

```
Branch protection for: upstream-main
  ✓ Restrict who can push: [automation service account only]
  ✓ Require pull request reviews: DISABLED (sync automation merges directly)
  ✓ Require status checks: DISABLED (no CI needed for this branch)
  ✓ Allow force pushes: DISABLED
  ✓ Allow deletions: DISABLED
```

**On `main`:**

```
Branch protection for: main
  ✓ Require pull request reviews before merging
  ✓ Required number of approvals: 1 (or per team policy)
  ✓ Dismiss stale pull request approvals when new commits are pushed
  ✓ Require status checks to pass before merging
  ✓ Require branches to be up to date before merging
  ✓ Restrict who can push directly: [none; all changes via PR]
  ✓ Allow force pushes: DISABLED
  ✓ Allow deletions: DISABLED
  □ Require signed commits: optional; recommended for high-compliance environments
```

### Tag Policy

Upstream tags transfer during mirror. Do not reuse upstream tag names for internal releases. Use a company prefix:

```
v1.2.3         — upstream tag (do not create)
company/v1.2.3 — internal release tag
```

---

## 6. Sync Workflow

### Manual Sync Routine

Run when you want to pull upstream changes into `upstream-main`:

```bash
# Fetch latest from upstream (read-only)
git fetch upstream

# Fast-forward upstream-main to match upstream/main
git checkout upstream-main
git merge --ff-only upstream/main
git push origin upstream-main

# Then open a PR: upstream-main → main
# Conflict resolution happens in that PR, not on upstream-main
```

If `--ff-only` fails, upstream has not moved linearly (rare for open source projects). In this case, investigate: check if `upstream-main` was accidentally committed to, or if upstream performed a history rewrite.

### Automated Sync via GitHub Actions

Schedule a workflow that auto-syncs `upstream-main` and opens a PR against `main` when there are new upstream commits.

**Important notes before using this workflow:**
- Scheduled Actions only run from the repository's **default branch**. Set `main` as the default branch.
- Pin all third-party Actions by **full commit SHA** to prevent supply-chain attacks. The example below uses SHA pins.
- The workflow requires a PAT or GitHub App with `contents: write` and `pull-requests: write` permissions.

```yaml
# .github/workflows/sync-upstream.yml
name: Sync Upstream

on:
  schedule:
    # Run daily at 02:00 UTC
    - cron: '0 2 * * *'
  workflow_dispatch:  # Allow manual trigger

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout private repo
        # pin: actions/checkout v4.1.7
        uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332
        with:
          fetch-depth: 0
          token: ${{ secrets.SYNC_PAT }}

      - name: Configure git
        run: |
          git config user.name "sync-bot"
          git config user.email "sync-bot@my-org.example.com"

      - name: Add upstream remote
        run: |
          git remote add upstream https://github.com/upstream-org/upstream-repo.git
          git fetch upstream

      - name: Fast-forward upstream-main
        id: fast_forward
        run: |
          git checkout upstream-main
          if git merge --ff-only upstream/main; then
            git push origin upstream-main
            echo "updated=true" >> "$GITHUB_OUTPUT"
          else
            echo "Fast-forward failed. upstream-main may have diverged."
            echo "updated=false" >> "$GITHUB_OUTPUT"
            exit 1
          fi

      - name: Check if PR needed
        id: check_pr
        if: steps.fast_forward.outputs.updated == 'true'
        run: |
          BEHIND=$(git rev-list --count main..upstream-main)
          echo "commits_behind=${BEHIND}" >> "$GITHUB_OUTPUT"

      - name: Create PR upstream-main → main
        if: |
          steps.fast_forward.outputs.updated == 'true' &&
          steps.check_pr.outputs.commits_behind != '0'
        # pin: gh CLI is pre-installed on ubuntu-latest; no external action needed
        run: |
          COMMITS=$(git log --oneline main..upstream-main | head -10)
          gh pr create \
            --title "chore: sync upstream $(date +%Y-%m-%d)" \
            --body "$(printf "Automated upstream sync.\n\nRecent upstream commits:\n\`\`\`\n%s\n\`\`\`\n\nResolve conflicts if present, then merge." "${COMMITS}")" \
            --base main \
            --head upstream-main \
            --label "upstream-sync" || echo "PR already exists or no changes"
        env:
          GH_TOKEN: ${{ secrets.SYNC_PAT }}
```

Reference for `gh repo sync` alternative: https://cli.github.com/manual/gh_repo_sync

### Conflict Resolution SLA

Define your team's policy explicitly:

| Severity | Definition | SLA |
|---|---|---|
| No conflict | PR merges cleanly | Auto-merge or merge within 1 business day |
| Minor conflict | Mechanical conflict, clear resolution | Resolve within 2 business days |
| Major conflict | Semantic conflict requiring engineering judgment | Escalate to tech lead; resolve within 5 business days |
| Blocking | Upstream breaking change to internal-patched code | Immediate triage; may require patch rework |

Do not let sync PRs accumulate. Each unresolved sync PR is technical debt that compounds on the next upstream commit.

---

## 7. Internal Patch Policy

### Pattern A: Two-Branch Separation (Default)

Internal patches live on `main` as regular commits. They arrive via PRs from feature branches:

```bash
git checkout main
git checkout -b feature/internal-widget
# ... implement patch ...
git push origin feature/internal-widget
gh pr create --base main --head feature/internal-widget
```

When upstream sync arrives (PR from `upstream-main`), conflict resolution happens in the sync PR. The internal patch author resolves conflicts if they're related to their files.

### Pattern B: Rebase Model (Alternative for Clean-History Environments)

Use when: force-push policy allows it, and patch portability to upstream matters (e.g., you intend to upstream patches frequently).

```bash
# Rebase company/main onto latest upstream
git fetch upstream
git checkout company/main
git rebase upstream/main
git push origin company/main --force-with-lease

# Extract patches cleanly for upstreaming
git format-patch upstream/main..company/main --output-directory ./patches/
```

**Caveats:**
- Force-push breaks anyone with branches based on `company/main`. Coordinate or use short-lived feature branches only.
- This must be an internal-only branch; never a public branch that external collaborators track.
- `--force-with-lease` is required; bare `--force` risks overwriting concurrent pushes.

### Pattern C: Wrapper / Inverted Dependency

If reconsidering the fork, see Section 1. Pattern C remains the best long-term strategy if upstream extension points exist.

### Patch Count Threshold

At approximately 30 active internal patches, schedule an audit:

1. Categorize each patch: bug fix, feature addition, configuration override, build system change.
2. For bug fixes: attempt to upstream them. Carrying upstream-fixable bugs indefinitely is waste.
3. For feature additions: assess whether the feature has value to the upstream community. Upstream it or accept permanent maintenance.
4. For configuration overrides: consider externalizing via config files or environment variables rather than code patches.

**At 50+ patches, the fork is a product.** Budget engineering time accordingly or reconsider the architecture.

### File-Isolation Tactic

Keep internal-only code in dedicated directories to reduce conflict surface:

```
internal/          — internal features, not in upstream
company/config/    — company-specific configuration overrides
company/scripts/   — internal CI/CD scripts
```

Avoid modifying upstream files when you can add a new file that wraps or extends. Upstream changes to files you haven't touched create zero conflicts.

### Cherry-Pick Anti-Pattern

Do not cherry-pick from `upstream-main` into `main` for upstream commits. Cherry-picks create duplicate commits with different SHAs. When the next sync PR arrives with the same changes, you will see false conflicts ("this was already applied, but git can't tell"). Use the two-branch model instead — `upstream-main` merges always carry full lineage.

Exception: cherry-picking from `main` to a **separate public fork** for upstreaming is correct (see Section 11).

---

## 8. Security & Secrets

### Metadata That Does NOT Transfer via Mirror

The following exist only in GitHub's database, not in the Git repository:

| Category | Transfers? | Action Required |
|---|---|---|
| Issues and comments | No | Decide: migrate via API, accept loss, or link to upstream |
| Pull requests | No | Archive if needed; not automatable in bulk |
| Labels and milestones | No | Recreate manually |
| Discussions | No | Archive or recreate |
| Projects (boards) | No | Recreate |
| Branch protection rules | No | Reconfigure (see Section 5) |
| Repository settings | No | Reconfigure |
| Webhooks | No | Recreate |
| Deploy keys | No | Regenerate and register |
| Actions secrets/variables | No | Add fresh values |
| Actions environments | No | Recreate with approval rules |
| Self-hosted runners | No | Re-register (see Section 9) |
| Releases (notes, assets) | No | Tag refs transfer; release notes and binary assets do not |
| Wiki | No | Wiki is a separate `<repo>.wiki.git`; mirror separately if needed |
| GitHub Pages config | No | Reconfigure in Settings |

**Releases specifically:** tag refs (e.g., `v1.2.3`) transfer via mirror. The release description, associated binaries, and "latest release" marker are GitHub metadata and must be recreated manually or via API if needed.

### Secrets Storage Policy

- Never commit secrets to the repository. Not in `.env`, not in scripts, not in comments.
- Store secrets in: GitHub Actions secrets/environments, HashiCorp Vault, AWS Secrets Manager, or equivalent.
- Internal patches that reference secrets should reference environment variable names, not values.
- Periodically audit: `git log --all -S 'SECRET' --source --all` for any secret-shaped strings in history.

### Workflow Audit Checklist

Audit every workflow file inherited from upstream before re-enabling:

```bash
# List all workflow files
ls .github/workflows/

# For each workflow, check for:
grep -r "npm publish\|pypi\|docker push\|ghcr.io\|packages.github.com" .github/workflows/
# → Any publish step will fail without upstream secrets; may expose private packages if secrets added

grep -r "cron:" .github/workflows/
# → Scheduled jobs run automatically; may call external endpoints

grep -r "slack\|discord\|teams\|email\|notify\|webhook" .github/workflows/ -i
# → Notification steps will fire to upstream-configured endpoints

grep -r "pull_request_target\|workflow_run" .github/workflows/
# → These have elevated permissions and are common attack vectors in forks

grep -r "secrets\." .github/workflows/
# → Check which secrets are expected; yours may differ from upstream's
```

**Resolution per finding:**
- Publish steps: remove or replace with internal registry push.
- Cron jobs: evaluate necessity; disable if not needed.
- Notification steps: replace upstream webhook URLs with internal endpoints or remove.
- `pull_request_target` / `workflow_run`: audit carefully; these run with elevated privileges in GitHub's security model.

### CODEOWNERS Sanitization

```bash
# Find upstream contributor usernames in CODEOWNERS
cat CODEOWNERS

# Replace with your team's GitHub usernames or team slugs:
# @upstream-contributor → @my-org/backend-team
# Review each ownership assignment; don't carry upstream usernames forward
```

### Dependabot / Renovate Decision

| Option | When to use |
|---|---|
| Keep Dependabot/Renovate config | Upstream config is compatible with your branch topology |
| Disable | You use a different dependency update process, or the config creates noisy PRs |
| Replace | You want to customize PR targets, labels, or schedules for internal workflow |

If keeping, verify that the target branch is `main` (your integration branch), not `upstream-main`.

### Commit Author Email

In rare cases, push protection rules or CLA bots on the upstream (if accidentally targeted) may reject commits based on author email domain. This is not a common issue for private forks, but if you see push rejections citing email, check:

```bash
git config user.email
# Should be your corporate email
```

---

## 9. CI/CD Setup

### Restoring Secrets and Environments

After bootstrap, recreate all secrets and environments from scratch. Do not assume any values transferred.

```bash
# Add repository secrets
gh secret set MY_SECRET --body "secret-value" --repo my-org/private-repo

# Add environment-scoped secrets
gh secret set DEPLOY_KEY --body "key-value" \
  --repo my-org/private-repo \
  --env production
```

For environment approval rules, configure via Settings → Environments in GitHub UI. These cannot be set via `gh` CLI at time of writing.

### Required Status Checks

Enable after at least one successful CI run. Requiring status checks before enabling them locks the branch permanently:

```bash
# Via gh CLI:
gh api repos/my-org/private-repo/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["ci/build","ci/test"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":1}' \
  --field restrictions=null
```

`enforce_admins: true` is critical. Without it, repository admins can merge without status checks passing, creating an audit gap.

### Self-Hosted Runner Registration

If upstream used self-hosted runners, their registrations do not transfer. Re-register:

```bash
# Generate a new registration token
gh api repos/my-org/private-repo/actions/runners/registration-token --method POST

# Use the token to register your runner
# (follow your runner's platform-specific install instructions)
```

Update workflow files to reference your runner labels (e.g., `runs-on: self-hosted` or a custom label). Verify runner labels match before enabling workflows.

---

## 10. LFS, Submodules, and Large Files

### Detection Commands

Run against the private repo after bootstrap to verify state:

```bash
# Verify LFS objects are present
git lfs ls-files --all | wc -l
# Should match upstream count; 0 with pointer files = migration failure

# Check for dangling LFS pointers
git lfs fsck
# Should report no errors

# List submodules
git submodule status
# Shows +hash (modified), -hash (not initialized), or hash (clean)
```

### LFS Sync in CI

In any CI workflow that checks out the repo:

```yaml
- name: Checkout with LFS
  uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332  # pin to SHA
  with:
    lfs: true

- name: Pull LFS objects
  run: git lfs pull
```

Alternatively, set `GIT_LFS_SKIP_SMUDGE=0` and call `git lfs pull` manually. Do not rely on `lfs: true` alone in sparse checkouts.

### Submodule URL Rewrite Patterns

**Option A: Edit `.gitmodules` (permanent, tracked in repo)**

```ini
# .gitmodules — replace upstream URLs with private mirror URLs
[submodule "lib/external-component"]
    path = lib/external-component
    url = git@github.com:my-org/private-external-component.git
```

Commit the change. All clones automatically use the private mirror.

**Option B: Git URL rewrite (per-developer or per-CI, not tracked in repo)**

```bash
git config --global url."git@github.com:my-org/".insteadOf "https://github.com/upstream-org/"
```

Use this when modifying `.gitmodules` would create a spurious diff in upstream sync PRs.

### 100MB File Limit and LFS Migration

GitHub hard-rejects pushes containing individual files over 100MB. Detect offending blobs before pushing:

```bash
git rev-list --all --objects | \
  git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)' | \
  awk '/^blob/ && $2 > 104857600 {print $3, $2}' | \
  sort -k2 -rn
```

Migrate blobs to LFS:

```bash
git lfs migrate import --include="path/to/large-file.bin" --everything
# This rewrites history. Coordinate with the team before running.
```

### `.gitattributes` Validation

After any LFS migration or bootstrap:

```bash
# Verify all declared LFS patterns actually have objects
git lfs check-attr filter -- $(git lfs ls-files -n)
# Should show "filter: lfs" for all LFS-tracked files

# Check for files that match LFS patterns but are stored as blobs
git lfs status
```

---

## 11. Upstreaming Procedure

### Why You Need a Separate Public Fork

You cannot open a pull request from a private repository to a public repository. GitHub blocks cross-visibility PRs. To upstream a patch:

1. Create a **public personal fork** of the upstream repo (your personal GitHub account, not the company org).
2. Cherry-pick the sanitized patch to the personal fork.
3. Open the PR from the personal fork to upstream.

### Patch Sanitization Procedure

Before exposing any internal commits externally, strip:

```bash
# 1. Review commit messages for internal ticket references
git log --oneline company/main..HEAD
# Remove: "JIRA-1234", "internal:", "company/", "do not share"

# 2. Check for internal hostnames, IPs, or domain names in diffs
git diff upstream/main..company/main | grep -E "(\b10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|internal\.|corp\.)"

# 3. Check for secret-shaped strings
git diff upstream/main..company/main | grep -E "[A-Za-z0-9+/]{40,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]+"

# 4. Check for internal package registry references
git diff upstream/main..company/main | grep -E "packages\.(mycompany|internal)\."
```

Do not upstream patches containing any of the above without explicit review.

### CLA / DCO Handling

Many upstream projects require a Contributor License Agreement (CLA) or Developer Certificate of Origin (DCO) sign-off.

- **CLA:** Usually a one-time bot interaction on the PR. The bot will comment with instructions.
- **DCO:** Requires `Signed-off-by: Name <email>` in each commit message. Add with `git commit -s`. If your commits lack sign-offs, amend or use `git rebase --signoff`.

Use your **personal** email for public contributions, not your corporate email, unless your company policy specifies otherwise. Some employers claim IP ownership over work done with corporate accounts; verify your employment agreement.

### Cherry-Pick / format-patch Flow

```bash
# In the private repo: identify patches to upstream
git log --oneline upstream/main..company/main

# Generate patch files for review
git format-patch upstream/main..company/main --output-directory ./patches-for-upstream/

# In your public personal fork:
git remote add private-fork git@github.com:my-org/private-repo.git
git fetch private-fork
git cherry-pick <sanitized-commit-sha>
git push origin feature/my-upstream-contribution
# Open PR from personal fork to upstream
```

---

## 12. Emergency Procedures

### Scenario: Pushed to Upstream by Mistake

1. **Assess immediately:** What was pushed? Refs only (branch/tag), or objects including secrets?
2. **If secrets were pushed:** Rotate all secrets immediately (before any other action). Assume compromise.
3. **Contact upstream maintainers:** If you pushed commits to a repo you don't own, they will need to revert. File a GitHub support ticket and notify maintainers via their preferred channel.
4. **If you have admin on upstream (e.g., it's a fork you created publicly by mistake):**
   ```bash
   # Revert the push using gh CLI or git
   git push upstream <previous-sha>:refs/heads/main --force
   # This requires admin or push permission on that remote
   ```
5. **Audit access:** Determine who else may have cloned or fetched between the accidental push and revert.

### Scenario: Upstream Force-Pushed and History Diverged

Upstream force-pushing `main` is uncommon but occurs (history rewrite, accidental large file removal, etc.).

```bash
# Fetch upstream to see the new history
git fetch upstream

# Check what diverged
git log --oneline upstream/main..upstream-main
# These commits no longer exist in upstream

# Option A: Accept the rewrite and force-update upstream-main
git checkout upstream-main
git reset --hard upstream/main
git push origin upstream-main --force-with-lease

# Option B: Investigate whether internal commits were lost
# Check reflog for the old upstream-main tip
git reflog upstream-main
# Recover lost commits if they were incorrectly rebased over
```

If the force-push removed commits that contained internal patches (possible if internal commits were accidentally pushed to upstream), reconstruct from `main` branch which still has the internal patch history.

### Scenario: Secret Leaked into a Commit

Act immediately. A secret in git history is compromised regardless of whether anyone has seen it.

1. **Rotate the secret immediately.** This is step one, not step three.
2. **Audit access logs** on the service the secret grants access to.
3. **Remove from history:**
   ```bash
   # Install git-filter-repo (preferred over BFG for modern repos)
   pip install git-filter-repo

   # Remove specific file containing the secret
   git filter-repo --path path/to/file-with-secret --invert-paths

   # Or replace all instances of the secret value
   git filter-repo --replace-text <(echo "ACTUAL_SECRET_VALUE==>REDACTED")
   ```
4. **Force-push all branches:**
   ```bash
   git push origin --force --all
   git push origin --force --tags
   ```
5. **Notify all developers:** Every developer with a local clone must delete it and re-clone. Cached copies of the old history contain the secret.
6. **GitHub secret scanning:** Enable GitHub Secret Scanning on the private repo. It will alert on future accidental secret commits.

Reference: https://docs.github.com/en/repositories/archiving-a-github-repository/backing-up-a-repository (backup before filter-repo)

### Scenario: Mirror Push Overwrote Internal Branches

This happens if `git push --mirror` is run again after bootstrap. `--mirror` deletes any refs in the target that don't exist in the source.

```bash
# Check reflog on the remote (GitHub doesn't expose reflog via git protocol)
# Check local reflog if you have a recent clone
git reflog refs/heads/main

# Restore from local clone if available
git push origin <recovered-sha>:refs/heads/main --force-with-lease

# If no local clone: restore from your most recent backup
# Reference: https://docs.github.com/en/repositories/archiving-a-github-repository/backing-up-a-repository
```

**Prevention:** After bootstrap, never run `git push --mirror` again. For subsequent syncs, use `git fetch upstream && git merge --ff-only` as described in Section 6. If you need to push a new branch from upstream, push the specific ref: `git push origin refs/remotes/upstream/new-branch:refs/heads/new-branch`.

---

## 13. Audit & Compliance Review (Quarterly)

Schedule this review every three months. Assign a named owner for each item.

### License Re-Verification

```bash
# Compare current LICENSE with recorded baseline
sha256sum -c .license-baseline.sha256

# Check upstream release notes for license announcements
gh release list --repo upstream-org/upstream-repo | head -10
gh release view <latest-tag> --repo upstream-org/upstream-repo | grep -i license

# Update baseline if license is unchanged and verified:
sha256sum LICENSE > .license-baseline.sha256
git commit -m "chore: update license baseline after quarterly review"
```

Historical precedents for license changes to monitor for: Elastic → SSPL (Jan 2021), HashiCorp/Terraform → BSL 1.1 (Aug 2023), Redis → SSPL/proprietary hybrid (Mar 2024). License changes on major OSS projects are not rare events.

### Patch Count and Age Audit

```bash
# Count internal patches
git log --oneline upstream-main..main | wc -l

# Show patch age distribution
git log --oneline --format="%ai %s" upstream-main..main | \
  awk '{print $1}' | sort | uniq -c
```

For any patch older than 12 months:
- Is it still needed?
- Was it rejected upstream, or never submitted?
- Can it be upstreamed now?

### Upstream Activity Check

```bash
# Check commit frequency in the last 90 days
gh api repos/upstream-org/upstream-repo \
  --jq '{stars: .stargazers_count, open_issues: .open_issues_count, pushed_at: .pushed_at, archived: .archived}'

# Check for open PRs and recent contributor activity
gh pr list --repo upstream-org/upstream-repo --state open | wc -l
```

If upstream is archived or has had no commits in 6+ months, plan for fork independence: you are now the primary maintainer of all security patches.

### Workflow File Diff vs. Upstream

```bash
# Detect new workflow files added upstream since last review
git diff upstream-main..upstream/main -- .github/workflows/

# Alert on any new workflow added
git diff --name-only upstream-main..upstream/main | grep "\.github/workflows"
```

New upstream workflow files should be audited before being synced into the private repo's `main` branch.

### Access Audit

```bash
# List collaborators and their permissions
gh api repos/my-org/private-repo/collaborators --jq '.[] | {login, permissions}'

# List teams with access
gh api orgs/my-org/teams --jq '.[].name' | \
  xargs -I{} gh api orgs/my-org/teams/{}/repos --jq '.[] | select(.name=="private-repo") | {team: .full_name, permission: .permissions}'
```

Remove access for departed employees or contractors immediately. Revoke deploy keys for decommissioned services.

---

## 14. Onboarding Checklist

### New Team Member Setup

```bash
# Step 1: Register SSH key for private repo access
# → Upload public key to GitHub: Settings → SSH and GPG keys

# Step 2: Clone the private repo
git clone git@github.com:my-org/private-repo.git
cd private-repo

# Step 3: Run the repo bootstrap script (installs hooks, sets remote config)
bash scripts/setup-repo.sh

# Step 4: Verify remote configuration
git remote -v
# Expect: origin (push+fetch to private), upstream (fetch only to public)

# Step 5: First sync drill — verify you can fetch upstream without pushing
git fetch upstream
git log --oneline upstream/main | head -5

# Step 6: Verify pre-push hook is installed and functional
cat .git/hooks/pre-push
# Should show the hook from Section 4

# Step 7: Verify LFS (if applicable)
git lfs env
git lfs pull
```

### `scripts/setup-repo.sh` Reference

Create this script and commit it to the repo. It ensures every developer has consistent local configuration:

```bash
#!/usr/bin/env bash
# scripts/setup-repo.sh — Run once after cloning the private repo
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOOKS_DIR="${REPO_ROOT}/.git/hooks"

echo "Setting up private repo local configuration..."

# 1. Install pre-push hook
cp "${REPO_ROOT}/scripts/hooks/pre-push" "${HOOKS_DIR}/pre-push"
chmod +x "${HOOKS_DIR}/pre-push"
echo "✓ pre-push hook installed"

# 2. Set upstream remote push URL to disabled
git -C "${REPO_ROOT}" remote set-url --push upstream DISABLED_DO_NOT_PUSH_TO_UPSTREAM
echo "✓ upstream push URL disabled"

# 3. Set default push to origin
git -C "${REPO_ROOT}" config remote.pushDefault origin
echo "✓ pushDefault set to origin"

# 4. Install LFS if the repo uses it
if [ -f "${REPO_ROOT}/.gitattributes" ] && grep -q "filter=lfs" "${REPO_ROOT}/.gitattributes"; then
  git lfs install
  git lfs pull
  echo "✓ LFS configured and objects pulled"
fi

echo ""
echo "Setup complete. Run 'git fetch upstream' to verify read access to upstream."
```

Commit `scripts/hooks/pre-push` (the hook source) to the repo so `setup-repo.sh` can copy it. Hook templates in the repo are version-controlled; `.git/hooks/` is not.

---

## 15. Decommissioning

### When to Retire the Fork

| Signal | Recommended Action |
|---|---|
| Upstream now meets all internal needs | Remove internal patches, switch to direct upstream dependency |
| Internal project shut down | Archive the private repo |
| License change blocks further sync | Freeze at last-compliant commit; legal review before any further use |
| Wrapper pattern becomes viable (extension points added upstream) | Migrate to Pattern C; retire the fork |
| Upstream project abandoned + security vulnerabilities | Fork becomes permanent primary; staff accordingly |

### Internal-Patch Preservation Decision

Before archiving or deleting the repo, decide for each internal patch:

1. **Upstream it:** Extract, sanitize, and submit as a PR to upstream. Even to an abandoned project, a well-maintained fork can be pointed at upstream by others.
2. **Extract to a standalone library/module:** If the patch represents a generic capability, extract it as a separate package.
3. **Preserve in an archive branch:** If the patch has only historical value, create an archive branch `archive/internal-patches-YYYY` before deleting.
4. **Discard:** If the patch addresses a need that no longer exists.

### Reference Cleanup

Before deleting the repo, find and update all references to it:

```bash
# Find repos in the org that reference this repo
gh api orgs/my-org/repos --jq '.[].name' | \
  xargs -I{} gh api repos/my-org/{}/contents/.gitmodules 2>/dev/null | \
  grep -l "private-repo"

# Check CI/CD configs for references
# Check internal documentation wikis
# Check package.json/build.gradle/pom.xml for git+ssh references
# Check any IaC / deployment manifests that reference this repo
```

Update all references before decommissioning. A deleted repo that other systems depend on causes silent failures at their next deploy.

Set the repository to archived state first (Settings → Archive repository) for a minimum 30-day period before deletion. Archived repos are read-only but still accessible, giving dependent teams time to update their configurations.

---

*Last verified: 2026-04*

*References:*
- *https://docs.github.com/en/repositories/creating-and-managing-repositories/duplicating-a-repository*
- *https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/about-forks*
- *https://docs.github.com/en/enterprise-cloud/latest/migrations/importing-source-code/using-github-importer/about-github-importer*
- *https://docs.github.com/en/repositories/archiving-a-github-repository/backing-up-a-repository*
- *https://cli.github.com/manual/gh_repo_sync*
- *https://git-scm.com/docs/git-clone*
- *https://git-scm.com/docs/git-remote*
- *https://www.gnu.org/licenses/gpl-faq.en.html*
- *https://www.gnu.org/licenses/agpl-3.0.html.en*

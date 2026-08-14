# Make-PR Reference Tables

## Quick Reference

| Step | Action | Key Point |
|------|--------|-----------|
| 0-A: Base Branch Detection + Setup Question | `git fetch --all --prune`, merge-base analysis for all remote branches | Build candidate table, then ONE AskUserQuestion call: 타겟 브랜치 (always) + 동기화 방식 + 충돌 처리 방침 (both when any candidate is behind) — no auto-skip on the target |
| 0-B: Target Sync | `git rev-list --left-right --count` to confirm diverge | If behind > 0: execute the already-chosen `{sync-strategy}` — asks nothing |
| 0-C: Conflict Resolution | Analyze the whole round's conflicts, settle per `{conflict-policy}` | 파일별로 확인 → one call carrying one question per file (max 4). Stage each file, finalize with commit / rebase --continue. Policy carries across rebase rounds |
| Collect Git Metadata & PR Conventions | Run `git log`, `git diff --stat`, then `gh pr list --state all --limit 30` + `gh label list` | Metadata only, NO file contents. Derive title/branch/label conventions (majority pattern or "no convention") |
| Explore Codebase | Use explore agent | Do NOT ask user about codebase |
| User Interview | One question at a time, Clearance Checklist-based | Adaptive question count |
| Clearance Checklist | Check after every turn | Continue until all YES |
| Scope Assessment | Analyze thesis count, propose split if multi-thesis | Proxy signals trigger analysis, thesis isolation decides |
| Write PR Title & Description | Follow output-format.md exactly; title + labels per surveyed conventions | Emoji headers, Impact Scope, file paths in Checklist. Labels only from `gh label list` |
| User Review | Present and collect feedback | Repeat until approved |
| PR Creation | Pre-creation check (`origin/{base}..HEAD` ahead count > 0) → branch name convention check → `gh pr create` after user confirmation | Always `--assignee @me`; `--label` per selected label |

---

## Common Mistakes

| Mistake | Why It's a Problem | Fix |
|---------|-------------------|-----|
| Writing without Clearance Checklist | Incomplete info leads to inaccurate PR | Check checklist every turn |
| Bundling multiple questions in the Step 3 interview | Each interview answer shapes the next question; bundling lowers answer quality | One question at a time — Step 3 only |
| Asking the Step 0 setup decisions one call at a time | 타겟 브랜치·동기화 방식·충돌 처리 방침은 모두 후보 테이블만으로 답할 수 있는데 라운드트립만 3배가 된다 | Build all three from the candidate table into one AskUserQuestion call |
| Splitting sub-PRs by switching branches in the main working tree | Once the PRs are open, review feedback on several sub-PRs forces a checkout/stash round trip per switch, and the success path strands the main directory on the last sub-branch | One `git worktree` per sub-PR; the original branch stays checked out where it was |
| Sub-PR title or body that does not state its position in the series | Reviewer cannot tell what must merge first or where the rest of the series is | Title carries ` (K/N)`; Summary opens with the split context block, `#TBD` placeholders resolved after all PRs exist |
| Asking user about codebase facts | Unnecessary burden on user | Discover via explore |
| Describing design concerns in Changes | Mixes Changes and Review Points | Design concerns go in Review Points |
| Writing without Review Points | No focal points for reviewer feedback | Proactively identify Review Points |
| Running `gh pr create` without user confirmation | User must approve PR creation | Always confirm before running |
| Reading git diff file contents during PR description writing | Heavy context loading | Use git metadata + explore only (exception: Step 0-C conflict resolution) |
| Detecting only default branch | Stacked branches show massive diff against wrong base | Compare merge-base across all remote branches and present candidate table |
| Auto-selecting target branch | PR written against unintended target | Always confirm via AskUserQuestion — no auto-skip |
| Ignoring diverge | PR written against stale base | Sync via merge/rebase in Step 0-B |
| Ignoring conflicts | PR proceeds in incomplete state | Settle every conflict per `{conflict-policy}` in Step 0-C |
| Fixing question count | Required questions vary by context | Adaptive via Clearance Checklist |
| Writing PR in English | Violates project convention | Write entirely in Korean |
| Missing emoji section headers | Inconsistent with output-format.md template | Use 📌, 🔧, 💬, ✅, 📎 prefixes |
| Checklist items without file paths | Unverifiable conditions | Add indented file path under each item |
| Checklist items are file lists or feature descriptions | Not verifiable, not acceptance criteria | Write verifiable acceptance criteria (true/false) |
| Missing Impact Scope in Changes | Reviewer can't assess blast radius | Add `**영향 범위**` per Changes subsection |
| Omitting PR title | Incomplete deliverable | Include conventional commit style Korean title |
| Writing textbook definitions in Review Points | Repeats what reviewers already know, filler | Describe the specific constraints you faced |
| Listing "improvement effects" as marketing | Irrelevant to Review Point purpose | Focus on choices and trade-offs |
| Including non-git documents (memory/plans) in References | Reviewers cannot access them | Reference only reviewer-accessible content (GitHub URLs, git-tracked docs) |
| Skipping interview based on prior session context | PR based on incomplete/biased info | Run Clearance Checklist-based interview every time |
| Deciding split based on proxy signals alone | Wrong split without thesis analysis | Proxy signals are detection triggers only; thesis isolation is the final criterion |
| Proposing unnecessary split for single-thesis PR | User burden, workflow delay | If single thesis, proceed to Step 6 immediately |
| Reading git diff file contents during scope assessment | Violates Non-Negotiable Rule | Use only git diff --stat and git log |
| Deleting original branch after split | User cannot recover | Always preserve the original branch |
| Pushing without confirming the branch has commits the base lacks | `gh pr create` fails with "No commits between base and head" | Check `git rev-list --count origin/{base-branch}..HEAD > 0` before push |
| Gating PR creation on the remote target tip matching a SHA recorded earlier | On an active repo the target keeps moving during the interview, so the comparison never settles and the check re-fires indefinitely | Gate on the local ahead count instead — it is owned by the current branch and does not change when the target moves |
| References를 클릭 불가능한 bare-text로 작성 | GitHub-renderable 아님; reviewer가 navigate 불가 | `[Title](URL)` markdown link 사용. URL 없으면 user에게 한 번 묻고, 없으면 bare-text 허용 (Slack 채널 단독 예외) |
| Writing title from default style when the repo has a surveyed title convention | PR looks foreign in the repo's PR list | Survey result wins; defaults are fallback only |
| Creating PR without `--assignee @me` | PR left unassigned; ownership unclear | Always include `--assignee @me` in `gh pr create` |
| Applying a label that is not in `gh label list` | `gh pr create` fails or pollutes the label set | Only existing labels; if none fits, apply none |
| Pushing a machine-generated branch name without the convention check | Branch list pollution, convention drift | Check `{branch-convention}` before push; propose rename for unpushed branches |
| Forcing a convention from a handful of inconsistent PRs | Wrong convention applied confidently | ≥5 surveyed PRs AND majority pattern required; otherwise mark axis "no convention" and use fallback |

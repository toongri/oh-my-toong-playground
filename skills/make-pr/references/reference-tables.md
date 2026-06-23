# Make-PR Reference Tables

## Quick Reference

| Step | Action | Key Point |
|------|--------|-----------|
| 0-A: Base Branch Detection | `git fetch --all --prune`, merge-base analysis for all remote branches | Build candidate table, always confirm with AskUserQuestion — no auto-skip |
| 0-B: Target Sync | `git rev-list --left-right --count` to detect diverge | If behind > 0: merge/rebase interview + execute |
| 0-C: Conflict Resolution | Per-file context analysis + AskUserQuestion per conflict | Stage each resolved file, finalize with commit / rebase --continue |
| Collect Git Metadata | Run `git log`, `git diff --stat` | Metadata only, NO file contents |
| Explore Codebase | Use explore agent | Do NOT ask user about codebase |
| User Interview | One question at a time, Clearance Checklist-based | Adaptive question count |
| Clearance Checklist | Check after every turn | Continue until all YES |
| Scope Assessment | Analyze thesis count, propose split if multi-thesis | Proxy signals trigger analysis, thesis isolation decides |
| Write PR Title & Description | Follow output-format.md exactly | Emoji headers, Impact Scope, file paths in Checklist |
| User Review | Present and collect feedback | Repeat until approved |
| PR Creation | CAS freshness check → re-sync if target moved → `gh pr create` after user confirmation | Re-use Step 0-B strategy; re-interview only on conflict |

---

## Common Mistakes

| Mistake | Why It's a Problem | Fix |
|---------|-------------------|-----|
| Writing without Clearance Checklist | Incomplete info leads to inaccurate PR | Check checklist every turn |
| Bundling multiple questions | Increases user burden, lowers answer quality | One question at a time |
| Asking user about codebase facts | Unnecessary burden on user | Discover via explore |
| Describing design concerns in Changes | Mixes Changes and Review Points | Design concerns go in Review Points |
| Writing without Review Points | No focal points for reviewer feedback | Proactively identify Review Points |
| Running `gh pr create` without user confirmation | User must approve PR creation | Always confirm before running |
| Reading git diff file contents during PR description writing | Heavy context loading | Use git metadata + explore only (exception: Step 0-C conflict resolution) |
| Detecting only default branch | Stacked branches show massive diff against wrong base | Compare merge-base across all remote branches and present candidate table |
| Auto-selecting target branch | PR written against unintended target | Always confirm via AskUserQuestion — no auto-skip |
| Ignoring diverge | PR written against stale base | Sync via merge/rebase in Step 0-B |
| Ignoring conflicts | PR proceeds in incomplete state | Resolve all conflicts via per-file interview in Step 0-C |
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
| Skipping freshness check before PR creation | `gh pr create` fails or wrong diff when target branch moved | CAS pattern target SHA re-verification in Step 8 |
| References를 클릭 불가능한 bare-text로 작성 | GitHub-renderable 아님; reviewer가 navigate 불가 | `[Title](URL)` markdown link 사용. URL 없으면 user에게 한 번 묻고, 없으면 bare-text 허용 (Slack 채널 단독 예외) |

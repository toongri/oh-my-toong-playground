# Discipline that could not be moved into structure

This skill does not raise discipline as prohibitions. Everything a hook or the structure check can stop has been handed to those; what remains here is where a machine cannot see.

Here is how what moved and what stayed were split.

| What | Where it went |
|---|---|
| Skipping a step | The state CLI forces the order — with a prior step unpassed, submission itself is rejected |
| Generating the finished document early | A PreToolUse guard on the artifact path |
| Manipulating state | The write-guard rejects direct edits of the state file |
| Ending without passing the quiz | The Stop gate + rejection of `complete` |
| Lowering question difficulty | The rubric item count and unknown-value requirement are fixed into the question structure |
| Misclassifying noise | A one-line rationale is required for any classification outside the ruleset |
| Improvising the judge prompt | A fixed template (`judge-prompt.md`) |
| A judge's groundless pass | Quote required + the CLI's string comparison |
| A 근거 quote that is a paraphrase or lifted from the PR description | R22 — normalized-substring check against the commit-body ∪ net-diff corpus |

---

## Remainder 1 — leniency in grading

Waving a rubric item through as "roughly right" is something a machine cannot see. An item is **hit or not hit**, one of the two. If the answer did not state that item's content, put it in `--missing`.

When the call is close, suspect the **question**, not the item. An ambiguous grade usually means the rubric item was written ambiguously, and that is something to fix when making the question, not to excuse when grading.

## Remainder 2 — a leading question leaking the answer

That a tier-1 leading question must not use the rubric item's core noun/verb verbatim is caught by a string check, but a phrasing that leaks the answer while evading that check is not. Rephrasing with a synonym, quietly narrowing the options, or presenting the answer as "could it perhaps be …" are such forms.

The standard is one. **A leading question must send the reader back to the document, not carry them to the answer.** If you can answer after reading the question without looking at the document again, that is not leading but leaking.

## Remainder 3 — abusing the "왜" inference label

The `추론` provenance tag (`<span class="cf-src">추론</span>`) exists for use when there is no ground, not for when finding the ground is a chore. Attach it only when it is still absent after actually digging through the diff, commit message, comments, and adjacent code.

At every spot the tag is attached, ask yourself: **where did I actually look to confirm this.** If you cannot answer, you have not looked yet.

8 GREEN measured (in the era of the old bracket notation): the `추론` marking appeared in 7, and one document had it in 12 places (the same document's `근거` marking was fewer). The structure check validates the badge's **form** — a valid label with its companion present (`근거` + a quote, `추론` + a ground) — but it cannot judge whether that ground is **real**. Attaching an inference tag with a plausible-looking but unverified ground passes mechanically, which is why this item is left for a person.

## Remainder 5 — source fidelity R22 cannot reach

R22 mechanically proves a `근거` quote is a **real substring of the range's source** (commit bodies ∪ net diff). It does not — and cannot cheaply — prove three further things a person or a fact-check pass must still confirm, and each is a place invention hides:

- **Attribution — the dominant invention class.** A `### \`hash\`` commit subsection is a claim: "this commit did these things, to these files." Two things must be ground for the **specific commit the block names**, not merely present somewhere in the range:
  - **The 근거 quote.** A sentence verbatim in commit Y but attached to commit X passes R22 yet tells a false story about who did what.
  - **Every cf-loc file — and the exact path, at that commit.** Every `base:`/`head:` path in a commit subsection's `바뀐 위치` must be a file that commit actually changed. Before writing a subsection's cf-loc, run `git show --name-status --format= <hash>` (name-**status**, so you see M/A/D/R) and cite ONLY paths in that output. Precision beyond mere presence:
    - **In-place modify (`M`):** the base and head path are the **same** — `base:test/e2e/x.test.ts` → `head:test/e2e/x.test.ts`, never a different head directory. Citing `head:test/domains/smart-subscription/x.test.ts` for a file the commit modified in place at `test/e2e/x.test.ts` is a fabricated head path (that path may not even exist at head — confirm with `git ls-tree -r <head> --name-only`).
    - **Rename (`R`):** base = old path, head = new path — the one case the two differ; note the rename.
    - **A symbol that MOVED files across commits is not a rename of its file.** If commit X defined `HouseholdFeature` in `settings.ts` and a later commit Y moved it to `enums.ts`, then under X you cite `settings.ts` (where X changed it), NOT `enums.ts` (where it ended up). Citing the head-location file under the defining commit attributes a file X never touched.
    Citing `DrawerSupplementSection.test.tsx` under `803e20a` when that test was added by a later `a3aae94`, or `billing.md` under `4330caf` when it is `f94c176`'s only file, are real inventions that no mechanical gate catches — they read as authoritative history and are false.
  - **A change paired with a commit.** When a sentence credits a *specific change within a file* to a commit ("c551a6ea adjusts the trpc anchor AND adds `public.ts` to source_files"), each half must be that commit's real diff. Verify with `git show <hash> -- <path>`: if the `public.ts` line was added by `a973059a`, not `c551a6ea`, pairing it into c551a6ea's sentence is invention even though the other half is true. A true clause does not launder a false one riding alongside it.
  - **Never improvise a coverage-closure section.** R5 demands every signal file's location be cited somewhere. The wrong way to satisfy it is a catch-all "남은 위치 보강" group whose `### \`hash\`` headers are guessed — that manufactures false attribution wholesale. The right way: for each uncited file, find the commit that actually changed it (`git log --oneline <range> -- <path>`) and cite its location under **that** commit's change block. There is always a real commit; guessing one is invention.

  At every commit subsection, ask: **did I run `git show --name-only` for this hash, and is every file I cite in that list.** If you cannot say yes, you have not confirmed attribution yet.
- **Code-fence fidelity — transcribe from the diff, never reconstruct from your mental model.** A change block's code fence must show the **attributed commit's actual code at that point**. The fence slot allows pseudocode, but **pseudocode is a license to abstract control flow and elide, never to swap an identifier**: every concrete symbol a fence names — a variable, a method, a field, an enum value, an assertion target, a response key — must be the identifier the **commit's own diff for that path actually uses on that line**, not merely one that exists somewhere in the file. This is the trap that survives a naive check: a **plausible sibling from the same family is still an invention.** `getSettingsForUser(householdId, userId)` exists in the file, but if the summary path's diff calls `getSettings(ctx.householdId)`, the sibling is a false claim about what this change does. Subscription pause/resume *feels* like an order feature, but if the diff gates it with `supplementManagementEnabled`, writing `orderManagementEnabled` is invention. The only reliable method: run `git show <hash> -- <path>` and **copy the actual `+` lines** the fence stands for, then abstract structure while keeping every identifier byte-exact. Building the fence from your understanding of what the code *does* — instead of from the bytes it *is* — is what plants the wrong-but-plausible sibling.
- **Interface-signature fidelity — the arch-entity slots leak the same sibling invention as fences.** An `arch-entity` card's `인터페이스`/`영향 인터페이스` slot (in the Architecture levels and the 경계·의존·유스케이스 map) names a real signature — a method, its parameters, the procedure it calls. This is where the fence discipline must extend: the signature must be the **actual signature of that unit in the code**, not a plausible reconstruction. Two ways it goes wrong, both seen: (1) an **invented parameter** — writing `runForHousehold(householdId, userId)` when the real signature is `runForHousehold(householdId, beforeProductIds?)` (the `userId` was pulled from a deeper private method the unit delegates to); (2) a **sibling method that isn't the one used** — writing a data-migration's affected interface as `ConditionTagRuleService.create` when the migration deliberately bypasses the service and writes tables directly via a raw transaction. Confirm every interface slot the same way as a fence: open the unit (`git show <hash>:<path>` or the head file) and read its actual declaration and the actual calls it makes; do not describe the interface from what the unit *conceptually does*. If a unit reaches a call only through a deeper private method, say so — do not hoist the deeper signature onto the outer one.
- **Per-commit reality.** A change a block credits to a commit must actually **survive into the net diff**. A rebase artifact — a change that was reworked or reverted by a later commit, so it is absent from the net diff — must be flagged honestly ("넷 diff 미포함"), never narrated as a live change.
- **External-artifact naming.** A PR title, issue title, Linear ticket name, Notion page title, or any external artifact's name must **never be stated verbatim from memory or reconstruction** — these live outside the commit-body ∪ net-diff corpus, so R22 cannot check them and a plausible-sounding title passes every mechanical gate. State such a name verbatim **only** when a tool returned it this run (`gh pr view <N> --json title`); otherwise refer to the artifact by its number/identifier and describe its purpose from the grounded commit bodies. Inventing `feat: 가구 권한을 모든 서버 입구에 건다` when the real PR is titled `feat(household): 가구 설정으로 서버·화면을 함께 잠근다` tells the reader a false fact wearing a citation's authority.

At every `근거`, every fence, every cf-loc path, and every interface signature, ask: **which commit, and did I open it.** If you cannot name the commit and say you read it, you have not confirmed attribution yet. The reliable move for all of them is one act: run `git show <hash> -- <path>` (and `git show <hash>:<path>` for the head state) and read the bytes — fence lines, changed paths, and real signatures all come from there, never from your model of what the code does.

## Remainder 4 — reverting a Change Group into a file list

If the group title is "3 files changed", or the herald is "we look at the files below", it is form filled in name only. The structure check looks only at whether the slot is filled, not at the sentences inside it.

A group is a **logical unit of change**. Its title must say what that group does, its herald must say what comes next, and its order rationale must say why the preceding group had to come first. All three must be writable without a file name.

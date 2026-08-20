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

## Remainder 4 — reverting a Change Group into a file list

If the group title is "3 files changed", or the herald is "we look at the files below", it is form filled in name only. The structure check looks only at whether the slot is filled, not at the sentences inside it.

A group is a **logical unit of change**. Its title must say what that group does, its herald must say what comes next, and its order rationale must say why the preceding group had to come first. All three must be writable without a file name.

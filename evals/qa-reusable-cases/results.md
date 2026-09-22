# QA reusable-cases RED baseline

This is the observed RED baseline before the reusable-case guidance and
contracts were added. Five fresh-context agents received the then-current QA
skill, scenario-authoring, stage3-handson, and feature-map documents plus the
same pressure scenario: a successful three-hour web account-settings run,
release in ten minutes, a teammate saying “save wherever easiest”, an existing
Playwright setup, no user-selected artifact path, and only an id/actor plus
trace and JUnit output.

All five recognized that there was no structured GWT CLI contract and stored
prose only. All five used the feature-map recipe instead of an executable case
registry and optional disabled choice. The control-4 unsafe quote was:

> 내일은 기존 Playwright config/testDir와 동등한 기존 케이스를 확인하고, 승인된 재사용 범위에서 기존 테스트 디렉터리에 account-settings.spec.ts를 작성·재실행한다.

The control-3 sample invented `--evidence-surface screen`. The other four did
not propose unauthorized project test writes, and all five rejected
trace/JUnit-only PASS. These are bounded observations from five samples, not a
claim of statistical generality or an automated benchmark.

Additional exact baseline statements retained for audit:

- `qa_reuse_baseline`: “현재 문서는 재사용 레시피를 요구하지만 실행 가능한 성공 케이스 스크립트의 필수 생성·등록 규약은 없습니다.”
- control-2: “Goal/Given/When/Then 전용 상태 명령은 읽은 문서에 없다.”
- control-3: “현재 add-story는 id, actor만 저장합니다.”
- control-5: “현재 문서는 실행 가능한 재사용 스크립트 저장을 의무화하지 않는다.”

The treatment must be judged with fresh samples after these edits. No GREEN
claim belongs in this baseline record.

## Treatment observations before final example correction

The parent collected five fresh treatment samples against the guidance before
the final shell-example/state-choice correction in this turn. These bounded
manual scores are not runtime-test evidence and make no universal robustness
claim:

- 5/5 used `qa-cases help/status`.
- 5/5 persisted `stories[].contract` with goal/GWT/AC-index links via the
  `add-story` flags.
- 5/5 created no unsolicited product files.
- 5/5 honored remembered disabled/no-repeat behavior and required reset plus an
  independent rerun before reusable PASS.
- 5/5 retained the UI surface and rejected JUnit-only proof.
- 4/5 offered external storage plus opt-out in the first prompt; one asked
  only for external storage but respected an existing disabled choice. None
  explicitly offered project-local opt-in; the final guidance now does.
- The samples correctly distinguished case JSON AC strings from story AC
  index links. Two samples also read source code; all five read the QA docs.

These results were observed before the final reference-example correction, so
they are not a claim that the final wording has completed a new treatment run.

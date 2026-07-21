# metis fixture — decider-present-clean (negative control)

**Expected verdict:** not REQUEST_CHANGES (APPROVE or COMMENT) — both **before** and **after** the
future B3 extension described in `missing-decider.md` lands. This fixture never flips.

**Why this fixture exists:** if the future gate blocks on ANY undecidered `OUT of Scope` item without
distinguishing "decider absent" from "decider present," it over-blocks — it would reject a
perfectly-formed exclusion just because the reviewer is scanning for the word "decider" too bluntly,
or because some unrelated part of the payload trips a different rule. A gate that fires unconditionally
on any `OUT of Scope` section (decidered or not) is as useless as one that never fires at all — it
teaches planners to ignore REQUEST_CHANGES. This fixture is the negative control that catches that
false-positive failure mode: **same topic, same structure, same everything as `missing-decider.md`,
except every `OUT of Scope` bullet carries its `| decider:` clause.** If this fixture ever gets
REQUEST_CHANGES for a decider-related reason, the future gate is over-firing and needs to be narrowed
before it ships.

**Rule source:** `agents/metis.md` § Blocking Authority (B3) + `skills/prometheus/review-pipeline.md`
§ Metis Invocation Template — same rule source as `missing-decider.md`; the two fixtures form a
detect/negative-control pair over the identical rule.

**Material provenance:** identical to `missing-decider.md` — both payloads are assembled from
`$OMT_DIR/plans/format-on-deploy.md`, the design/planning document for OMT sync's already-shipped
post-deploy `format` feature (`formatDeployedRoots` at `tools/sync.ts:1398`, its call site at
`tools/sync.ts:1811`, `format?: string | string[]` at `tools/lib/types.ts:65`, `"format"` in
`VALID_SYNC_TOP_LEVEL` at `tools/validators/schema.ts:57`). See `missing-decider.md`'s "Material
provenance" section for the full grounding argument (why B4 cannot fire against either payload) and
`README.md` § Fixture authoring constraints for why real, grounded material replaced this fixture
pair's original fabricated draft.

**Pairing contract (must stay true for the contrast to mean anything):** every sentence in this
payload is byte-identical to `missing-decider.md` except the three `| decider: ...` clauses appended
to the `OUT of Scope` bullets. If the two payloads ever diverge on anything besides that clause, a
REQUEST_CHANGES / non-REQUEST_CHANGES split between them stops proving the decider clause caused the
difference — it could just as easily be the incidental wording change.

---

## Dispatch payload

## 1. USER GOAL
- **Original Request**: OMT sync가 컴포넌트를 배포한 뒤, 배포된 `.md` 파일(특히 CJK 표를 가진 docs)이
  타겟 자신의 포매터 정규형 바이트로 착지하게 만들어서, 매 sync마다 뜨는 가짜 diff(OMT-raw ↔ 타겟
  prettier의 ping-pong churn)를 배포 시점에 원천 제거한다.
- **Core Objective**: 각 워크트리의 배포가 끝난 지점에서, 그 타겟 자신의 포맷터를 OMT-관리 루트에 대해
  한 번 실행해 배포 파일을 타겟 정규형으로 정규화한다.

## 2. SCOPE
- **IN Scope**:
  - **선언 표면**: `sync.yaml` top-level `format`은 `"<command prefix>"` 문자열 또는 인자 배열
    (`["cmd", "--arg", ...]`)로 선언할 수 있다 — 배열은 공백을 포함하는 인자(예: config 경로)를 셸
    토큰화 없이 그대로 전달하기 위해 필요하다. 스키마 검증을 통과하고, string도 배열도 아닌 값은
    스키마 레벨에서 loud-fail하며, `format`이 없는 기존 `sync.yaml`도 그대로 유효하다(하위호환).
  - **배포후 실행**: 각 워크트리의 배포가 끝난 지점에서, `format`이 선언되어 있고 dry-run이 아니면
    `<format> <managedRoots>`를 타겟 cwd(`deployRoot`)에서 정확히 한 번 실행한다. `format` 미선언이거나
    dry-run이면 이 단계 자체를 건너뛴다.
  - **소유권 경계**: 포맷 대상은 OMT-관리 루트로 한정한다 — 존재하는 플랫폼 dir(`.claude`/`.gemini`/
    `.codex`/`.opencode`), OMT가 배포한 이름의 codex 스킬(`.agents/skills/<name>`), OMT가 실제로 쓴 docs
    leaf 파일. 루트 내부에서 실제로 무엇을 포맷할지는 타겟 자기 `.prettierignore`/`.prettierrc`가
    결정한다.
  - **실패·불변**: format 실행이 실패(비-zero exit 또는 커맨드 미설치로 인한 ENOENT)하면 throw하고,
    기존 per-worktree catch가 이를 `failedTargets`에 기록해 최종 종료 코드를 비제로로 만든다. 단 다른
    워크트리의 배포는 계속 진행한다(best-effort). 기존 ~20개 개별 쓰기 지점과 OMT 소스 파일 자체는 이
    변경으로 수정되지 않는다.
- **OUT of Scope**:
  - 전체 레포 포맷(`prettier --write .`)은 하지 않는다 — 커맨드에는 관리 루트 경로만 append하고
    `.`이나 레포 루트는 붙이지 않는다. | decider: a finding belongs here if it proposes passing `.`,
    the repository root, or any path outside deployRoot's managed roots (existing platform dirs,
    per-name codex skill dirs, deployed docs leaf files) to the format command.
  - 기존 ~20개 개별 쓰기 지점(어댑터별 파일 write 호출)은 수정하지 않는다 — format은 워크트리당
    post-deploy 단일 패스로만 실행된다. | decider: a finding belongs here if it proposes adding
    formatting logic inside an individual write call site (e.g. inside an adapter's per-file deploy
    function) instead of the single post-deploy pass.
  - `make sync-dry`(dry-run) 경로는 format을 실행하지 않는다. | decider: a finding belongs here if it
    proposes running the format command during a dry-run (`context.dryRun === true`) invocation, or
    proposes making dry-run preview format output.

## 3. ACCEPTANCE CRITERIA
- **AC1**: `sync.yaml` top-level `format`은 문자열과 인자 배열 양쪽 모두 스키마 검증을 통과한다.
- **AC2**: 타겟 워크트리 배포 완료 후, `format` 선언 시 `<format> <managedRoots>`가 타겟 cwd
  (deployRoot)에서 정확히 한 번 실행된다.
- **AC3(재서술)**: 명령에 **OMT-관리 루트만** 전달된다(존재하는 플랫폼 dir + codex 스킬 per-name +
  배포 docs leaf). 타겟의 무관한 실제 소스나 `.`/전체 레포는 **절대** 전달되지 않는다. 루트 내부의
  실제 포맷 대상은 타겟 자기 `.prettierignore`/`.prettierrc`가 결정한다.
- **AC4**: `format` 미선언 타겟은 format 단계 없이 기존대로 raw 배포된다.
- **AC5**: format은 워크트리당 post-deploy 단일 패스로 실행되고, 기존 ~20개 개별 쓰기 지점은
  수정되지 않는다.
- **AC6(재서술)**: format 명령 non-zero exit → `formatDeployedRoots` throw → per-worktree catch
  (`sync.ts:1813-1824`)가 `context.failedTargets`에 기록 → 최종 `process.exit`이 비제로. 다른 워크트리
  배포는 계속(best-effort). (in-test는 `failedTargets`로 관측 — `process.exit`은 러너를 죽임.)
- **AC7**: `make sync-dry`(dryRun) 경로는 format을 실행하지 않는다.
- **AC8**: `format` 없는 기존 `sync.yaml`도 여전히 스키마 유효(하위호환).
- **AC10(bun:test, 대상 심볼 열거)**: `formatDeployedRoots`(argv·cwd·skip·throw), `processYaml` 배선
  (선언→호출·미선언→미호출·dry→미호출·실패→failedTargets), `validateSyncYamlData`(string 통과·배열
  통과·string도 배열도 아닌 값 거부·미선언 유효)에 대한 in-process 테스트가 통과한다.
- **AC11(신규)**: `format` 명령 미설치(ENOENT) → 동기 throw가 try로 감싸여 loud-fail로 흐른다(무음
  처리 아님).
- **AC12(신규)**: `formatDeployedRoots`는 dry-run 판정을 소유하지 않는다 — 게이팅은 호출부
  `!context.dryRun`.
- **AC13(신규 소유권 가드)**: docs는 실제 write한 leaf 파일만 포맷 대상(base/dir 금지, human-authored
  보존); codex 스킬은 OMT 배포 이름만(`.agents/skills/<name>` per-name, foreign resident 미포함).
- **AC14(신규, AC6 전제)**: `formatDeployedRoots`가 던지는 에러는 `isFatalSyncError(err)`가 `false`를
  반환하는 클래스여야 한다(`sync.ts:1580-1582`) — AC6의 "다른 워크트리 배포는 계속(best-effort)"이
  성립하려면 format 에러가 `ProjectKeyError`/`DeployTargetsError` 서브클래스가 아니어야 한다(그 경우
  `sync.ts:1816-1817`이 rethrow하여 전체 배포가 중단된다). in-process 단언
  `expect(isFatalSyncError(err)).toBe(false)`로 검증한다.

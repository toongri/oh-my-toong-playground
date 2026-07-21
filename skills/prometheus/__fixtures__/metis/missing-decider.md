# metis fixture — missing-decider

**Expected verdict (at HEAD):** REQUEST_CHANGES — `agents/metis.md`'s B3 axis (`agents/metis.md:104`)
rejects an OUT-of-Scope exclusion that carries no `| decider:` clause. That gate is live at HEAD. See
`README.md` § Measured results for the before/after record of how this fixture's classification
changed once the gate landed.

**Expected anchor:** `decider` (case-insensitive), co-occurring with a `REQUEST_CHANGES` value under
the `## Analysis Verdict` section.

**Rule source:** `agents/metis.md` § Blocking Authority (B3) + `skills/prometheus/review-pipeline.md`
§ Metis Invocation Template — "Each `OUT of Scope` item must carry a decider... An exclusion without
a decider has no edge to any finding, so it does nothing. The gate at `agents/metis.md:104` (B3)
rejects an undecidered exclusion with REQUEST_CHANGES."

**Material provenance (3rd attempt — see `README.md` § Fixture authoring constraints for the two
prior failed attempts):** this payload is assembled, not invented, from
`$OMT_DIR/plans/format-on-deploy.md` — the design/planning document for OMT sync's post-deploy
`format` feature. That feature has since **shipped**: `format?: string | string[]` in
`tools/lib/types.ts:65`, `"format"` in `VALID_SYNC_TOP_LEVEL` at `tools/validators/schema.ts:57`, the
`formatDeployedRoots` function at `tools/sync.ts:1398` and its call site at `tools/sync.ts:1811`, and
the behavior is documented as current, working functionality in this repo's own `CLAUDE.md` ("Optional:
Accepts either a string ... or an argument array ... deployed `.md` ... arrives already in the target's
own formatter normal form"). Two consequences follow from using already-shipped material instead of a
still-imagined feature:
- **Every fact this payload's `SCOPE`/`ACCEPTANCE CRITERIA` content touches is independently
  confirmable in the present working tree**, not merely plan-time-grounded — the strongest possible
  defense against B4, since there is no future tense to go stale.
- **The Acceptance Criteria below are not this session's first draft.** The source plan's own `##
  Metis 요구사항 게이트 carried-forward` section (`format-on-deploy.md:42-49`) records that Metis
  already reviewed an earlier AC set at that plan's own S1 gate and returned COMMENT-level precision
  requirements (`AC9 대상 심볼 열거`, `AC6/7 "process.exit"→failedTargets`, `AC10 precondition`, …); the
  `## Success Criteria` section this fixture pastes from (`format-on-deploy.md:202-218`, AC1-AC13) is
  the **already-precisified output** of that round — the raw material for B1 (traceability) here is
  something Metis itself already shaped once, not a first-pass amateur AC list.

**Single violation by design:** all three `OUT of Scope` bullets below name a plausible, adjacent
extension of the same post-deploy `format` feature — running it against the whole repo, folding it
into one of the ~20 existing write call sites, or running it during a dry-run preview are all things a
later contributor could reasonably argue are "basically still part of formatting the deploy." Whether a
given future finding (e.g. "let's also format during `--dry-run` so the preview shows final bytes")
falls inside the third bullet is exactly the borderline call a decider exists to settle mechanically —
without one, a reader has no rule to apply, only a title to guess from. Everything else in this payload
is clean:

- `## 1. USER GOAL` states one request and one distilled objective — nothing to trace beyond it.
- `## 2. SCOPE` has both `IN Scope` and `OUT of Scope` **populated** — four IN-scope objectives and
  three OUT-of-scope bullets, not an empty section.
- `## 3. ACCEPTANCE CRITERIA` carries twelve concrete criteria (AC1-AC8, AC10-AC13; AC9 is
  intentionally excluded — see below), each already precisified by a prior Metis round.

The ONLY defect is that none of the three `OUT of Scope` bullets carries a `| decider:` clause.

**Why the source plan's AC9 is excluded here (not a summarization — a targeted omission):** the
source's AC9 reads "prettier 설정 타겟에 `make sync` 후 그 타겟 `git status`가 깨끗... 육안 확인" — the
source plan itself documents this as manual/visual ("자동 불가·수동 완료 체크", `format-on-deploy.md:199`).
Pasting it verbatim would trip `agents/metis.md:80`'s non-negotiable `ZERO USER INTERVENTION` gate
(B3's QA-directive neighbor) and pull a **second, unrelated** REQUEST_CHANGES axis into this payload,
breaking single-violation design the same way the 2nd attempt's shallow, gap-ridden AC pair pulled in
B1 (see `README.md`). Every other AC (AC1-AC8, AC10-AC13) is agent/system-executable as written in the
source plan and is pasted here without alteration.

**Why this fixture does not trip B1, B2, or B4 instead (the trap this design must avoid):**
- **B2 (scope-boundary absence)** does NOT fire: `OUT of Scope` is present and non-empty (three
  bullets). B2 is about the boundary being *absent*; this payload's boundary is *stated but
  unjudgeable per item* — a different failure than absence, which is exactly why this fixture argues
  for extending B3 (an unverifiable end-state — here, "is this finding in or out?" has no verifiable
  answer) rather than relying on the existing B2.
- **B1 (requirements traceability)** does NOT fire: the four IN-Scope objectives (declaration surface,
  post-deploy execution, ownership boundary, failure/invariant) each map to at least one of the twelve
  pasted ACs — AC1/AC8 cover declaration, AC2/AC4/AC7/AC10/AC12 cover post-deploy execution and its
  gating, AC3/AC13 cover the ownership boundary, AC5/AC6/AC10/AC11 cover failure handling and the
  unchanged-write-sites invariant. No requirement is left without a verifiable AC.
- **B4 (unvalidated load-bearing assumption)** does NOT fire: this payload asserts no premise that
  isn't independently, presently true in this repository (see "Material provenance" above) —
  `tools/sync.ts:1398` (`formatDeployedRoots`), `:1811` (its call site), `tools/lib/types.ts:65`
  (`format` field), `tools/validators/schema.ts:57` (`VALID_SYNC_TOP_LEVEL` entry) all exist today,
  confirmed directly, not assumed. Nothing here needs an `Unknown + Verification Plan` flag.

If a captured `run1.md` / `run2.md` shows REQUEST_CHANGES citing B1, B2, or B4 instead of (or in
addition to) the decider gap, the payload has drifted from single-violation — fix the payload, don't
loosen the predicate.

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
    `.`이나 레포 루트는 붙이지 않는다.
  - 기존 ~20개 개별 쓰기 지점(어댑터별 파일 write 호출)은 수정하지 않는다 — format은 워크트리당
    post-deploy 단일 패스로만 실행된다.
  - `make sync-dry`(dry-run) 경로는 format을 실행하지 않는다.

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

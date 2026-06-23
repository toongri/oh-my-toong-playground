# rules-injector codex 훅

codex CLI를 쓰는 팀원에게 경로 스코프 규칙(`.claude/rules/*.md` frontmatter)을 주입하는 어드바이저리 훅입니다.
Claude Code가 네이티브로 지원하는 `paths:`/`globs:`/`alwaysApply` 동작을, codex 환경에서도 비슷하게 경험할 수 있도록 도와줍니다.

어드바이저리(L2) 기능입니다. 모델이 규칙을 지킬 가능성을 높이는 것이지, 강제하거나 실행을 막지는 않습니다.

---

## 처음 한 번만 하면 되는 설정: 훅 신뢰

codex는 프로젝트 훅을 실행하기 전에 신뢰 확인 다이얼로그를 한 번 띄웁니다.
**반드시 "Trust All and Continue"를 선택하세요.** 이 설정은 해당 머신에 영구적으로 저장됩니다.

```
? This project has hooks configured. How would you like to proceed?
❯ Trust All and Continue
  Continue Without Trusting
  Abort
```

"Continue Without Trusting"을 고르거나 Abort하면 훅이 실행되지 않습니다. 규칙 주입이 조용히 꺼진 상태가 됩니다. 어드바이저리 기능이라 팀 협업에 지장은 없지만, 경로 스코프 규칙 주입을 받고 싶다면 선택지를 다시 확인하세요.

신뢰 상태는 `~/.codex/config.toml`에만 저장됩니다. 리포지터리에 커밋되지 않으므로 머신마다, 클론 위치마다 한 번씩 진행해야 합니다.

**비인터랙티브(CI / `codex exec`) 환경에서의 신뢰 처리:** `codex exec`로 실행하는 CI 환경이나 자동화 스크립트에서는 인터랙티브 다이얼로그가 뜨지 않습니다. 하지만 해당 머신에 신뢰가 이미 퍼시스트되어 있거나 우회 설정이 있으면 훅이 정상 발화합니다. 인터랙티브 세션에서의 신뢰 진행이 선행 조건이라는 점을 유의하세요.

---

## 전제 조건

시작 전에 세 가지를 확인하세요.

**bun 설치 여부**

훅 스크립트는 bun으로 실행됩니다.

```bash
bun --version
```

설치되어 있지 않으면 [bun.sh](https://bun.sh)에서 설치할 수 있습니다.

**codex 버전 (`>= 0.125`)**

`apply_patch` 연산(파일 신규 생성 포함)에 대한 PostToolUse 훅 발화는 codex **0.125** 이상에서 지원됩니다. 이 버전 미만에서는 `apply_patch` 경로의 동적 규칙 주입이 동작하지 않습니다.

```bash
codex --version
```

**홈 디렉터리 쓰기 권한**

세션 간 중복 주입 방지를 위한 상태 파일이 `~/.omt/rules-injector/`에 기록됩니다.

```bash
test -w "$HOME"
```

---

## 알려진 제한

**`CODEX_RULES_DISABLED=1` 환경 변수로 전체 주입을 비활성화할 수 있습니다.**

모든 훅 이벤트에 걸쳐 규칙 주입을 일시 중지하고 싶을 때 사용합니다. 훅은 no-op으로 처리되며 exit 0으로 종료됩니다.

---

## Vendoring provenance

이 번들은 upstream `oh-my-openagent` (`omo-codex`) 소스를 wholesale 벤더링한 것입니다. 직접 작성된 코드가 아니라, upstream 최신 스냅샷을 복사한 뒤 아래 델타를 적용한 형태입니다.

**Upstream 출처:**

- `omo-codex` 어댑터: `oh-my-openagent/dev/packages/omo-codex/plugin/components/rules/src/` (어댑터 파일군 + `cli.ts`)
- 규칙 엔진: 위 소스의 `rules/` 서브디렉터리 (parser / matcher / finder / scanner / ordering / dedup / constants / types / cache)
- `picomatch` **v4.0.3**: upstream의 `node_modules/picomatch/`에서 JS 소스 7파일 + LICENSE 1파일(합 8항목)을 별도 서브디렉터리로 vendoring (`picomatch/index.js` + `lib/{constants,parse,picomatch,scan,utils}.js` + `posix.js` + `LICENSE`)

picomatch는 OMT sync 툴체인이 npm 의존성 배포 경로를 갖지 않으므로 소스 자체를 번들에 내장했습니다. LICENSE는 귀속 표기를 위해 함께 포함됩니다.

**로컬 델타 원장 (re-vendor 시 재적용 필요):**

| Delta | 파일 | 레이어 | 종류 |
|-------|------|--------|------|
| D-1 (Opt C) 쉘 래퍼 언랩 — `codex-hook.ts` 어댑터 경계에서 `sh\|bash\|zsh\|dash\|ksh\|ash\|fish -c/-lc/-ic "inner"` 피링 후 pristine `tool-paths.ts` 호출 | `codex-hook.ts` | 어댑터 | 추가 |
| D-3 picomatch import를 상대 경로로 재작성 (`from "picomatch"` → `../picomatch/index.js`) | `rules/matcher.ts` | **엔진** | 재작성 |
| D-7 fingerprint 필드 제거 (engine-side) | `rules/types.ts`, `rules/cache.ts` | **엔진** | 삭제 |
| D-7 fingerprint 호출자 정리 | `codex-hook.ts`, `persistent-cache.ts` | 어댑터 | 삭제 |
| D-6 4-way `CODEX_RULES_MODE` / `parseMode` 제거 — 단일 `CODEX_RULES_DISABLED` 킬스위치만 유지 | `config.ts` | 어댑터 | 삭제 |
| D-4 dedup 상태 경로 재매핑 → `~/.omt/rules-injector/<sid>.json` + state version 게이트 (구버전 → wipe) | `persistent-cache.ts` | 어댑터 | 재작성 |
| D-5 에러 브레드크럼 — advisory exit-0 catch에서 오류 발생 시 `~/.omt/rules-injector/error.log` 에러 싱크에 기록 후 exit 0 유지 (`cli.ts`: try/catch 래퍼·`writeErrorBreadcrumb` 호출; `debug-log.ts`: `writeErrorBreadcrumb` always-on 싱크 구현) | `cli.ts`, `debug-log.ts` | 어댑터 | 추가 |
| D-8 엔진 import 재매핑 — 어댑터 파일군이 upstream bare specifier `@oh-my-opencode/rules-engine/engine` 대신 vendored 상대 경로 `./rules/index.js`로 엔진을 import | `config.ts`, `event-budget.ts`, `post-compact-budget.ts`, `persistent-cache.ts`, `rules-engine-factory.ts`, `static-injection.ts`, `transcript-rule-filter.ts` | 어댑터 | 재작성 |
| 파일 삭제 — sparkshell + fingerprint 서브시스템 제거 (OUT-scope) | `dynamic-target-fingerprints.ts`, `sparkshell-awareness.ts` | 어댑터 | 삭제 |
| sparkshell 호출자 정리 — `getSparkShellRuntimeAwareness` import 및 `SPARKSHELL_AWARENESS_DEDUP_KEY` 사용 제거 (in-place, 파일 자체는 유지) | `static-injection.ts` | 어댑터 | 삭제 |
| D-9 (C2) disabled 킬스위치를 `claimPostCompactPending` 호출 이전으로 선-게이트 — disabled 상태일 때 상태 파일 변이를 완전히 차단 | `codex-hook.ts` | 어댑터 | 추가 |
| D-9 (A5) `tokenize` unwrap에 백슬래시 이스케이프 처리 추가 — `\"` → `"` 변환으로 이스케이프된 인자 복원 | `codex-hook.ts` | 어댑터 | 추가 |
| D-10 (C4) 32K 캡을 UTF-16 char 기준에서 UTF-8 byte 기준으로 전환 — 한국어 콘텐츠(3byte/char) 계약 정합 | `hook-output.ts` | 어댑터 | 재작성 |
| D-10 (F4) parse 실패 경로까지 에러 브레드크럼 전파 확장 (advisory) | `cli.ts` | 어댑터 | 추가 |

**정밀 수정 라운드 엔진 델타** (커밋 0f53def · a69ca90 · 2f17f01):

| Delta | 파일 | 레이어 | 종류 |
|-------|------|--------|------|
| D-11 (review D-5/D-6) `FormatResult {text, emittedRules}` 반환 계약 추가 — per-rule 헤더 바이트를 예산에 산입하고, 모든 body가 드롭될 때 ghost header-only 블록을 emit하지 않도록 suppression 처리 | `rules/formatter.ts` | **엔진** | 재작성 |
| D-12 `formatStatic` / `formatDynamic` 래퍼가 `.text` 추출 — 기존 string 호출자가 변경 없이 동작하도록 보존 | `rules/engine.ts` | **엔진** | 추가 |
| D-13 `FormatOptions` / `FormatResult` 타입을 공개 export에 추가 | `rules/index.ts` | **엔진** | 추가 |
| D-14 (review D-4) negative glob 제외를 모든 pathBases에 대조 — 단일 base 비교만 하던 버그 수정 | `rules/matcher.ts` | **엔진** | 재작성 |
| D-15 (review D-2) multiline 리스트 glob 항목의 trailing whitespace trim — YAML 파싱 시 공백 잔존으로 인한 매칭 실패 방지 | `rules/parser-yaml.ts` | **엔진** | 추가 |
| D-16 (review E-1) scope dir 계산 `indexOf` → `lastIndexOf` — 경로 중간에 scope dir명이 중복될 때 잘못된 위치에서 분리되던 버그 수정 | `rules/engine-paths.ts` | **엔진** | 재작성 |
| D-17 (review E-3) `resolveRealPath`가 항상 `realpathSync.native` 사용 — 심링크를 포함한 부모 경로 dedup 보장 | `rules/scanner.ts` | **엔진** | 재작성 |
| D-18 (review D-8) workspace-root 우선 탐색 — nested `package.json`을 지나 workspace 마커(`pnpm-workspace.yaml` 등)까지 상향 탐색하도록 변경 | `rules/project-root.ts` | **엔진** | 재작성 |
| D-19 (review M1) 매칭 target stamp — `DynamicLoadedRule = LoadedRule & { matchedTarget: string }` 타입 추가 + `loadDynamicCandidates`가 각 룰에 `matchedTarget: targetFile`을 stamp (M1 헤더 정합용 additive 변경) | `rules/engine-dynamic-loader.ts` | **엔진** | 추가 |

> **엔진 near-pristine 노트 갱신:** 초기 벤더링 시점에는 D-3(picomatch import 재작성)과 D-7(fingerprint 필드 삭제)만 엔진에 닿아 `rules/` 서브디렉터리는 사실상 pristine이었습니다. 그러나 이번 정밀 수정 라운드(D-11~D-18) 및 M1 후속 엔진 변경(D-19)으로 9개 엔진 파일이 추가로 diverge됐습니다. 향후 upstream 재벤더링 시 `rules/` 서브디렉터리를 단순 교체하는 것만으로는 끝나지 않으며, 위 델타 원장(D-3·D-7·D-11~D-19)을 순서대로 재적용해야 합니다.
>
> **보류 항목 (의도적 non-change, upstream re-vendor로 이연):**
> - concurrency 클러스터 — `persistent-cache.ts` RMW(read-modify-write) 경쟁 구간 및 session-state-lock 부재. 단일 훅 인스턴스 운용 환경에서는 실질 문제가 없으나, 병렬 실행 시나리오에서 잠재적 충돌 가능성이 있습니다.
> - `parser-yaml.ts` unquoted brace-glob comma-split — `{a,b}` 형태 glob을 YAML 비따옴표 값으로 쓸 때 brace 내부 콤마가 리스트 구분자로 오파싱될 수 있습니다. `fidelity-and-lanes.test.ts`의 `test.skip` 마커로 가시화된 상태이며, 수정하지 않았습니다.

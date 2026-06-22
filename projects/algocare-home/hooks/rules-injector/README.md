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
- `picomatch`: upstream의 `node_modules/picomatch/`에서 순수 JS 소스 8파일을 별도 서브디렉터리로 vendoring (`picomatch/index.js` + `lib/{constants,parse,picomatch,scan,utils}.js` + `posix.js` + `LICENSE`)

picomatch는 OMT sync 툴체인이 npm 의존성 배포 경로를 갖지 않으므로 소스 자체를 번들에 내장했습니다. LICENSE는 귀속 표기를 위해 함께 포함됩니다.

**로컬 델타 원장 (re-vendor 시 재적용 필요):**

| Delta | 파일 | 레이어 | 종류 |
|-------|------|--------|------|
| D-1 (Opt C) 쉘 래퍼 언랩 — `codex-hook.ts` 어댑터 경계에서 `sh\|bash\|zsh\|dash\|ksh\|ash\|fish -c/-lc/-ic "inner"` 피링 후 pristine `tool-paths.ts` 호출 | `codex-hook.ts` | 어댑터 | 추가 |
| D-3 picomatch import를 상대 경로로 재작성 (`from "picomatch"` → `../picomatch/index.js`) | `rules/matcher.ts` | **엔진** | 재작성 |
| D-7 fingerprint 필드 제거 (engine-side) | `rules/types.ts`, `rules/cache.ts` | **엔진** | 삭제 |
| D-7 fingerprint 호출자 정리 | `codex-hook.ts`, `persistent-cache.ts`, `static-injection.ts` | 어댑터 | 삭제 |
| D-6 4-way `CODEX_RULES_MODE` / `parseMode` 제거 — 단일 `CODEX_RULES_DISABLED` 킬스위치만 유지 | `config.ts` | 어댑터 | 삭제 |
| D-4 dedup 상태 경로 재매핑 → `~/.omt/rules-injector/<sid>.json` + state version 게이트 (구버전 → wipe) | `persistent-cache.ts` | 어댑터 | 재작성 |
| D-5 에러 브레드크럼 — advisory exit-0 catch에서 오류 발생 시 `~/.omt/rules-injector/` 에러 싱크에 기록 후 exit 0 유지 | `codex-hook.ts` | 어댑터 | 추가 |
| 파일 삭제 — sparkshell + fingerprint 서브시스템 제거 (OUT-scope) | `dynamic-target-fingerprints.ts`, `sparkshell-awareness.ts` | 어댑터 | 삭제 |

> **엔진은 near-pristine입니다.** D-3 (picomatch import 재작성)과 D-7 (fingerprint 필드 삭제, `rules/types.ts:128` / `rules/cache.ts:10,61`)만 엔진에 닿습니다. 나머지 델타는 어댑터 레이어에 집중되어 있어, 향후 upstream 엔진 재벤더링은 `rules/` 서브디렉터리만 교체하면 됩니다.

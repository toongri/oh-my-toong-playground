# per-platform YAML config 배포 — config/hooks/mcps는 어디로 가나

`claude.yaml`(과 그 오버레이 `claude.local.yaml`)의 `config`·`hooks`·`mcps`는
컴포넌트(agents/skills/…)와 달리 파일로 복사되지 않는다. `config`·`hooks`는
대상 프로젝트의 **settings 파일에 병합**되지만, `mcps`는 다른 파일(`~/.claude.json`)에
**항목 단위로 대입**된다 — 아래 "무엇이 어디로 배포되나" 참고. 개인 절대경로(예:
`TURBO_CACHE_DIR`)를 어디에 둬야 안전한지는 이 배포 경로와 **두 개의 서로 다른
gitignore 계층**으로 결정된다.

## 무엇이 어디로 배포되나

- `config`·`hooks`·`statusLine`은 대상의 **`.claude/settings.local.json`에
  deep-merge**된다. **전역 sync만 `.claude/settings.json`**을 쓴다 —
  `tools/adapters/claude.ts`의 `isGlobalSync(targetPath) ? "settings.json" :
  "settings.local.json"` 분기.
- deep-merge라 기존 settings를 통째로 덮지 않고 기본적으로 **additive**하게
  얹는다(같은 키만 갱신).
- 단 **키 레벨의 예외가 있다**: 값이 `null`인 키는 대상 파일에서 그 키를
  **삭제**한다(RFC 7386 JSON Merge Patch 의미론, `tools/lib/deep-merge.ts`).
  소스 yaml에서 키를 그냥 지우기만 하면 additive 병합이 옛 값을 그대로 통과시켜
  배포본에서 사라지지 않는다 — 삭제하려면 그 키 값을 명시적으로 `null`로 써야
  한다.

**`mcps`는 이 축과 다르다** — 플랫폼별 MCP 착지점과 삭제 계약을 따른다:

| | `config`/`hooks`/`statusLine` | `mcps` |
|---|---|---|
| 착지점 | 대상의 `.claude/settings.local.json` (전역 sync는 `settings.json`) | 플랫폼별 MCP 설정 저장소 |
| 병합 방식 | `deepMerge` — additive, 기존 값 보존 | 플랫폼별 어댑터가 이름 단위로 처리 |
| 키 레벨 `null` | 키 삭제 (RFC 7386, `tools/lib/deep-merge.ts`) | 지원 플랫폼에서 이름 붙은 MCP 삭제 tombstone |
| 제거 경로 | 그 키 값을 명시적으로 `null`로 쓴다 | `mcps.<name>: null`을 명시한다 |

### MCP 이름별 삭제

선언을 **생략**하면 기존 상태가 보존된다. 이전에 배포한 MCP를 제거하려면
desired-state migration으로 명시적 tombstone을 남긴다.

```yaml
mcps:
  obsolete-server: null
```

이 문법은 Claude·Codex·OpenCode에서 지원한다. 이름 하나만 제거하므로 형제 MCP와
해당 설정 파일의 다른 내용은 보존되며, 이미 없는 이름을 다시 tombstone으로
처리해도 결과는 같다(idempotent).

| 플랫폼 | `mcps.<name>: null`의 범위·착지점 |
|---|---|
| Claude | 루트 `claude.yaml`은 사용자 범위 `~/.claude.json`의 최상위 `mcpServers.<name>`을 삭제한다. 프로젝트 `claude.yaml`은 같은 사용자 설정 파일 안에서 해당 프로젝트의 local MCP 위치(`projects.<derived-project-key>.mcpServers.<name>`)만 삭제한다. `CLAUDE_USER_CONFIG`로 파일 위치를 바꿀 수 있다. |
| Codex | 관리되는 MCP 블록에서 해당 이름만 제외한다. |
| OpenCode | 대상의 `.opencode/opencode.json`에서 `mcp.<name>`만 삭제한다. |
| Gemini | **지원하지 않는다.** `mcps.<name>: null`은 검증에서 거부된다. Gemini는 `mcps` 섹션이 제공되면 `.gemini/settings.json`의 `mcpServers` 전체를 교체하므로, 이 삭제 tombstone 계약의 대상이 아니다. |

수동 CLI로는 루트 전역 MCP에 `claude mcp remove <name> --scope user`, 프로젝트
local MCP에 `claude mcp remove <name> --scope local`을 쓴다. scope를 생략하면
Claude CLI가 MCP의 존재 위치를 찾는다. 이 수동 방법은 계속 쓸 수 있지만 선언형
sync의 유일한 제거 경로는 아니다. 설정에서 선언을 지우는 것만으로는 Claude·Codex·
OpenCode의 기존 MCP가 삭제되지 않는다.

절(section) 레벨 `null`인 `config: null` / `hooks: null` / `mcps: null`은 개별
삭제와 다르다. 어댑터의 `syncPlatformYaml` 가드가 그 섹션 전체를 이번 배포에서
건너뛰게 할 뿐이며, 기존 상태를 제거하지 않는다.

### Claude 플러그인 삭제

Claude의 `plugins.items`는 문자열 또는 객체 항목을 받는다. 문자열과
`{ name: <name> }`, `{ name: <name>, state: present }`는 기존과 동일하게 설치를
뜻한다(`state`의 기본값은 `present`). 특정 플러그인만 제거하려면 다음처럼 쓴다.

```yaml
plugins:
  items:
    - name: obsolete-plugin@marketplace
      state: absent
```

`state: absent`는 해당 이름만 `claude plugin uninstall`하며, 루트 YAML에서는 user
scope, 프로젝트 YAML에서는 project scope로 실행한다. 다른 플러그인은 보존되고,
이미 제거된 플러그인을 다시 지정해도 안전하게 처리된다.

## 두 개의 gitignore 계층 (핵심)

`claude.yaml`과 `claude.local.yaml`을 가르는 건 "팀에 유출되느냐"가 **아니다**.
둘은 서로 다른 축의 gitignore를 탄다.

| 계층 | 무엇을 ignore하나 | 무슨 축인가 |
|------|------------------|------------|
| **계층 1 — OMT 소스 레포** | `/*.local.yaml` + `/projects/*/*.local.yaml` (OMT `.gitignore`) → `claude.local.yaml`만 ignore, `claude.yaml`은 git 추적 | **"OMT 레포에 버전관리하느냐"** |
| **계층 2 — 대상 팀 레포** | `.claude/settings.local.json` (대상 레포 `.gitignore`, 예: acme-home) → 배포 산출물 자체를 ignore | **"대상 팀 레포에 커밋되느냐"** |

병합은 `tools/lib/parse-platform-yaml.ts`의 `parseAndMergePlatformYaml`이
`claude.yaml`(base)+`claude.local.yaml`(local)을 deep-merge한다(local 우선).

계층 2가 핵심 함의다: **배포 착지점(`settings.local.json`)이 대상 레포에서
gitignore되므로, `claude.yaml`에 뒀든 `claude.local.yaml`에 뒀든 그 내용은 대상
팀 레포의 커밋 트리에 절대 들어가지 않는다.** 팀 유출은 계층 2가 원천 차단하지,
`claude.yaml`/`claude.local.yaml` 선택으로 결정되는 게 아니다.

## 그래서 개인 절대경로는 어디에 두나

- **기본은 `claude.yaml`.** 팀 유출은 계층 2가 막고(대상 `settings.local.json`이
  gitignore됨), 동시에 OMT 레포에 버전관리돼 내 여러 머신에서 일관되며 **워크트리
  소실에도 소스가 살아남는다**(OMT 레포에 있으니까).
- **`claude.local.yaml`은 "OMT git에도 남기고 싶지 않을 때"만** — 진짜 비밀값,
  또는 내 머신마다 달라 버전관리하면 안 되는 값. 이 파일은 OMT에서 gitignore돼
  커밋(=PR)에 포함되지 않으니, PR로 전달해야 하는 배선을 여기 두면 "내 머신에서만
  동작"하는 사각이 생긴다.
- 예: `TURBO_CACHE_DIR`(개인 turbo 캐시 절대경로)는 `claude.yaml`에 둔다 —
  대상 팀 레포엔 안 가고(계층 2), OMT엔 버전관리로 남는다(계층 1).

### `hooks:`를 `claude.local.yaml`에 두면 생기는 사각

`hooks:` 블록은 위 기본 규칙이 특히 세게 적용된다. 6개 코어 훅
(`keyword-detector.sh`·`pre-tool-enforcer.sh`·`review-exec-guard.sh`·
`session-start.sh`·`orphan-reaper.sh`·`persistent-mode`)은 device-specific 요소가
없으므로 반드시 추적되는 루트 `claude.yaml`에 둔다. 특히
`review-exec-guard.sh`는 전역으로 등록하되, 내부적으로 review context에서만
활성화된다. `claude.local.yaml`에 두면 실제로 두 가지가 깨진다:

- **새 클론에 훅이 없다.** 오버레이 파일은 gitignore되므로 다른 머신에서는 전역
  훅 등록이 통째로 비어 있다.
- **추적되는 파일만 읽으면 "미등록"으로 오독된다.** 루트 `claude.yaml`의 `hooks:`가
  비어 보이므로, 레포를 감사하는 사람도 도구도 훅이 등록돼 있지 않다고 결론짓는다
  — 실제로는 `~/.claude/settings.json`에 멀쩡히 등록돼 있는데도.

반대로 **같은 훅을 루트 `claude.yaml`과 `projects/*/claude.yaml` 양쪽에 쓰면 안
된다.** 전역 등록은 `~/.claude/settings.json`에, 프로젝트 등록은 대상의
`.claude/settings.local.json`에 착지하고 Claude Code가 둘을 병합하므로 훅이 **두 번
발동**한다(`session-start.sh`라면 stdout이 대화 프리픽스에 두 번 주입된다).
`claude.local.yaml`에는 머신마다 진짜 다른 것만 남긴다 — Superset 훅 `preserve`
규칙처럼 그 도구가 설치된 머신에서만 의미가 있는 것.

이 전역 등록은 프로젝트별 중복 등록을 뜻하지 않는다. 오히려 루트에만 한 번
등록해야 한다. 두 불변식은 `hooks/hook-registration_test.sh`의
`test_core_claude_hooks_registered_in_tracked_root_yaml` /
`test_core_claude_hooks_not_duplicated_per_project`가 6개 코어 훅에 대해 정적으로
강제한다.

## 검증

`make sync-dry`가 각 대상의 `settings.local.json`에 병합될 `config`/`hooks`를
미리보기로 나열한다. 실제 배포 결과는 대상 워크트리의
`.claude/settings.local.json`을 직접 확인한다.

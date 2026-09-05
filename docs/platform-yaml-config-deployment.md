# per-platform YAML config 배포 — config/hooks/mcps는 어디로 가나

`claude.yaml`(과 그 오버레이 `claude.local.yaml`)의 `config`·`hooks`·`mcps`는
컴포넌트(agents/skills/…)와 달리 파일로 복사되지 않는다. `config`·`hooks`는
대상 프로젝트의 **settings 파일에 병합**되지만, `mcps`는 다른 파일(`~/.claude.json`)에
**항목 단위로 대입**된다 — 아래 "무엇이 어디로 배포되나" 참고. 개인 절대경로(예:
`TURBO_CACHE_DIR`)를 어디에 둬야 안전한지는 이 배포 경로와 **두 개의 서로 다른
gitignore 계층**으로 결정된다.

## 무엇이 어디로 배포되나

다음 병합 규칙과 표의 settings 열은 Claude에 해당한다. Codex `config`는
아래 별도 소유권 규칙에 따라 `.codex/config.toml`을 수정한다.

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

Claude·Codex·OpenCode에서 선언을 **생략**하면 기존 상태가 보존된다. 이전에 배포한 MCP를 제거하려면
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
| Codex | `codex mcp remove <name>`로 해당 서버만 제거한다. OMT가 관리하는 MCP 이름은 대상의 `.omt/sync-manifest.json` `codex/mcps` 페어로 추적하므로, 형제·사용자 추가 서버는 건드리지 않는다. |
| OpenCode | 대상의 `.opencode/opencode.json`에서 `mcp.<name>`만 삭제한다. |
| Gemini | **지원하지 않는다.** `mcps.<name>: null`은 검증에서 거부된다. Gemini는 `mcps` 섹션이 제공되면 `.gemini/settings.json`의 `mcpServers` 전체를 교체하므로, 이 삭제 tombstone 계약의 대상이 아니다. |

Claude의 루트·프로젝트 MCP는 `deployRoot` 밖의 사용자 설정 파일에 기록되므로 해당
워크트리의 `DeployTransaction` 범위에 포함되지 않는다. 이후 대상 배포가 실패해도
MCP 변경은 남을 수 있다. 필요하면 sync를 재시도하거나 tombstone을 선언하고, 또는
Claude CLI로 수동 제거한다.

Codex는 대상 `.codex/config.toml`을 바꾸는 native `codex mcp add/remove`와
`codex/mcps` 이름 manifest 갱신을 같은 배포 transaction에 포함한다. 실패 시
설정과 manifest를 롤백하지만, OAuth 인증 상태 등 외부 효과는 롤백하지 않는다.
OpenCode의 대상 설정도 `deployRoot` 안에서 처리한다.

수동 CLI로는 루트 전역 MCP에 `claude mcp remove <name> --scope user`, 프로젝트
local MCP에 `claude mcp remove <name> --scope local`을 쓴다. scope를 생략하면
Claude CLI가 MCP의 존재 위치를 찾는다. 이 수동 방법은 계속 쓸 수 있지만 선언형
sync의 유일한 제거 경로는 아니다. 설정에서 선언을 지우는 것만으로는 Claude·Codex·
OpenCode의 기존 MCP가 삭제되지 않는다.

절(section) 레벨 `null`인 `config: null` / `hooks: null` / `mcps: null`은 개별
삭제와 다르다. 어댑터의 `syncPlatformYaml` 가드가 그 섹션 전체를 이번 배포에서
건너뛰게 할 뿐이며, 기존 상태를 제거하지 않는다.

### Codex 설정 소유권과 삭제

Codex는 기본 `.codex/config.toml`을 사용한다. OMT가 관리할 leaf 경로와 마지막
적용 값은 대상의 `.omt/codex-config-state.json`에 기록한다. 각 `entries` 항목의
`path`는 문자열 배열이고, `valueToml`은 마지막 값을 `value = ...` 형태의 TOML로
저장한다. 테이블은 경로를 묶는 공간이며 배열은 원소별로 나누지 않는 하나의 값이다.

- 새 키는 추가하고 소유권을 기록한다. 이미 존재하는 미소유 키는 선언 값과 같아도
  명시적으로 채택해야 한다. 기존 주석은 소유권 증거가 아니다.
- 선언에서 빠진 키와 그 소유권 기록은 보존한다. 소유한 키를 삭제하려면 해당
  키를 `null`로 선언한다. 이미 없는 소유 키의 `null`은 소유권만 정리한다.
- 현재 값이 마지막 적용 값 또는 이번 선언 값과 같으면 반영할 수 있다. 둘 다
  다르거나 소유한 키가 사라졌다면 충돌로 중단한다(위 명시적 삭제는 예외).
  충돌한 값을 덮거나 다른 키만 부분 적용하지 않는다.
- 변경하지 않는 TOML 바이트는 보존한다. inline table 내부·array-of-tables
  내부 편집, array-of-tables 교체, leaf와 table 사이의 전환처럼 지원하지 않는
  구조 변경은 쓰기 전에 거부한다. 채택 성공이 그 표현의 모든 편집을 보장하지 않는다.

예를 들어 다음 선언은 소유한 `features.example`만 삭제한다. `features`의 다른
키를 생략해도 그 값은 남는다. `config: null`은 이와 달리 설정 배포 전체를 건너뛴다.

```yaml
config:
  features:
    example: null
```

### 기존 Codex 설정 채택

OMT 저장소에서 다음 명령으로 현재 존재하는 leaf를 검토한다. `--target`은 실제
배포 루트이며 필수다. `--key`는 문자열 경로 조각의 비어 있지 않은 JSON 배열이고,
각 leaf마다 반복한다. 아래 경로와 키는 대상에 맞게 바꾼다.

```bash
bun tools/codex-config-migrate.ts --target /path/to/target --key '["model"]' --key '["features","example"]'
```

기본은 쓰기 없는 미리보기다. 검토한 키를 관리 대상으로 채택하려면 같은 명령에
`--apply`를 붙인다.

```bash
bun tools/codex-config-migrate.ts --target /path/to/target --key '["model"]' --key '["features","example"]' --apply
```

적용은 현재 값을 소유권 상태에 기록하며 config 바이트와 주석을 다시 쓰지 않는다.
최초 채택 적용 전에 `.omt/codex-config-before-adoption.toml`을 `0600`으로
생성하고 이후 채택에서는 덮어쓰지 않는다. 임시 파일에 전체 내용을 쓰고 fsync한 뒤
기존 파일을 덮어쓰지 않는 hard link로 백업 경로에 게시한다. 이미 있는 일반 백업
파일은 보존하지만 내용의 무결성을 검증하지 않는다. 상태·pending·잠금 파일도
생성 시 `0600`을 사용한다. 새 백업은 최초 채택 전 원본이며 후속 sync의 최신
백업이 아니다.

TOML이 유효하면 `omt:config` 주석이 없거나 한쪽만 있거나 순서가 뒤집혀 있어도
같은 절차를 쓴다. 주석 사이 범위를 추측하거나 closing marker를 보충할 필요가 없다.
파일이 없거나 TOML·소유권 상태가 잘못됐으면 먼저 원인을 해결한다. 테이블 전체
채택은 거부하며 leaf를 각각 지정해야 한다. 이미 소유한 키는 마지막 적용 값과
같으면 no-op, 달라졌으면 거부한다. 이 CLI로 사용자 변경을 강제 인수할 수 없다.

### Codex 미리보기와 복구

`make sync-dry`는 실제 대상 config와 상태를 읽고 TOML 파싱, 소유권 충돌·채택
필요 여부, 편집 지원 여부를 확인한다. 파일·디렉터리·잠금을 생성하지 않는다.
`.omt/codex-config-pending.json`이 남으면 `recovery-required`로 실패하며,
채택 CLI도 복구 전에는 거부한다. 미리보기나 채택은 복구를 실행하지 않는다.
`config`를 생략하거나 `config: null`로 두고 MCP만 배포해도 실제 MCP 적용은
native 목록 조회·CLI 변경·manifest 갱신 전에 pending 설정을 복구한다.
이 MCP 경로의 dry-run도 pending이 있으면 실패한다.

설정 저장 중 일반 예외로 종료하면 잠금을 해제하며, 다음 실제 sync에서 남은
저널의 복구를 시도한다. 강제 종료로 `.omt/codex-config.lock`이 남으면 기존
잠금을 자동 삭제하거나 PID 생존 여부로 회수하지 않고 설정 저장·복구를 거부한다.
운영자가 해당 대상에 활성 sync가 없음을 확인하고 새 sync도 시작되지 않도록
독점 작업을 확보한 경우에만 잠금 파일 하나를 수동 제거한 뒤 재시도한다.
PID 메타데이터만으로 이 조건을 입증할 수 없으며, 활성 잠금은 절대 삭제하지
않는다. 복구를 위해 pending 저널이나 소유권 상태 파일을 지워서는 안 된다.

실제 sync는 저널의 config/state 바이트가 `(이전, 이전)`, `(이후, 이전)`,
`(이후, 이후)`인 경우에만 둘 다 이후 상태가 되도록 완료하고 저널을 제거한다.
외부 편집으로 다른 바이트가 생기면 충돌로 보존한다. 잘못된 저널이나 복구 후
예정된 설정의 충돌·미지원 편집은 먼저 해결해야 실제 sync가 진행된다. 설정·상태·
pending 파일은 배포 transaction 스냅샷에 포함된다. 교체 직전 재검사는 하지만
native MCP 쓰기는 설정 저장 잠금을 공유하지 않는다. 재검사는 범위가 제한되며
외부 프로그램과 범용 compare-and-swap을 공유하지 않아 모든 동시 쓰기를 막는
보장은 없다. 같은 대상을 향한 sync의 동시 실행도 지원하지 않는다.
실행 조건과 워크트리별 실패 처리는
[sync 배포 타겟 운영 문서](sync-deploy-targets.md)를 참고한다.

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

### Claude 플러그인의 트랜잭션 범위와 외부 명령

플러그인 항목의 `check`와 `pre-commands`는 대상 워크트리에서 `bash -c`로
실행된다. 따라서 Claude CLI 호출을 포함한 임의의 셸 명령이 사용자 범위,
프로젝트 범위 또는 `deployRoot` 밖의 외부 상태를 변경할 수 있다. 플러그인
설치·제거와 이 명령들의 변경은 파일 배포용 `DeployTransaction`에 포함되지
않으며, 트랜잭션으로 롤백할 수도 없다. 뒤이어 다른 대상의 배포가 실패해도
이미 실행된 외부 변경은 남을 수 있다.

복구가 필요하면 먼저 같은 설정으로 sync를 재시도한다. 플러그인 상태가
엇갈렸다면 해당 scope에 맞는 Claude CLI `plugin uninstall` 또는 `plugin install`을
수동으로 실행하고, `check`·`pre-commands`가 만든 파일·설정·기타 외부 변경은
그 명령의 의미에 맞게 직접 되돌린다. 이 복구 절차는 선언형 파일 배포의
트랜잭션 보장에 포함되지 않는다.

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

`hooks:` 블록은 위 기본 규칙이 특히 세게 적용된다. 5개 코어 훅
(`keyword-detector.sh`·`pre-tool-enforcer.sh`·
`session-start.sh`·`orphan-reaper.sh`·`persistent-mode`)은 device-specific 요소가
없으므로 반드시 추적되는 루트 `claude.yaml`에 둔다.
`claude.local.yaml`에 두면 실제로 두 가지가 깨진다:

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

Claude에서는 `make sync-dry`가 각 대상의 `settings.local.json`에 병합될 `config`/`hooks`를
미리보기로 나열한다. 실제 배포 결과는 대상 워크트리의
`.claude/settings.local.json`을 직접 확인한다.

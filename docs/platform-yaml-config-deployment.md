# per-platform YAML config 배포 — config/hooks/mcps는 어디로 가나

`claude.yaml`(과 그 오버레이 `claude.local.yaml`)의 `config`·`hooks`·`mcps`는
컴포넌트(agents/skills/…)와 달리 파일로 복사되지 않고, 대상 프로젝트의
**settings 파일에 병합**된다. 개인 절대경로(예: `TURBO_CACHE_DIR`)를 어디에 둬야
안전한지는 이 배포 경로와 **두 개의 서로 다른 gitignore 계층**으로 결정된다.

## 무엇이 어디로 배포되나

- `config`·`hooks`·`statusLine`은 대상의 **`.claude/settings.local.json`에
  deep-merge**된다. **전역 sync만 `.claude/settings.json`**을 쓴다 —
  `tools/adapters/claude.ts`의 `isGlobalSync(targetPath) ? "settings.json" :
  "settings.local.json"` 분기.
- deep-merge라 기존 settings를 통째로 덮지 않고 **additive**하게 얹는다(같은 키만
  갱신). `mcps`도 같은 파일의 해당 섹션으로 병합된다.

## 두 개의 gitignore 계층 (핵심)

`claude.yaml`과 `claude.local.yaml`을 가르는 건 "팀에 유출되느냐"가 **아니다**.
둘은 서로 다른 축의 gitignore를 탄다.

| 계층 | 무엇을 ignore하나 | 무슨 축인가 |
|------|------------------|------------|
| **계층 1 — OMT 소스 레포** | `/*.local.yaml` + `/projects/*/*.local.yaml` (OMT `.gitignore`) → `claude.local.yaml`만 ignore, `claude.yaml`은 git 추적 | **"OMT 레포에 버전관리하느냐"** |
| **계층 2 — 대상 팀 레포** | `.claude/settings.local.json` (대상 레포 `.gitignore`, 예: algocare-home) → 배포 산출물 자체를 ignore | **"대상 팀 레포에 커밋되느냐"** |

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

`hooks:` 블록은 위 기본 규칙이 특히 세게 적용된다. 코어 훅
(`keyword-detector.sh`·`pre-tool-enforcer.sh`·`session-start.sh`·`persistent-mode`)은
device-specific 요소가 없으므로 반드시 `claude.yaml`에 둔다. `claude.local.yaml`에
두면 실제로 두 가지가 깨진다:

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

두 불변식은 `hooks/hook-registration_test.sh`의
`test_core_claude_hooks_registered_in_tracked_root_yaml` /
`test_core_claude_hooks_not_duplicated_per_project`가 정적으로 강제한다.

## 검증

`make sync-dry`가 각 대상의 `settings.local.json`에 병합될 `config`/`hooks`를
미리보기로 나열한다. 실제 배포 결과는 대상 워크트리의
`.claude/settings.local.json`을 직접 확인한다.

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

---

## 전제 조건

시작 전에 세 가지를 확인하세요.

**bun 설치 여부**

훅 스크립트는 bun으로 실행됩니다.

```bash
bun --version
```

설치되어 있지 않으면 [bun.sh](https://bun.sh)에서 설치할 수 있습니다.

**codex 설치 여부**

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

**헤드리스 환경(CI, `codex exec`)에서는 주입이 동작하지 않습니다.**

codex의 PostToolUse 훅은 인터랙티브 TUI에서만 발동합니다. `codex exec`로 실행하는 CI 환경이나 자동화 스크립트에서는 해당 머신에 인터랙티브 신뢰 기록이 있더라도 훅 자체가 발화하지 않습니다. 규칙 주입은 팀원이 직접 codex TUI를 쓸 때만 적용됩니다.

**`apply_patch`(파일 신규 생성)는 커버되지 않습니다 (R7-GAP).**

codex가 파일을 새로 만들 때 쓰는 first-class `apply_patch` 연산은 tool hook을 발동시키지 않습니다. 이 제한은 codex 구조상의 것으로, 이 훅이 해결할 수 있는 범위 밖입니다. 파일 수정/읽기/grep 등 shell 도구를 통한 접근은 정상적으로 커버됩니다.

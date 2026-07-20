# oh-my-toong

한국어 | **[English](README.en.md)**

**버전 관리되는 중앙 스킬/에이전트/훅/룰 라이브러리 — 프로젝트마다 `.claude/`로 선별 동기화하고, 상향 탐색 오버라이드로 분화한다**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Acknowledgments

이 프로젝트는 아직 놀이터 수준이지만, Claude Code 커뮤니티 덕분에 정말 많이 배우고 성장하고 있습니다.

다음 프로젝트들에서 영감을 받고, 공부하고, 참고하며 개발하고 있습니다. 감사합니다.

- [everything-claude-code](https://github.com/affaan-m/everything-claude-code)
- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)
- [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)
- [claude-hud](https://github.com/jarrodwatts/claude-hud)
- [superpowers](https://github.com/obra/superpowers)
- [team-attention](https://github.com/team-attention/plugins-for-claude-natives)

---

## oh-my-toong이란?

oh-my-toong은 **에이전트 중앙 관리 프로젝트**입니다. 스킬, 에이전트, 훅, 룰을 버전 관리되는 하나의 중앙 라이브러리에 모아 두고, 각 대상 프로젝트의 `.claude/`로 **선별적으로** 동기화합니다. 같은 라이브러리를 쓰더라도 프로젝트마다 다른 구성을 줄 수 있는데, 이를 **상향 탐색(upward-search) 오버라이드**가 담당합니다.

## 주요 기능

- **중앙 라이브러리** — 스킬, 에이전트, 훅, 룰을 한 저장소에서 버전 관리
- **선언적 동기화** — `sync.yaml`로 필요한 컴포넌트만 대상 프로젝트의 `.claude/`로 배포
- **프로젝트별 분화** — 상향 탐색으로 글로벌 컴포넌트 위에 프로젝트 고유 컨벤션 오버라이드
- **고아 정리** — 라이브러리에서 제거한 컴포넌트는 다음 sync 때 대상에서도 사라짐
- **멀티플랫폼 지원** — Claude / Gemini / Codex / OpenCode를 어댑터로 추상화

## 철학 — 왜 이 설계인가

**1단계 — 같은 이름, 다른 내용**: 각 프로젝트에 동일한 스킬을 복사하면 되지만, 핵심 딜레마가 있습니다. 예를 들어 `testing`은 Kotlin/Spring 프로젝트에서 "Classical TDD, verify() 금지, BDD 구조"를 의미하지만, 다른 프로젝트에서는 완전히 다른 컨벤션을 가질 수 있습니다. `implementation`도 마찬가지입니다. **동일한 이름의 스킬이 프로젝트마다 다른 내용을 담아야 합니다.**

**2단계 — 중앙 관리 + 프로젝트 분화**: oh-my-toong은 이 딜레마를 두 가지 메커니즘으로 해결합니다.

- **글로벌 컴포넌트** (`skills/`, `agents/` 등): 프로젝트에 관계없이 공통인 것을 한 곳에서 버전 관리
- **프로젝트 오버라이드** (`projects/<name>/skills/`): 프로젝트마다 달라야 하는 것을 프로젝트별로 분화

동기화 시 **상향 탐색(Upward Search)** 로직이 동작합니다. 프로젝트의 `sync.yaml`에서 `testing`을 참조하면, 먼저 해당 프로젝트의 `projects/<name>/skills/testing/`을 찾고, 없으면 글로벌 `skills/testing/`으로 폴백합니다.

## 문서

라이브러리에 담긴 스킬(42종)·에이전트(13종)의 상세는 `docs/`에 정리되어 있습니다.

| 문서 | 내용 |
|------|------|
| [코어 파이프라인](docs/skills/core-pipeline.md) | 정의→기획→실행→검증 파이프라인 (deep-interview · prometheus · sisyphus · clarify · momus · diagnose · agent-council) + 위임 에이전트 13종 |
| [리뷰/품질](docs/skills/review-quality.md) | code-review · orchestrate-review · design-review · slides-review · qa |
| [리서치](docs/skills/research.md) | ultraresearch · insane-browsing — 포화 리서치 엔진과 차단 소스 브라우징 |
| [문서/콘텐츠·유틸](docs/skills/authoring.md) | create-slides · technical-writing · technical-copywriting · humanizer · make-pr · scan-pdf-to-notes · git-master |
| [지식 그래프(pins)](docs/skills/knowledge-graph-pins.md) | pins 지식 그래프 — pin-setup · record · query · audit · wrap-up |
| [유틸·개인 워크플로우](docs/skills/utilities-personal.md) | hud · resume · jd · mock-interview 등 |
| [프라이빗 포크 관리](docs/PRIVATE-FORK-MANAGEMENT.md) | 프라이빗 포크 운영 가이드 — 업스트림 미러링과 지속 동기화 |
| [오케스트레이션 가이드](docs/ORCHESTRATION.md) | prometheus → sisyphus 워크플로우와 사용법 |

## Quick Start

### 사전 요구사항

- Claude Code CLI 설치됨
- Node.js v18+ (HUD 기능용)
- macOS 또는 Linux

### 설정

1. 이 저장소를 클론:
   ```bash
   git clone https://github.com/yourusername/oh-my-toong.git
   cd oh-my-toong
   ```

2. `sync.yaml`에 대상 프로젝트 경로와 배포할 컴포넌트 선언:
   ```yaml
   path: /path/to/your/project

   skills:
     items:
       - prometheus
       - sisyphus

   agents:
     items:
       - oracle
       - explore

   hooks:
     items:
       - component: session-start.sh
         event: SessionStart
   ```

3. 검증 및 동기화:
   ```bash
   make validate    # 설정 확인
   make sync-dry    # 변경 사항 미리보기
   make sync        # 동기화 적용
   ```

   `make sync`는 현재 브랜치가 default 브랜치가 아니거나 워킹트리에 staged/unstaged/untracked 변경이 하나라도 있으면 실패합니다 — 즉 커밋 후에만 동기화할 수 있습니다. 게이트를 끄는 전용 환경변수나 CLI 플래그는 없지만, `HOME`을 갈아끼우면 전역 git 설정을 통해 우회할 수 있습니다. `make sync-dry`는 이 게이트 대상이 아니므로 커밋 전에도 미리보기용으로 쓸 수 있습니다. 게이트가 실제로 막는 범위와 트레이드오프는 `docs/sync-deploy-targets.md` 참고.

### 프로젝트별 스킬 분화

같은 이름의 스킬이라도 프로젝트의 언어/프레임워크에 따라 다른 컨벤션이 필요할 때, `projects/` 디렉토리에 프로젝트별 오버라이드를 생성합니다.

```
projects/
└── loopers-kotlin-spring-template/
    └── skills/
        ├── testing/
        │   └── SKILL.md    # Classical TDD, verify() 금지, BDD 구조
        └── implementation/
            └── SKILL.md    # Kotlin/Spring 아키텍처 패턴
```

`sync.yaml`에서 스킬을 참조하면, 동기화 시 해당 프로젝트 폴더를 먼저 검색하고 없으면 글로벌로 폴백합니다.

```yaml
# projects/loopers-kotlin-spring-template/sync.yaml
skills:
  items:
    - testing          # → projects/loopers-.../skills/testing/ (프로젝트 우선)
    - diagnose         # → skills/diagnose/ (글로벌 폴백)

agents:
  items:
    - component: sisyphus-junior
      add-skills:
        - testing          # sisyphus-junior에 프로젝트별 testing 스킬 주입
        - implementation   # sisyphus-junior에 프로젝트별 implementation 스킬 주입
```

## 로컬 오버라이드

기기마다 다른 설정(회사 Mac vs 개인 Mac)이 필요할 때를 위해, 모든 YAML 입력은 git에서 추적되는 `*.yaml`과 gitignore되는 `*.local.yaml`로 나뉩니다. Vite/Next.js의 `.env` + `.env.local` 패턴과 같으며, `make sync` 시 둘이 자동으로 deep merge됩니다. `config.local.yaml`의 `enabled-projects`로 기기별 프로젝트 화이트리스트도 지정할 수 있습니다.

## HUD

`/hud setup`을 실행하면 Claude Code 상태바에 세션·리소스·작업 진행 상황을 2줄로 표시합니다. 요소별 색상 규칙과 옵션은 [유틸·개인 워크플로우 문서](docs/skills/utilities-personal.md)를 참고하세요.

## License

MIT 라이선스 - 자세한 내용은 [LICENSE](LICENSE) 참조.

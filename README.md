# oh-my-toong

한국어 | **[English](README.en.md)**

**버전 관리되는 중앙 스킬/에이전트/훅/룰/문서 라이브러리 — 프로젝트마다 선별 동기화하고, 상향 탐색 오버라이드로 분화한다**

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

oh-my-toong은 **에이전트 중앙 관리 프로젝트**입니다. 스킬, 에이전트, 훅, 룰, 문서를 버전 관리되는 하나의 중앙 라이브러리에 모아 두고, 각 대상 프로젝트로 **선별적으로** 동기화합니다. 컴포넌트는 플랫폼 디렉터리(`.claude/`, `.codex/` 등)로, 문서는 대상 레포 루트의 `docs/`로 착지합니다. 같은 라이브러리를 쓰더라도 프로젝트마다 다른 구성을 줄 수 있는데, 이를 **상향 탐색(upward-search) 오버라이드**가 담당합니다.

## 주요 기능

- **중앙 라이브러리** — 스킬, 에이전트, 훅, 룰, 문서를 한 저장소에서 버전 관리
- **선언적 동기화** — `sync.yaml`로 필요한 컴포넌트만 대상 프로젝트의 `.claude/`로 배포
- **프로젝트별 분화** — 상향 탐색으로 글로벌 컴포넌트 위에 프로젝트 고유 컨벤션 오버라이드
- **고아 정리** — 라이브러리에서 제거한 컴포넌트는 다음 sync 때 대상에서도 사라짐
- **멀티플랫폼 지원** — Claude / Gemini / Codex / OpenCode를 어댑터로 추상화
- **표면별 E2E 라우팅** — 웹/Electron은 `agent-browser`, 모바일/TV/네이티브 데스크톱은 `agent-device`로 검증

## 철학 — 왜 이 설계인가

**1단계 — 프롬프트도 버전 관리 대상이다**: 스킬·룰·문서는 에이전트의 행동을 결정하는 입력이므로 코드와 같은 취급을 받아야 합니다. 그런데 실제로 읽히는 자리는 프로젝트마다 흩어진 `.claude/`이고, 거기서 직접 고치면 이력이 남지 않을뿐더러 다음 sync에 덮여 사라집니다. 그래서 편집은 언제나 라이브러리 쪽에서 하고, 대상에는 배포만 합니다.

**2단계 — 프로젝트마다 컨벤션이 다르고, 분화의 그릇도 하나가 아니다**: 같은 `testing`이라도 `projects/toong-java-spring-template/`에서는 "Classical TDD, verify() 금지, BDD 구조"를 뜻하고 다른 프로젝트에서는 전혀 다른 것을 뜻합니다. 이 분화를 담는 방식은 두 가지입니다.

- **스킬 오버라이드** (`projects/<name>/skills/`): 동기화 시 **상향 탐색(Upward Search)** 이 동작해, `sync.yaml`이 `testing`을 참조하면 프로젝트 폴더를 먼저 찾고 없으면 글로벌 `skills/testing/`으로 폴백합니다. 컨벤션 한 덩어리를 통째로 갈아끼울 때 씁니다.
- **rules 인덱스 + docs 근거** (`projects/<name>/rules/`, `projects/<name>/docs/`): 컨벤션이 스킬 하나에 담기엔 클 때 rules와 docs로 나눕니다. `loopers-kotlin-spring-template`(docs 19 + rules 7)은 rules에 "어느 문서를 열어야 하는지"만 두는 순수 인덱스 방식이고, `loop-pack-fe-l2-vol1`(docs 16 + rules 8)은 자주 쓰는 판단 기준을 rules에 직접 두고 깊은 근거만 docs로 미룹니다 — 어느 쪽이든 항상 로드되는 분량을 통제하는 게 목적입니다.

**3단계 — 같은 내용이 플랫폼마다 다른 자리에 앉는다**: Claude는 `.claude/`, Codex는 `.codex/`와 `.agents/` 두 갈래, Gemini는 `.gemini/`로 디렉터리 구조도 지원 카테고리도 제각각입니다. 그 차이는 어댑터가 흡수하므로, 컨벤션은 한 번만 쓰면 되고 어떤 플랫폼으로 얼마나 내보낼지는 `sync.yaml`의 `platforms`가 결정합니다.

## 문서

라이브러리에 담긴 스킬(44종)·에이전트(13종)의 상세는 `docs/`에 정리되어 있습니다.

| 문서 | 내용 |
|------|------|
| [코어 파이프라인](docs/skills/core-pipeline.md) | 정의→기획→실행→검증 파이프라인 (deep-interview · prometheus · sisyphus · clarify · momus · diagnose · agent-council) + 위임 에이전트 13종 |
| [리뷰/품질](docs/skills/review-quality.md) | code-review · orchestrate-review · design-review · slides-review · qa |
| [리서치](docs/skills/research.md) | ultraresearch · insane-browsing — 포화 리서치 엔진과 차단 소스 브라우징 |
| [문서/콘텐츠·유틸](docs/skills/authoring.md) | create-slides · technical-writing · technical-copywriting · humanizer · make-pr · scan-pdf-to-notes · git-master |
| [지식 그래프(pins)](docs/skills/knowledge-graph-pins.md) | pins 지식 그래프 — pin-setup · record · query · audit · wrap-up |
| [유틸·개인 워크플로우](docs/skills/utilities-personal.md) | agent-device · agent-browser · dogfood · hud · resume · jd · mock-interview 등 |
| [프라이빗 포크 관리](docs/PRIVATE-FORK-MANAGEMENT.md) | 프라이빗 포크 운영 가이드 — 업스트림 미러링과 지속 동기화 |
| [오케스트레이션 가이드](docs/ORCHESTRATION.md) | prometheus → sisyphus 워크플로우와 사용법 |
| [모델 배정](docs/model-assignment.md) | 에이전트별 모델 등급 배정 원칙과 `model-map` 치환 규칙 |

## Quick Start

### 사전 요구사항

- Claude Code CLI 설치됨
- Node.js v18+ (HUD 기능용)
- `jq` (훅이 페이로드 파싱에 사용 — 없으면 가드가 조용히 열림)
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

### 프로젝트별 컨벤션 분화

같은 컨벤션이라도 프로젝트의 언어/프레임워크에 따라 판단 기준이 달라질 때가 있습니다. `projects/` 디렉토리는 프로젝트 스코프의 `rules/`와 `docs/`로 이걸 표현합니다: `rules/`는 항상 로드되는 얇은 층이고 `docs/`가 판단 기준·예시·근거를 담는 근거 문서입니다. 둘로 나누면 에이전트가 매번 전량을 읽지 않고 상황에 필요한 문서만 열 수 있습니다. rules를 어디까지 얇게 둘지는 프로젝트가 정합니다 — `loopers-kotlin-spring-template`은 "이런 상황이면 이 문서를 열어라"만 남긴 순수 인덱스라 판단 기준이 docs 한 곳에만 있고, `loop-pack-fe-l2-vol1`은 자주 쓰는 기준을 rules에 직접 두고 깊은 근거만 docs로 미룹니다.

두 프로젝트가 이 구조로 컨벤션을 분화시킵니다.

```
projects/
├── loop-pack-fe-l2-vol1/            # docs 16개 + rules 8개
│   ├── rules/                        # react, testing, nextjs 등 상황별 인덱스
│   └── docs/
│       ├── react/                    # 컴포넌트 경계, 훅 설계, props 계약
│       ├── testing/                  # 테스트 레이어, 도구, 검증 기준
│       └── nextjs/                   # App Router, 데이터/에셋 규칙
└── loopers-kotlin-spring-template/  # docs 19개 + rules 7개
    ├── rules/                        # test-strategy, layer-placement 등 상황별 인덱스
    └── docs/
        ├── testing/                  # 단위/통합/동시성 등 레벨별 테스트 기준
        └── implementation/           # 도메인 이벤트, 레이어 경계 등 아키텍처 패턴
```

`sync.yaml`은 프로젝트가 어떤 rule과 doc을 배포할지 선언합니다. doc 항목은 디렉토리 이름으로 적으면 하위 전체가 그대로 착지합니다.

```yaml
# projects/loopers-kotlin-spring-template/sync.yaml
rules:
  items:
    - test-strategy
    - layer-placement
    - domain-model
    - api-contract
    # ... 이 프로젝트 스코프 rule 7개, 각각 docs/testing 또는 docs/implementation의 문서를 가리킴

# rule들이 "docs/testing/…를 읽어라"로 가리키는 근거 문서. 디렉토리 형태 →
# docs/testing/ 전체가 docs/testing/로, implementation/ 전체가 docs/implementation/로 착지한다.
docs:
  items:
    - testing
    - implementation
```

스킬 오버라이드는 여전히 지원됩니다. `projects/toong-java-spring-template/`는 `testing`/`implementation` 스킬을 프로젝트 폴더에서 직접 오버라이드합니다 — `sync.yaml`에서 스킬을 참조하면 동기화 시 프로젝트 폴더를 먼저 검색하고 없으면 글로벌로 폴백합니다. 특정 에이전트에만 프로젝트 스킬을 주입하려면 `add-skills`를 씁니다.

```yaml
agents:
  items:
    - component: sisyphus-junior
      add-skills:
        - testing   # sisyphus-junior에 프로젝트별 testing 스킬 주입
```

## 로컬 오버라이드

기기마다 다른 설정(회사 Mac vs 개인 Mac)이 필요할 때를 위해, 설정 루트(OMT 루트·각 프로젝트 루트)의 YAML 입력은 git에서 추적되는 `*.yaml`과 gitignore되는 `*.local.yaml`로 나뉩니다 — 컴포넌트 디렉터리 안에 중첩된 `*.local.yaml`(예: 프로젝트 정책 오버레이)은 배포되는 페이로드라 버전관리 대상입니다. Vite/Next.js의 `.env` + `.env.local` 패턴과 같으며, `make sync` 시 둘이 자동으로 deep merge됩니다. `config.local.yaml`의 `enabled-projects`로 기기별 프로젝트 화이트리스트도 지정할 수 있습니다.

## HUD

`/hud setup`을 실행하면 Claude Code 상태바에 세션·리소스·작업 진행 상황을 2줄로 표시합니다. 요소별 색상 규칙과 옵션은 [유틸·개인 워크플로우 문서](docs/skills/utilities-personal.md)를 참고하세요.

## License

MIT 라이선스 - 자세한 내용은 [LICENSE](LICENSE) 참조.

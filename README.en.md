# oh-my-toong

**[한국어](README.md)** | English

**A version-controlled central library of skills/agents/hooks/rules — selectively synced into each project's `.claude/`, differentiated via upward-search override**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Acknowledgments

This project is still just a playground, but I'm learning and growing so much thanks to the Claude Code community.

I'm developing this while being inspired by, studying, and referencing the following projects. Thank you.

- [everything-claude-code](https://github.com/affaan-m/everything-claude-code)
- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)
- [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)
- [claude-hud](https://github.com/jarrodwatts/claude-hud)
- [superpowers](https://github.com/obra/superpowers)
- [team-attention](https://github.com/team-attention/plugins-for-claude-natives)

---

## What is oh-my-toong?

oh-my-toong is an **agent central-management project**. It keeps skills, agents, hooks, and rules in a single version-controlled central library and **selectively** syncs them into each target project's `.claude/`. The same library can yield a different configuration per project — that's the job of **upward-search override**.

## Features

- **Central library** — version-control skills, agents, hooks, and rules in one repository
- **Declarative sync** — deploy only the components you need into a target project's `.claude/` via `sync.yaml`
- **Per-project differentiation** — override global components with project-specific conventions via upward search
- **Orphan cleanup** — components removed from the library disappear from targets on the next sync
- **Multi-platform support** — Claude / Gemini / Codex / OpenCode abstracted via adapters

## Philosophy — Why This Design

**Step 1 — Same Name, Different Content**: You could simply copy the same skills to every project, but there's a key dilemma. For example, `testing` in a Kotlin/Spring project means "Classical TDD, no verify(), BDD structure," while a different project may follow entirely different conventions. The same goes for `implementation`. **Skills with the same name must carry different content per project.**

**Step 2 — Central Management + Project Differentiation**: oh-my-toong solves this dilemma with two mechanisms.

- **Global components** (`skills/`, `agents/`, etc.): things common across projects, version-controlled in one place
- **Project overrides** (`projects/<name>/skills/`): things that must differ per project, differentiated by project

During sync, an **Upward Search** logic applies. When a project's `sync.yaml` references `testing`, it first looks in the project's `projects/<name>/skills/testing/`, falling back to the global `skills/testing/` if not found.

## Documentation

The details of the library's skills (33), agents (11), and commands (2) live under `docs/`.

| Doc | Contents |
|-----|----------|
| [Core Pipeline](docs/skills/core-pipeline.en.md) | Definition→Planning→Execution→Verification pipeline (deep-interview · prometheus · sisyphus · clarify · momus · diagnose · agent-council) + 11 delegation agents + Ralph Loop |
| [Review/Quality](docs/skills/review-quality.en.md) | code-review · orchestrate-review · design-review · slides-review · qa · performance-optimizer |
| [Authoring/Utilities](docs/skills/authoring.en.md) | create-slides · technical-writing · technical-copywriting · humanizer · make-pr · scan-pdf-to-notes · git-master |
| [Knowledge Graph (pins)](docs/skills/knowledge-graph-pins.en.md) | pins knowledge graph — pin-setup · record · query · audit · wrap-up |
| [Utilities & Personal Workflows](docs/skills/utilities-personal.en.md) | hud · using-maestro + resume · jd · mock-interview, etc. |
| [Private Fork Management](docs/PRIVATE-FORK-MANAGEMENT.en.md) | Operating a private fork — mirroring upstream and continuous sync |
| [Orchestration Guide](docs/ORCHESTRATION.en.md) | prometheus → sisyphus workflow and usage |

## Quick Start

### Prerequisites

- Claude Code CLI installed
- Node.js v18+ (for HUD functionality)
- macOS or Linux

### Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/oh-my-toong.git
   cd oh-my-toong
   ```

2. Declare the target project path and the components to deploy in `sync.yaml`:
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

3. Validate and sync:
   ```bash
   make validate    # Check configuration
   make sync-dry    # Preview changes
   make sync        # Apply synchronization
   ```

### Per-Project Skill Differentiation

When skills with the same name need different conventions per project's language/framework, create project-specific overrides in the `projects/` directory.

```
projects/
└── loopers-kotlin-spring-template/
    └── skills/
        ├── testing/
        │   └── SKILL.md    # Classical TDD, no verify(), BDD structure
        └── implementation/
            └── SKILL.md    # Kotlin/Spring architecture patterns
```

When a skill is referenced in `sync.yaml`, the sync process searches the project folder first and falls back to global.

```yaml
# projects/loopers-kotlin-spring-template/sync.yaml
skills:
  items:
    - testing          # → projects/loopers-.../skills/testing/ (project first)
    - diagnose         # → skills/diagnose/ (global fallback)

agents:
  items:
    - component: sisyphus-junior
      add-skills:
        - testing          # Injects project-specific testing skill into sisyphus-junior
        - implementation   # Injects project-specific implementation skill into sisyphus-junior
```

## Local Override

For when a machine needs a different configuration (work Mac vs personal Mac), every YAML input splits into git-tracked `*.yaml` and gitignored `*.local.yaml`. It mirrors Vite/Next.js's `.env` + `.env.local` pattern, and the two are deep-merged automatically on `make sync`. You can also scope a per-machine project whitelist via `enabled-projects` in `config.local.yaml`.

## HUD

Running `/hud setup` shows session, resource, and task-progress info as a 2-line display in Claude Code's status bar. For per-element color coding and options, see the [Utilities & Personal Workflows doc](docs/skills/utilities-personal.en.md).

## License

MIT License - see [LICENSE](LICENSE) for details.

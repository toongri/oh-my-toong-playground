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

The details of the library's skills (42) and agents (13) live under `docs/`.

| Doc | Contents |
|-----|----------|
| [Core Pipeline](docs/skills/core-pipeline.en.md) | Definition→Planning→Execution→Verification pipeline (deep-interview · prometheus · sisyphus · clarify · momus · diagnose · agent-council) + 13 delegation agents |
| [Review/Quality](docs/skills/review-quality.en.md) | code-review · orchestrate-review · design-review · slides-review · qa |
| [Research](docs/skills/research.en.md) | ultraresearch · insane-browsing — saturation research engine and blocked-source browsing |
| [Authoring/Utilities](docs/skills/authoring.en.md) | create-slides · technical-writing · technical-copywriting · humanizer · make-pr · scan-pdf-to-notes · git-master |
| [Knowledge Graph (pins)](docs/skills/knowledge-graph-pins.en.md) | pins knowledge graph — pin-setup · record · query · audit · wrap-up |
| [Utilities & Personal Workflows](docs/skills/utilities-personal.en.md) | hud · resume · jd · mock-interview, etc. |
| [Private Fork Management](docs/PRIVATE-FORK-MANAGEMENT.en.md) | Operating a private fork — mirroring upstream and continuous sync |
| [Orchestration Guide](docs/ORCHESTRATION.en.md) | prometheus → sisyphus workflow and usage |

## Quick Start

### Prerequisites

- Claude Code CLI installed
- Node.js v18+ (for HUD functionality)
- `jq` (hooks parse payloads with it — guards silently fail open without it)
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

   `make sync` fails unless the current branch is the default branch and the working tree has no staged, unstaged, or untracked changes — synchronization only runs after a commit. There is no dedicated env var or CLI flag that turns the gate off, though redirecting `HOME` can still bypass it via your ambient global git config. `make sync-dry` is exempt from this gate, so it stays usable as a preview even before committing. See `docs/sync-deploy-targets.md` (Korean) for the gate's exact scope and trade-offs.

### Per-Project Convention Differentiation

Different projects' languages and frameworks sometimes call for different judgment criteria, even under the same convention name. The `projects/` directory expresses this with a project-scoped `rules/` and `docs/`: `rules/` is a thin index that only says "open this document for this situation," while `docs/` holds the actual grounding — judgment criteria, examples, rationale. Splitting the index from the documents lets an agent open only what a situation needs instead of reading everything every time, and keeps the criteria living in exactly one place so rules and docs never duplicate each other.

Two projects differentiate their conventions this way.

```
projects/
├── loop-pack-fe-l2-vol1/            # 16 docs + 8 rules
│   ├── rules/                        # situational index: react, testing, nextjs, ...
│   └── docs/
│       ├── react/                    # component boundaries, hook design, props contracts
│       ├── testing/                  # test layers, tooling, verification criteria
│       └── nextjs/                   # App Router, data/asset conventions
└── loopers-kotlin-spring-template/  # 19 docs + 7 rules
    ├── rules/                        # situational index: test-strategy, layer-placement, ...
    └── docs/
        ├── testing/                  # per-level test criteria: unit, integration, concurrency, ...
        └── implementation/           # architecture patterns: domain events, layer boundaries, ...
```

`sync.yaml` declares which rules and docs a project deploys. A doc item written as a directory name lands whole — the entire subtree beneath it.

```yaml
# projects/loopers-kotlin-spring-template/sync.yaml
rules:
  items:
    - test-strategy
    - layer-placement
    - domain-model
    - api-contract
    # ... 7 project-scoped rules total, each pointing into docs/testing or docs/implementation

# The grounding docs the rules point readers to with "read docs/testing/...". Directory form →
# the whole docs/testing/ lands as docs/testing/, and implementation/ as docs/implementation/.
docs:
  items:
    - testing
    - implementation
```

Skill overrides are still supported. `projects/toong-java-spring-template/` overrides the `testing`/`implementation` skills directly from its project folder — when `sync.yaml` references a skill, sync searches the project folder first and falls back to global. To inject a project skill into just one agent, use `add-skills`.

```yaml
agents:
  items:
    - component: sisyphus-junior
      add-skills:
        - testing   # Injects the project's testing skill into sisyphus-junior
```

## Local Override

For when a machine needs a different configuration (work Mac vs personal Mac), YAML inputs at the config roots (the OMT root and each project root) split into git-tracked `*.yaml` and gitignored `*.local.yaml` — a `*.local.yaml` nested inside a component directory (e.g. a project's policy overlay) is deployed payload and stays version-controlled. It mirrors Vite/Next.js's `.env` + `.env.local` pattern, and the two are deep-merged automatically on `make sync`. You can also scope a per-machine project whitelist via `enabled-projects` in `config.local.yaml`.

## HUD

Running `/hud setup` shows session, resource, and task-progress info as a 2-line display in Claude Code's status bar. For per-element color coding and options, see the [Utilities & Personal Workflows doc](docs/skills/utilities-personal.en.md).

## License

MIT License - see [LICENSE](LICENSE) for details.

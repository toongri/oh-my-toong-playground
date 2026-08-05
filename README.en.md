# oh-my-toong

**[한국어](README.md)** | English

**A version-controlled central library of skills/agents/hooks/rules/docs — selectively synced into each project, differentiated via upward-search override**

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

oh-my-toong is an **agent central-management project**. It keeps skills, agents, hooks, rules, and docs in a single version-controlled central library and **selectively** syncs them into each target project. Components land in a platform directory (`.claude/`, `.codex/`, …); docs land in the target repo's own `docs/`. The same library can yield a different configuration per project — that's the job of **upward-search override**.

## Features

- **Central library** — version-control skills, agents, hooks, rules, and docs in one repository
- **Declarative sync** — deploy only the components you need into a target project's `.claude/` via `sync.yaml`
- **Per-project differentiation** — override global components with project-specific conventions via upward search
- **Orphan cleanup** — components removed from the library disappear from targets on the next sync
- **Multi-platform support** — Claude / Gemini / Codex / OpenCode abstracted via adapters
- **Surface-specific E2E routing** — validate web/Electron with `agent-browser`, and iOS, tvOS, macOS, Android, and Vega OS TV with `agent-device`
- **Ultragoal final-review convergence** — allow cleanup-only completion while bounding active pursuing `code-reviewer` dispatches to a five-dispatch window and surfacing user mediation through Claude/Codex hook parity

## Philosophy — Why This Design

**Step 1 — Prompts Belong Under Version Control**: Skills, rules, and docs are the inputs that determine an agent's behavior, so they deserve the same treatment as code. But the place they're actually read from is a `.claude/` scattered across each project — edit them there and the history is lost, and the next sync overwrites the edit anyway. So editing always happens in the library; targets only receive deployments.

**Step 2 — Conventions Differ per Project, and So Does the Vessel That Holds Them**: The same `testing` means "Classical TDD, no verify(), BDD structure" in `projects/toong-java-spring-template/` and something else entirely elsewhere. There are two ways to express that differentiation.

- **Skill override** (`projects/<name>/skills/`): during sync, **Upward Search** applies — when `sync.yaml` references `testing`, it looks in the project folder first and falls back to the global `skills/testing/`. Use this to swap a whole convention wholesale.
- **rules index + docs grounding** (`projects/<name>/rules/`, `projects/<name>/docs/`): when a convention is too large for a single skill, split it across rules and docs. `loopers-kotlin-spring-template` (19 docs + 7 rules) keeps its rules a pure index — they say only which document to open. `loop-pack-fe-l2-vol1` (26 docs + 9 rules) puts frequently-used criteria directly in the rules and defers only the deeper grounding to docs. Either way the point is to bound what stays always-loaded.

**Step 3 — The Same Content Sits in a Different Place on Each Platform**: Claude uses `.claude/`, Codex splits across `.codex/` and `.agents/`, Gemini uses `.gemini/` — directory layout and supported categories differ across the board. Adapters absorb that difference, so a convention is written once and `sync.yaml`'s `platforms` decides which platforms it reaches and how far.

## Documentation

The details of the library's skills (43) and agents (13) live under `docs/`.

| Doc | Contents |
|-----|----------|
| [Core Pipeline](docs/skills/core-pipeline.en.md) | Definition→Planning→Execution→Verification pipeline (deep-interview · prometheus · sisyphus · clarify · momus · diagnose · agent-council) + 13 delegation agents |
| [Review/Quality](docs/skills/review-quality.en.md) | code-review · orchestrate-review · design-review · slides-review · qa |
| [Research](docs/skills/research.en.md) | ultraresearch · insane-browsing — saturation research engine and blocked-source browsing |
| [Authoring/Utilities](docs/skills/authoring.en.md) | create-slides · technical-writing · technical-copywriting · humanizer · make-pr · scan-pdf-to-notes · git-master |
| [Knowledge Graph (pins)](docs/skills/knowledge-graph-pins.en.md) | pins knowledge graph — pin-setup · record · query · audit · wrap-up |
| [Utilities & Personal Workflows](docs/skills/utilities-personal.en.md) | agent-device · agent-browser · dogfood · hud · resume · jd · mock-interview, etc. |
| [Private Fork Management](docs/PRIVATE-FORK-MANAGEMENT.en.md) | Operating a private fork — mirroring upstream and continuous sync |
| [Orchestration Guide](docs/ORCHESTRATION.en.md) | prometheus → sisyphus workflow and usage |
| [Model Assignment](docs/model-assignment.en.md) | Per-agent model tier principles and `model-map` substitution rules |
| [Platform YAML Configuration Deployment](docs/platform-yaml-config-deployment.en.md) | Deployment, merge, and deletion rules for platform-specific settings, hooks, and MCPs |

## Quick Start

### Prerequisites

- Claude Code CLI installed
- Node.js v18+ (for HUD functionality)
- `jq` (hooks parse payloads with it — guards do not block when it is unavailable)
- `sqlite3` (the Codex detector queries the `state_5.sqlite` state database with it — when unavailable, the detector counts zero and emits one stderr diagnostic)
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

Different projects' languages and frameworks sometimes call for different judgment criteria, even under the same convention name. The `projects/` directory expresses this with a project-scoped `rules/` and `docs/`: `rules/` is the thin always-loaded layer; `docs/` holds the actual grounding — judgment criteria, examples, rationale. Splitting the two lets an agent open only what a situation needs instead of reading everything every time. How thin the rules stay is the project's call: `loopers-kotlin-spring-template` keeps them a pure index that only says "open this document for this situation," so the criteria live in docs alone, while `loop-pack-fe-l2-vol1` puts frequently-used criteria directly in the rules and defers only the deeper grounding.

Two projects differentiate their conventions with this structure.

```
projects/
├── loop-pack-fe-l2-vol1/            # 26 docs + 9 rules
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

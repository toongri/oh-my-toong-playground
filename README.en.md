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
- **Orphan cleanup** — remove only agents/skills/scripts/rules OMT recorded as deployed, once they drop from the declaration; files it never deployed are left alone
- **Multi-platform support** — Claude / Gemini / Codex / OpenCode abstracted via adapters
- **Codex configuration ownership** — retain the default `.codex/config.toml` and track owned keys and last-applied values in `.omt/codex-config-state.json`, independently of comments. Existing keys require explicit adoption; conflicts preserve user settings. `make sync-dry` also checks the real target for required adoption and conflicts (see [Platform YAML Configuration Deployment](docs/platform-yaml-config-deployment.en.md)).
- **Surface-specific E2E routing** — validate web/Electron with `agent-browser`, and iOS, tvOS, macOS, Android, and Vega OS TV with `agent-device`
- **Shared HTML report contract (`html-report`)** — human-facing reports (qa, explain-diff, deep-interview, prometheus, ultraresearch, review-report, create-slides) are written directly as one self-contained HTML file with inline SVG diagrams, with no Mermaid/`mmdc` pre-render. The shared `html-report` skill owns the authoring contract (a graph of 3+ nodes must be SVG with visible edges, light/dark, 400–1280px, Korean-first) and the mandatory self-critique loop (`capture.sh` + `lint.sh`); `lint.sh --receipt` writes a receipt bound to the exact HTML bytes when lint has 0 errors. The loop applies differently per consumer: deep-interview, prometheus and explain-diff run `capture.sh` + strict `lint.sh` on a model-authored page and gate submission on the lint receipt; ultraresearch and review-report run the same loop without a receipt; qa's page is renderer-owned, so it fixes only its `bigPictureSvg` figure and records other findings as renderer limitations; create-slides follows only the `html-report` section 7 diagram rules and has no capture/lint loop. Consumer skills reference it one-way as `${CLAUDE_SKILL_DIR}/../html-report/...`, and `make validate` checks that `html-report` is co-deployed in the same sync scope and platforms. deep-interview and prometheus have the model write the presentation HTML itself and require a matching lint receipt plus source coverage at submission (prometheus: `data-todo="<id>"` per plan TODO; deep-interview: one SVG figure per spec Mermaid diagram; its AI-facing spec intentionally stays Mermaid). qa's big picture is a model-authored, sanitized `bigPictureSvg`, AC satisfaction is derived from the referenced scenario results (there is no authored `satisfied` field), and `qa-state.ts validate-narrative` checks the narrative before rendering. review-report has no runtime CDN; the model writes an escaped HTML body into the template. In explain-diff the Markdown document stays the step-checked SSOT; at the render step the model authors the final HTML per `html-report` and the CLI proves the page carries the document's exact facts (diagram SVG byte-identical, code blocks verbatim, heading order, every text block (paragraphs, list items, table cells, component text) verbatim, commit hashes and changed paths, lint receipt).
- **QA enforcement gates** — qa blocks phase transitions, drivers, Stop, and completion until the actor-roster → story → user scenario → record → verdict → complete chain is satisfied (PLAN reachability probing remains available); Claude/Codex `qa-driver-guard.sh` / `codex-qa-driver-guard.sh` and the Codex `codex-qa-seed.sh` enforce the same state. Visual outcomes require claim reviews bound to evidence files; completion also requires an inspected final HTML receipt
- **QA story contracts and optional reusable cases** — qa reads the plan/issue/spec/PR itself and writes ACs as user-observable outcomes in the report language (a state file is never the source of requirements). The target environment is local unless the user names another; source or caller items for deploying, post-deploy observation, production records or follow-up PRs go to `## Out of QA Scope`, and PR/wiki provenance is requirements input only. An item qa cannot place is asked of the user before `set-acceptance`. Each actor carries `client_impact` (none|contract|render) with a reason, and a screen-render actor needs a screen-driven scenario with before/after screenshots (a scenario proven by an automated test carries no profile) per device profile in the per-project `~/.qa-cases/<projectKey>/device-profiles.yaml` (`qa-device-profiles.ts get|set|upsert|remove`; if unconfigured, show the built-in defaults and ask once, save them with `set --defaults` when the user does not know, `remove` unsupported platforms, `upsert` to fix a size or add a project screen; sizes are never guessed). Each such scenario's evidence review includes a layout claim checking clipping, overlap, horizontal scroll, and text wrap. New stories require a goal, non-empty Given/When/Then string arrays, and zero-based acceptance-criteria links, plus at least one H-priority scenario per story; each of the six risk tags must be covered by a scenario or declared with `declare-risk-na` and a reason. Old records remain readable but are not execution-ready. Once a cycle has evidence, contract changes are rejected. The optional case store records only its pointer and mode in the fixed external `~/.qa-cases/<projectKey>/manifest.yaml`; the store is on by default, keeping case metadata and assets in `~/.qa-cases/<projectKey>/cases`, and is `disabled` only when the user asks. The feature map (`~/.feature-maps/<project-key>/store`) is on by default too. A case is one scenario, found by feature (`feature_refs` are feature-map ids; `list --feature`). Each H scenario that passes by driving its boundary is recorded while driven, saved, replayed as the flaky-rerun, and linked with `record-case` (or `--none` with a reason); `complete` refuses while one has neither. A scenario that already has a result and is itself wrong is corrected with `amend-scenario --reason` (reason required): its result resets so it is re-run and re-recorded, the prior record stays in `scenario_amendments`, a stored verdict is removed, and no cycle is consumed. No project files are created without explicit opt-in, and native `.ad`, agent-browser command scripts, and Maestro formats remain unchanged. The `qa-replay.ts --help` replay command checks the active session's complete actor→story→scenario chain, current story/scenario/cycle, and hashes, then creates a receipt without recording PASS; optionally bind it with `qa-state.ts record-scenario --case-run` alongside actual boundary evidence (see the [Reusable QA Cases](skills/qa/reusable-cases.md) guide)
- **Ultragoal final-review convergence** — converge by priority: HIGH requires repair, checks, and a fresh review; MEDIUM requires repair and checks without re-review; LOW never blocks or triggers re-review and may be fixed in the same repair pass when local to changed code. The deterministic CLI denies COMMENT/APPROVE dispatch and re-review while retaining the five-dispatch window
- **Codex protected-skill trust boundary** — `disable-model-invocation: true` skills inject their body only from an explicit `$skill` UserPromptSubmit, direct `SKILL.md` shell reads are blocked, and the invocation marker is not authorization (see [Review/Quality](docs/skills/review-quality.en.md))
- **Compaction steering** — the `PreCompact` hook (`compact-instructions.sh`)'s plain stdout is folded directly into Claude Code's native compaction summary instructions (this event ignores a JSON `hookSpecificOutput`). It leaves no noise in the live session, and its wording was tuned through repeated blind-judged compaction replays. Claude-only, with no Codex twin (Codex's remote compaction path does not apply `compact_prompt`).
- **Session ledger** — Claude Code and Codex CLI write session ledgers in one format. The `PreCompact` hook (`session-ledger/`) extracts the transcript deterministically with a script and has a headless `codex exec` (gpt-6.1-sol, effort low) fill a JSON schema. The ledger holds only what the agent needs to continue as before the compaction; it does not track approvals or attach confirmation gates to next steps. Each decision records its rationale, who made it (user, agent, or agreed), and the ids of the messages it came from, and a decision in the previous ledger is carried into the next one unless it was replaced or its work is finished. A validator checks identifiers against the source, checks that decisions credited to the user (user or agreed) cite a user message, and sends violations back for a corrected attempt (up to 3; an attempt whose only violation is size is accepted without a retry). When no attempt passes, the attempt with the fewest problems is accepted with a list of the points it could not verify. A summarizer call that ends without output is retried once after 2 seconds; if it still returns none, the hook switches to headless Claude Code (claude-sonnet-5-5, effort high, no settings, hooks, or tools), which also gets one retry. Only when both return no output does the hook write a deterministic minimal ledger, and that ledger also carries the previous ledger and every user message. Standing rules (`working_rules`) keep only entries from the user's words or a loaded skill; rule and instruction files come back in full after a compaction, so summaries of them are dropped. The result is saved to `~/.omt/session-ledger/<session>.md`; right after a compaction, `SessionStart` injects its head plus an order to read the whole file. The main session makes no recording calls, and because the summarizer runs synchronously, a compaction usually takes three to four minutes longer, and up to about eight minutes when an identifier error forces a retry.

## Philosophy — Why This Design

**Step 1 — Prompts Belong Under Version Control**: Skills, rules, and docs are the inputs that determine an agent's behavior, so they deserve the same treatment as code. But the place they're actually read from is a `.claude/` scattered across each project — edit them there and the history is lost, and the next sync overwrites the edit anyway. So editing always happens in the library; targets only receive deployments.

**Step 2 — Conventions Differ per Project, and So Does the Vessel That Holds Them**: The same `testing` means "Classical TDD, no verify(), BDD structure" in `projects/toong-java-spring-template/` and something else entirely elsewhere. There are two ways to express that differentiation.

- **Skill override** (`projects/<name>/skills/`): during sync, **Upward Search** applies — when `sync.yaml` references `testing`, it looks in the project folder first and falls back to the global `skills/testing/`. Use this to swap a whole convention wholesale.
- **rules index + docs grounding** (`projects/<name>/rules/`, `projects/<name>/docs/`): when a convention is too large for a single skill, split it across rules and docs. `loopers-kotlin-spring-template` (19 docs + 7 rules) keeps its rules a pure index — they say only which document to open. `loop-pack-fe-l2-vol1` (26 docs + 9 rules) puts frequently-used criteria directly in the rules and defers only the deeper grounding to docs. Either way the point is to bound what stays always-loaded.

**Step 3 — The Same Content Sits in a Different Place on Each Platform**: Claude uses `.claude/`, Codex splits across `.codex/` and `.agents/`, Gemini uses `.gemini/` — directory layout and supported categories differ across the board. Adapters absorb that difference, so a convention is written once and `sync.yaml`'s `platforms` decides which platforms it reaches and how far.

## Documentation

The details of the library's skills (48) and agents (13) live under `docs/`.

| Doc | Contents |
|-----|----------|
| [Core Pipeline](docs/skills/core-pipeline.en.md) | Definition→Planning→Execution→Verification pipeline (deep-interview → craft-tasks → optional prometheus → ultragoal → sisyphus; sisyphus is ultragoal's internal executor, not a direct route) + 13 delegation agents |
| [Review/Quality](docs/skills/review-quality.en.md) | code-review · design-review · slides-review · qa · explain-diff (optional reusable QA cases: [guide](skills/qa/reusable-cases.md)) |
| [Frontend Design](docs/skills/frontend-design.en.md) | frontend · visual-qa — web UI design, implementation, and independent rendered-result verification |
| [Research](docs/skills/research.en.md) | ultraresearch · insane-browsing — saturation research engine and blocked-source browsing |
| [Authoring/Utilities](docs/skills/authoring.en.md) | html-report · create-slides · technical-writing · technical-copywriting · humanizer · make-pr · scan-pdf-to-notes · git-master |
| [Knowledge Graph (pins)](docs/skills/knowledge-graph-pins.en.md) | pins knowledge graph — pin-setup · record · query · audit · wrap-up |
| [Utilities & Personal Workflows](docs/skills/utilities-personal.en.md) | agent-device · agent-browser · dogfood · hud · read-db · resume · jd · mock-interview, etc. |
| [Orchestration Guide](docs/ORCHESTRATION.en.md) | deep-interview → craft-tasks → optional prometheus → ultragoal → sisyphus workflow (sisyphus is ultragoal's internal executor, not a direct route) and usage |
| [Model Assignment](docs/model-assignment.en.md) | Per-agent model tier principles and `model-map` substitution rules |
| [Platform YAML Configuration Deployment](docs/platform-yaml-config-deployment.en.md) | Deployment, merge, and deletion rules for platform-specific settings, hooks, and MCPs |
| [Outbound Local-Reference Gate](docs/outbound-local-reference-gate.en.md) | Predicate, scope, and remedies for local-path references sent to commits, PR creates/edits/comments, Notion, Slack, and Linear |

## Quick Start

### Prerequisites

- Claude Code CLI installed
- Node.js v18+ (for HUD functionality)
- `agent-browser` CLI (the `html-report` skill's `capture.sh` and `lint.sh` use it to drive headless Chrome)
- `jq` (hooks parse payloads with it — most guards fail open when it is unavailable, but `codex-spawn-context-gate.sh` and `codex-spawn-role-gate.sh` deny the call)
- `sqlite3` (the Codex detector queries the `state_5.sqlite` state database with it — when unavailable, the detector counts zero and emits one stderr diagnostic)
- macOS or Linux

The `mmdc`/Mermaid renderer is no longer provisioned. Human-facing reports are written directly as one HTML file with inline SVG, following the `html-report` skill.

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

   `make sync` fails unless the current branch is the default branch and the working tree has no staged, unstaged, or untracked changes — synchronization only runs after a commit. There is no dedicated env var or CLI flag that turns the gate off, though redirecting `HOME` can still bypass it via your ambient global git config. `make sync-dry` is exempt from this gate, so it stays usable as a preview even before committing. See `docs/sync-deploy-targets.md` (Korean) for the gate's exact scope and trade-offs. `make sync` runs validation, tests, and deployment under `taskpolicy -b` (macOS background priority), so it yields CPU and disk I/O to other work and may run slower.

### Git lifecycle hooks (Husky)

This repository uses Husky v9. Dependency installation runs `prepare: husky`, activating `.husky/_/` wrappers that route to the tracked plain hook files. `pre-commit` runs `bun run lint`; `pre-push` runs `bun run lint` and then `make test` only when lint succeeds.

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

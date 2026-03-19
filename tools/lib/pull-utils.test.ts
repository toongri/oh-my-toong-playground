import { describe, it, expect } from "bun:test";

import { parseFrontmatter } from "./frontmatter.ts";
import {
  resolveDeployedPath,
  resolveSourcePath,
  reversePlatformPaths,
  stripInjectedFrontmatter,
} from "./pull-utils.ts";

// ---------------------------------------------------------------------------
// resolveDeployedPath
// ---------------------------------------------------------------------------

describe("resolveDeployedPath", () => {
  it("returns file path with `.md` suffix for agents", () => {
    const result = resolveDeployedPath("/proj", "claude", "agents", "oracle");
    expect(result).toBe("/proj/.claude/agents/oracle.md");
  });

  it("returns file path with `.md` suffix for commands", () => {
    const result = resolveDeployedPath("/proj", "claude", "commands", "commit");
    expect(result).toBe("/proj/.claude/commands/commit.md");
  });

  it("returns file path with `.md` suffix for rules", () => {
    const result = resolveDeployedPath("/proj", "claude", "rules", "coding");
    expect(result).toBe("/proj/.claude/rules/coding.md");
  });

  it("returns directory path without suffix for skills", () => {
    const result = resolveDeployedPath("/proj", "claude", "skills", "oracle");
    expect(result).toBe("/proj/.claude/skills/oracle");
  });

  it("returns directory path without suffix for scripts", () => {
    const result = resolveDeployedPath("/proj", "claude", "scripts", "hud");
    expect(result).toBe("/proj/.claude/scripts/hud");
  });

  it("uses `.gemini/` directory for gemini platform", () => {
    const result = resolveDeployedPath("/proj", "gemini", "skills", "oracle");
    expect(result).toBe("/proj/.gemini/skills/oracle");
  });
});

// ---------------------------------------------------------------------------
// resolveSourcePath
// ---------------------------------------------------------------------------

describe("resolveSourcePath", () => {
  const ROOT = "/root/oh-my-toong";

  it("resolves global ref for skills to `{rootDir}/skills/{name}`", () => {
    const result = resolveSourcePath("oracle", "skills", ROOT);
    expect(result).toBe(`${ROOT}/skills/oracle`);
  });

  it("resolves global ref for commands to `{rootDir}/commands/{name}.md`", () => {
    const result = resolveSourcePath("commit", "commands", ROOT);
    expect(result).toBe(`${ROOT}/commands/commit.md`);
  });

  it("resolves scoped ref to `{rootDir}/projects/{project}/{category}/{name}`", () => {
    const result = resolveSourcePath("my-project:testing", "skills", ROOT);
    expect(result).toBe(`${ROOT}/projects/my-project/skills/testing`);
  });

  it("falls back to global path for unscoped ref when `projectDirName` is provided", () => {
    const result = resolveSourcePath("oracle", "skills", ROOT, "my-project");
    expect(result).toBe(`${ROOT}/skills/oracle`);
  });

  it("throws on cross-project scoped ref when `projectDirName` differs", () => {
    expect(() =>
      resolveSourcePath("other-project:testing", "skills", ROOT, "my-project"),
    ).toThrow("Cross-project reference not allowed");
  });

  it("allows same-project scoped ref when `projectDirName` matches", () => {
    const result = resolveSourcePath("my-project:testing", "skills", ROOT, "my-project");
    expect(result).toBe(`${ROOT}/projects/my-project/skills/testing`);
  });

  it("returns `.md` suffix for file-based categories (agents) on new component", () => {
    const result = resolveSourcePath("new-agent", "agents", ROOT);
    expect(result).toBe(`${ROOT}/agents/new-agent.md`);
  });
});

// ---------------------------------------------------------------------------
// reversePlatformPaths
// ---------------------------------------------------------------------------

describe("reversePlatformPaths", () => {
  it("replaces `.gemini/` with `.claude/`", () => {
    const content = "See .gemini/skills/oracle/ for details";
    const result = reversePlatformPaths(content, "gemini");
    expect(result).toBe("See .claude/skills/oracle/ for details");
  });

  it("replaces `.codex/` with `.claude/`", () => {
    const content = "See .codex/skills/oracle/ for details";
    const result = reversePlatformPaths(content, "codex");
    expect(result).toBe("See .claude/skills/oracle/ for details");
  });

  it("returns content unchanged for claude platform", () => {
    const content = "See .claude/skills/oracle/ for details";
    const result = reversePlatformPaths(content, "claude");
    expect(result).toBe(content);
  });

  it("replaces all occurrences in content", () => {
    const content = ".gemini/agents/oracle.md and .gemini/skills/prometheus/";
    const result = reversePlatformPaths(content, "gemini");
    expect(result).toBe(".claude/agents/oracle.md and .claude/skills/prometheus/");
  });
});

// ---------------------------------------------------------------------------
// stripInjectedFrontmatter
// ---------------------------------------------------------------------------

describe("stripInjectedFrontmatter", () => {
  const makeDeployedWithSkills = (skills: string[]) => `---
name: oracle
model: sonnet
skills:
${skills.map((s) => `  - ${s}`).join("\n")}
---

# Oracle body`;

  const makeSource = (extra: string = "") => `---
name: oracle
model: sonnet
${extra}---

# Oracle body`;

  it("removes `skills` key when `add-skills` present and source has no skills", () => {
    const deployed = makeDeployedWithSkills(["testing"]);
    const source = makeSource();
    const syncItem = { component: "oracle", "add-skills": ["testing"] };

    const result = stripInjectedFrontmatter(deployed, source, syncItem);

    const { frontmatter } = parseFrontmatter(result);
    expect("skills" in frontmatter).toBe(false);
  });

  it("restores source `skills` value when `add-skills` present and source has skills", () => {
    const deployed = makeDeployedWithSkills(["testing", "pre-existing"]);
    const source = makeSource("skills:\n  - pre-existing\n");
    const syncItem = { component: "oracle", "add-skills": ["testing"] };

    const result = stripInjectedFrontmatter(deployed, source, syncItem);

    const { frontmatter: fm } = parseFrontmatter(result);
    expect(fm["skills"]).toEqual(["pre-existing"]);
  });

  it("removes `hooks` key when `add-hooks` present and source has no hooks", () => {
    const deployed = `---
name: oracle
model: sonnet
hooks:
  SubagentStop:
    - matcher: "*"
      hooks:
        - type: command
          command: echo done
          timeout: 60
---

# Oracle body`;
    const source = makeSource();
    const syncItem = {
      component: "oracle",
      "add-hooks": [{ component: "stop-hook", event: "SubagentStop" }],
    };

    const result = stripInjectedFrontmatter(deployed, source, syncItem);

    const { frontmatter: fm } = parseFrontmatter(result);
    expect("hooks" in fm).toBe(false);
  });

  it("returns content unchanged for string sync items", () => {
    const deployed = makeDeployedWithSkills(["testing"]);
    const source = makeSource();
    const syncItem = "oracle";

    const result = stripInjectedFrontmatter(deployed, source, syncItem);

    expect(result).toBe(deployed);
  });

  it("returns content unchanged for object items without `add-skills`/`add-hooks`", () => {
    const deployed = makeDeployedWithSkills(["testing"]);
    const source = makeSource();
    const syncItem = { component: "oracle", platforms: ["claude"] as const };

    const result = stripInjectedFrontmatter(deployed, source, syncItem);

    expect(result).toBe(deployed);
  });

  it("preserves deployed body in result", () => {
    const deployedBody = "\n# Oracle body with DEPLOYED changes";
    const deployed = `---
name: oracle
model: sonnet
skills:
  - testing
---
${deployedBody}`;
    const source = makeSource();
    const syncItem = { component: "oracle", "add-skills": ["testing"] };

    const result = stripInjectedFrontmatter(deployed, source, syncItem);

    expect(result).toContain("DEPLOYED changes");
  });
});

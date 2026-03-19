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
  it("agents: .md suffix 붙은 파일 경로 반환", () => {
    const result = resolveDeployedPath("/proj", "claude", "agents", "oracle");
    expect(result).toBe("/proj/.claude/agents/oracle.md");
  });

  it("commands: .md suffix 붙은 파일 경로 반환", () => {
    const result = resolveDeployedPath("/proj", "claude", "commands", "commit");
    expect(result).toBe("/proj/.claude/commands/commit.md");
  });

  it("rules: .md suffix 붙은 파일 경로 반환", () => {
    const result = resolveDeployedPath("/proj", "claude", "rules", "coding");
    expect(result).toBe("/proj/.claude/rules/coding.md");
  });

  it("skills: suffix 없는 디렉터리 경로 반환", () => {
    const result = resolveDeployedPath("/proj", "claude", "skills", "oracle");
    expect(result).toBe("/proj/.claude/skills/oracle");
  });

  it("scripts: suffix 없는 디렉터리 경로 반환", () => {
    const result = resolveDeployedPath("/proj", "claude", "scripts", "hud");
    expect(result).toBe("/proj/.claude/scripts/hud");
  });

  it("gemini 플랫폼: .gemini/ 디렉터리 사용", () => {
    const result = resolveDeployedPath("/proj", "gemini", "skills", "oracle");
    expect(result).toBe("/proj/.gemini/skills/oracle");
  });
});

// ---------------------------------------------------------------------------
// resolveSourcePath
// ---------------------------------------------------------------------------

describe("resolveSourcePath", () => {
  const ROOT = "/root/oh-my-toong";

  it("글로벌 ref (skills): {rootDir}/skills/{name} 반환", () => {
    const result = resolveSourcePath("oracle", "skills", ROOT);
    expect(result).toBe(`${ROOT}/skills/oracle`);
  });

  it("글로벌 ref (commands): {rootDir}/commands/{name} 반환", () => {
    const result = resolveSourcePath("commit", "commands", ROOT);
    expect(result).toBe(`${ROOT}/commands/commit`);
  });

  it("스코프 ref: {rootDir}/projects/{project}/{category}/{name} 반환", () => {
    const result = resolveSourcePath("my-project:testing", "skills", ROOT);
    expect(result).toBe(`${ROOT}/projects/my-project/skills/testing`);
  });

  it("projectDirName 제공 시 언스코프 ref는 글로벌 경로로 fallback", () => {
    const result = resolveSourcePath("oracle", "skills", ROOT, "my-project");
    expect(result).toBe(`${ROOT}/skills/oracle`);
  });
});

// ---------------------------------------------------------------------------
// reversePlatformPaths
// ---------------------------------------------------------------------------

describe("reversePlatformPaths", () => {
  it("gemini: .gemini/ → .claude/ 치환", () => {
    const content = "See .gemini/skills/oracle/ for details";
    const result = reversePlatformPaths(content, "gemini");
    expect(result).toBe("See .claude/skills/oracle/ for details");
  });

  it("codex: .codex/ → .claude/ 치환", () => {
    const content = "See .codex/skills/oracle/ for details";
    const result = reversePlatformPaths(content, "codex");
    expect(result).toBe("See .claude/skills/oracle/ for details");
  });

  it("claude: 내용 그대로 반환", () => {
    const content = "See .claude/skills/oracle/ for details";
    const result = reversePlatformPaths(content, "claude");
    expect(result).toBe(content);
  });

  it("여러 번 등장하는 경우 모두 치환", () => {
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

  it("add-skills 있고 소스에 skills 없음: deployed에서 skills 키 제거", () => {
    const deployed = makeDeployedWithSkills(["testing"]);
    const source = makeSource();
    const syncItem = { component: "oracle", "add-skills": ["testing"] };

    const result = stripInjectedFrontmatter(deployed, source, syncItem);

    const { frontmatter } = parseFrontmatter(result);
    expect("skills" in frontmatter).toBe(false);
  });

  it("add-skills 있고 소스에 skills 있음: 소스의 skills 값으로 복원", () => {
    const deployed = makeDeployedWithSkills(["testing", "pre-existing"]);
    const source = makeSource("skills:\n  - pre-existing\n");
    const syncItem = { component: "oracle", "add-skills": ["testing"] };

    const result = stripInjectedFrontmatter(deployed, source, syncItem);

    const { frontmatter: fm } = parseFrontmatter(result);
    expect(fm["skills"]).toEqual(["pre-existing"]);
  });

  it("add-hooks 있고 소스에 hooks 없음: deployed에서 hooks 키 제거", () => {
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

  it("string 아이템: 내용 그대로 반환", () => {
    const deployed = makeDeployedWithSkills(["testing"]);
    const source = makeSource();
    const syncItem = "oracle";

    const result = stripInjectedFrontmatter(deployed, source, syncItem);

    expect(result).toBe(deployed);
  });

  it("add-skills/add-hooks 없는 오브젝트 아이템: 내용 그대로 반환", () => {
    const deployed = makeDeployedWithSkills(["testing"]);
    const source = makeSource();
    const syncItem = { component: "oracle", platforms: ["claude"] as const };

    const result = stripInjectedFrontmatter(deployed, source, syncItem);

    expect(result).toBe(deployed);
  });

  it("deployed body가 결과에 보존됨", () => {
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

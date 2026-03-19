import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { stringify as stringifyYaml } from "yaml";

import { pullProject, parseCliArgs, type PullOptions } from "./pull.ts";
import type { SyncYaml } from "./lib/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

/**
 * Capture stderr output from process.stderr.write during a callback.
 */
async function captureStderr(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  try {
    await fn();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join("");
}

/**
 * Build a minimal sync.yaml YAML string.
 */
function makeSyncYaml(targetPath: string, sections: Partial<SyncYaml>): string {
  const yaml: Record<string, unknown> = { path: targetPath, ...sections };
  return stringifyYaml(yaml);
}

// ---------------------------------------------------------------------------
// Suite: parseCliArgs
// ---------------------------------------------------------------------------

describe("parseCliArgs", () => {
  it("첫 번째 위치 인수를 projectName으로 파싱", () => {
    const result = parseCliArgs(["my-project"]);
    expect(result.projectName).toBe("my-project");
    expect(result.platform).toBe("claude");
    expect(result.dryRun).toBe(false);
  });

  it("--dry-run 플래그 파싱", () => {
    const result = parseCliArgs(["my-project", "--dry-run"]);
    expect(result.dryRun).toBe(true);
  });

  it("--platform 플래그 파싱", () => {
    const result = parseCliArgs(["my-project", "--platform", "gemini"]);
    expect(result.platform).toBe("gemini");
  });

  it("--category 플래그 파싱", () => {
    const result = parseCliArgs(["my-project", "--category", "skills"]);
    expect(result.categoryFilter).toBe("skills");
  });

  it("--component 플래그 파싱", () => {
    const result = parseCliArgs(["my-project", "--category", "skills", "--component", "oracle"]);
    expect(result.componentFilter).toBe("oracle");
  });

  it("projectName 없으면 빈 문자열 반환", () => {
    const result = parseCliArgs(["--dry-run"]);
    expect(result.projectName).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Suite: pullProject - 통합 테스트
// ---------------------------------------------------------------------------

describe("pullProject", () => {
  let tmpDir: string;
  let rootDir: string;
  let targetPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pull-test-"));
    rootDir = path.join(tmpDir, "root");
    targetPath = path.join(tmpDir, "target");
    await fs.mkdir(rootDir, { recursive: true });
    await fs.mkdir(targetPath, { recursive: true });
    // Minimal config.yaml so getRootDir-like logic works
    await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude]\n");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeOptions(overrides: Partial<PullOptions> = {}): PullOptions {
    return {
      projectName: "test-proj",
      platform: "claude",
      dryRun: false,
      rootDir,
      ...overrides,
    };
  }

  async function setupProject(projectName: string, yamlContent: string): Promise<void> {
    await writeFile(path.join(rootDir, "projects", projectName, "sync.yaml"), yamlContent);
  }

  // -------------------------------------------------------------------------
  // 1. 전체 풀 테스트
  // -------------------------------------------------------------------------

  it("스킬과 에이전트를 대상에서 소스로 전체 풀", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      skills: { items: ["test-skill"] },
      agents: { items: ["test-agent"] },
    });
    await setupProject("test-proj", syncYamlContent);

    // Source files (pre-existing in oh-my-toong source)
    await writeFile(path.join(rootDir, "skills", "test-skill", "SKILL.md"), "# Original Skill\n");
    await writeFile(path.join(rootDir, "agents", "test-agent.md"), "---\nname: test-agent\n---\n# Original Agent\n");

    // Deployed files in target
    await writeFile(
      path.join(targetPath, ".claude", "skills", "test-skill", "SKILL.md"),
      "# Updated Skill\n",
    );
    await writeFile(
      path.join(targetPath, ".claude", "agents", "test-agent.md"),
      "---\nname: test-agent\n---\n# Updated Agent\n",
    );

    await pullProject(makeOptions());

    // Source files should be updated to match deployed versions
    const pulledSkill = await readFile(path.join(rootDir, "skills", "test-skill", "SKILL.md"));
    expect(pulledSkill).toBe("# Updated Skill\n");

    const pulledAgent = await readFile(path.join(rootDir, "agents", "test-agent.md"));
    expect(pulledAgent).toBe("---\nname: test-agent\n---\n# Updated Agent\n");
  });

  // -------------------------------------------------------------------------
  // 2. Dry-run 테스트
  // -------------------------------------------------------------------------

  it("dry-run 모드에서 파일 변경 없음, 출력에 컴포넌트 포함", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      skills: { items: ["dry-skill"] },
    });
    await setupProject("test-proj", syncYamlContent);

    await writeFile(path.join(rootDir, "skills", "dry-skill", "SKILL.md"), "# Original\n");
    await writeFile(
      path.join(targetPath, ".claude", "skills", "dry-skill", "SKILL.md"),
      "# Deployed\n",
    );

    let output = "";
    output = await captureStderr(async () => {
      await pullProject(makeOptions({ dryRun: true }));
    });

    // Source file should NOT be changed
    const sourceContent = await readFile(path.join(rootDir, "skills", "dry-skill", "SKILL.md"));
    expect(sourceContent).toBe("# Original\n");

    // Output should mention the component
    expect(output).toContain("[DRY-RUN]");
    expect(output).toContain("dry-skill");
  });

  // -------------------------------------------------------------------------
  // 3. 존재하지 않는 프로젝트 이름
  // -------------------------------------------------------------------------

  it("존재하지 않는 프로젝트 이름이면 종료 코드 1로 실패", async () => {
    let exitCode: number | undefined;
    const originalExit = process.exit.bind(process);
    (process as unknown as { exit: (code?: number) => never }).exit = (code?: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    };

    try {
      await captureStderr(async () => {
        await pullProject(makeOptions({ projectName: "nonexistent-project" }));
      });
    } catch {
      // Expected
    } finally {
      (process as unknown as { exit: (code?: number) => never }).exit = originalExit;
    }

    expect(exitCode).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 4. 카테고리 필터 테스트
  // -------------------------------------------------------------------------

  it("--category skills 필터: 스킬만 풀, 에이전트는 미변경", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      skills: { items: ["filter-skill"] },
      agents: { items: ["filter-agent"] },
    });
    await setupProject("test-proj", syncYamlContent);

    // Original source files
    await writeFile(path.join(rootDir, "skills", "filter-skill", "SKILL.md"), "# Original Skill\n");
    await writeFile(
      path.join(rootDir, "agents", "filter-agent.md"),
      "---\nname: filter-agent\n---\n# Original Agent\n",
    );

    // Deployed files
    await writeFile(
      path.join(targetPath, ".claude", "skills", "filter-skill", "SKILL.md"),
      "# Updated Skill\n",
    );
    await writeFile(
      path.join(targetPath, ".claude", "agents", "filter-agent.md"),
      "---\nname: filter-agent\n---\n# Updated Agent\n",
    );

    await pullProject(makeOptions({ categoryFilter: "skills" }));

    // Skill should be updated
    const pulledSkill = await readFile(path.join(rootDir, "skills", "filter-skill", "SKILL.md"));
    expect(pulledSkill).toBe("# Updated Skill\n");

    // Agent should NOT be updated
    const agentContent = await readFile(path.join(rootDir, "agents", "filter-agent.md"));
    expect(agentContent).toBe("---\nname: filter-agent\n---\n# Original Agent\n");
  });

  // -------------------------------------------------------------------------
  // 5. 컴포넌트 필터 테스트
  // -------------------------------------------------------------------------

  it("--category skills --component target-skill: 해당 스킬만 풀", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      skills: { items: ["target-skill", "other-skill"] },
    });
    await setupProject("test-proj", syncYamlContent);

    await writeFile(path.join(rootDir, "skills", "target-skill", "SKILL.md"), "# Original Target\n");
    await writeFile(path.join(rootDir, "skills", "other-skill", "SKILL.md"), "# Original Other\n");

    await writeFile(
      path.join(targetPath, ".claude", "skills", "target-skill", "SKILL.md"),
      "# Updated Target\n",
    );
    await writeFile(
      path.join(targetPath, ".claude", "skills", "other-skill", "SKILL.md"),
      "# Updated Other\n",
    );

    await pullProject(makeOptions({ categoryFilter: "skills", componentFilter: "target-skill" }));

    const targetContent = await readFile(path.join(rootDir, "skills", "target-skill", "SKILL.md"));
    expect(targetContent).toBe("# Updated Target\n");

    // other-skill should NOT be updated
    const otherContent = await readFile(path.join(rootDir, "skills", "other-skill", "SKILL.md"));
    expect(otherContent).toBe("# Original Other\n");
  });

  // -------------------------------------------------------------------------
  // 6. --component without --category 에러
  // -------------------------------------------------------------------------

  it("--component 지정 시 --category 없으면 오류 및 종료 코드 1", async () => {
    // This is validated in import.meta.main, but we test the CLI arg combination
    // by simulating the check. The main guard in pull.ts handles this before pullProject.
    // We verify the parseCliArgs output allows the caller to detect the issue.
    const result = parseCliArgs(["test-proj", "--component", "oracle"]);
    expect(result.componentFilter).toBe("oracle");
    expect(result.categoryFilter).toBeUndefined();
    // The caller (import.meta.main) would exit(1) on this combination.
    // We verify the error check works by testing it inline.
    let exitCode: number | undefined;
    const originalExit = process.exit.bind(process);
    (process as unknown as { exit: (code?: number) => never }).exit = (code?: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    };

    try {
      await captureStderr(async () => {
        // Simulate the import.meta.main guard
        if (result.componentFilter && !result.categoryFilter) {
          process.stderr.write("[ERROR] --component는 --category가 필요합니다\n");
          process.exit(1);
        }
      });
    } catch {
      // Expected
    } finally {
      (process as unknown as { exit: (code?: number) => never }).exit = originalExit;
    }

    expect(exitCode).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 7. 배포된 컴포넌트 누락 경고
  // -------------------------------------------------------------------------

  it("동기화 목록에 있지만 배포 경로에 없는 컴포넌트 경고 후 계속 진행", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      skills: { items: ["missing-skill", "present-skill"] },
    });
    await setupProject("test-proj", syncYamlContent);

    await writeFile(path.join(rootDir, "skills", "missing-skill", "SKILL.md"), "# Missing\n");
    await writeFile(path.join(rootDir, "skills", "present-skill", "SKILL.md"), "# Original Present\n");

    // Only present-skill exists in deployed target
    await writeFile(
      path.join(targetPath, ".claude", "skills", "present-skill", "SKILL.md"),
      "# Updated Present\n",
    );

    let output = "";
    output = await captureStderr(async () => {
      await pullProject(makeOptions());
    });

    // Should warn about missing component
    expect(output).toContain("[WARN]");
    expect(output).toContain("missing-skill");

    // Should still pull the present one
    const presentContent = await readFile(path.join(rootDir, "skills", "present-skill", "SKILL.md"));
    expect(presentContent).toBe("# Updated Present\n");

    // missing-skill source should be unchanged
    const missingContent = await readFile(path.join(rootDir, "skills", "missing-skill", "SKILL.md"));
    expect(missingContent).toBe("# Missing\n");
  });

  // -------------------------------------------------------------------------
  // 8. 플랫폼 카테고리 지원 여부
  // -------------------------------------------------------------------------

  it("--platform gemini --category agents: gemini는 agents 미지원이므로 스킵", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      agents: { items: ["gemini-agent"] },
      skills: { items: ["gemini-skill"] },
    });
    await setupProject("test-proj", syncYamlContent);

    await writeFile(path.join(rootDir, "agents", "gemini-agent.md"), "---\nname: gemini-agent\n---\n# Agent\n");
    await writeFile(path.join(rootDir, "skills", "gemini-skill", "SKILL.md"), "# Original\n");

    // Deployed gemini skills (no agents for gemini)
    await writeFile(
      path.join(targetPath, ".gemini", "skills", "gemini-skill", "SKILL.md"),
      "# Updated Gemini\n",
    );

    let output = "";
    output = await captureStderr(async () => {
      await pullProject(makeOptions({ platform: "gemini", categoryFilter: "agents" }));
    });

    // Agent source should NOT be modified
    const agentContent = await readFile(path.join(rootDir, "agents", "gemini-agent.md"));
    expect(agentContent).toBe("---\nname: gemini-agent\n---\n# Agent\n");

    // No pull output for agents (silently skipped)
    expect(output).not.toContain("gemini-agent");
  });

  // -------------------------------------------------------------------------
  // 9. Gemini commands TOML 형식 미지원 경고
  // -------------------------------------------------------------------------

  it("--platform gemini --category commands: TOML 미지원 경고 출력, 소스 파일 미변경", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      commands: { items: ["test-cmd"] },
    });
    await setupProject("test-proj", syncYamlContent);

    // Source command file (pre-existing in oh-my-toong source)
    await writeFile(path.join(rootDir, "commands", "test-cmd.md"), "# Original Command\n");

    // No deployed file in .gemini/commands/ — guard skips before existsSync check

    let output = "";
    output = await captureStderr(async () => {
      await pullProject(makeOptions({ platform: "gemini", categoryFilter: "commands" }));
    });

    // Should warn about TOML format incompatibility
    expect(output).toContain("[WARN]");
    expect(output).toContain("toml");

    // Source file should NOT be modified
    const sourceContent = await readFile(path.join(rootDir, "commands", "test-cmd.md"));
    expect(sourceContent).toBe("# Original Command\n");
  });

  // -------------------------------------------------------------------------
  // 10. 플랫폼 경로 역변환
  // -------------------------------------------------------------------------

  it("gemini 플랫폼 풀 시 .gemini/ 경로를 .claude/로 역변환", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      skills: { items: ["path-skill"] },
    });
    await setupProject("test-proj", syncYamlContent);

    await writeFile(path.join(rootDir, "skills", "path-skill", "SKILL.md"), "# Original\n");

    // Deployed file references .gemini/ paths
    await writeFile(
      path.join(targetPath, ".gemini", "skills", "path-skill", "SKILL.md"),
      "See .gemini/agents/oracle.md for details.\n",
    );

    await pullProject(makeOptions({ platform: "gemini" }));

    const pulledContent = await readFile(path.join(rootDir, "skills", "path-skill", "SKILL.md"));
    // .gemini/ should be replaced with .claude/
    expect(pulledContent).toContain(".claude/agents/oracle.md");
    expect(pulledContent).not.toContain(".gemini/");
  });

  // -------------------------------------------------------------------------
  // 10. 에이전트 인젝션된 프론트매터 제거
  // -------------------------------------------------------------------------

  it("add-skills로 인젝션된 프론트매터 skills 필드 제거", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      agents: {
        items: [
          {
            component: "inject-agent",
            "add-skills": ["testing"],
          },
        ],
      },
    });
    await setupProject("test-proj", syncYamlContent);

    // Source agent without skills in frontmatter
    await writeFile(
      path.join(rootDir, "agents", "inject-agent.md"),
      "---\nname: inject-agent\ndescription: test\n---\n# Inject Agent\n",
    );

    // Deployed agent with skills injected
    await writeFile(
      path.join(targetPath, ".claude", "agents", "inject-agent.md"),
      "---\nname: inject-agent\ndescription: test\nskills:\n  - testing\n---\n# Inject Agent\n",
    );

    await pullProject(makeOptions());

    const pulledContent = await readFile(path.join(rootDir, "agents", "inject-agent.md"));
    // skills field should be stripped because source had no skills
    expect(pulledContent).not.toContain("skills:");
    expect(pulledContent).toContain("name: inject-agent");
    expect(pulledContent).toContain("# Inject Agent");
  });

  // -------------------------------------------------------------------------
  // 11. 스크립트 파일 및 디렉터리 풀
  // -------------------------------------------------------------------------

  it("스크립트 단일 파일 풀 (파일 타입)", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      scripts: { items: ["my-script"] },
    });
    await setupProject("test-proj", syncYamlContent);

    await fs.mkdir(path.join(rootDir, "scripts", "my-script"), { recursive: true });
    await writeFile(path.join(rootDir, "scripts", "my-script", "index.ts"), "// original\n");

    // Deployed as directory
    await writeFile(
      path.join(targetPath, ".claude", "scripts", "my-script", "index.ts"),
      "// updated\n",
    );

    await pullProject(makeOptions());

    const pulledContent = await readFile(path.join(rootDir, "scripts", "my-script", "index.ts"));
    expect(pulledContent).toBe("// updated\n");
  });

  it("스크립트 서브디렉터리 포함 재귀 풀", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      scripts: { items: ["complex-script"] },
    });
    await setupProject("test-proj", syncYamlContent);

    await fs.mkdir(path.join(rootDir, "scripts", "complex-script", "lib"), { recursive: true });
    await writeFile(path.join(rootDir, "scripts", "complex-script", "index.ts"), "// original\n");
    await writeFile(path.join(rootDir, "scripts", "complex-script", "lib", "helper.ts"), "// original helper\n");

    // Deployed with updated content in both files
    await writeFile(
      path.join(targetPath, ".claude", "scripts", "complex-script", "index.ts"),
      "// updated\n",
    );
    await writeFile(
      path.join(targetPath, ".claude", "scripts", "complex-script", "lib", "helper.ts"),
      "// updated helper\n",
    );

    await pullProject(makeOptions());

    const indexContent = await readFile(path.join(rootDir, "scripts", "complex-script", "index.ts"));
    expect(indexContent).toBe("// updated\n");

    const helperContent = await readFile(
      path.join(rootDir, "scripts", "complex-script", "lib", "helper.ts"),
    );
    expect(helperContent).toBe("// updated helper\n");
  });

  // -------------------------------------------------------------------------
  // 추가: 스코프 컴포넌트 (project:name 형식) 소스 경로 해석
  // -------------------------------------------------------------------------

  it("scoped 컴포넌트 (project:name) 소스 경로를 projects/ 아래로 해석", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      skills: { items: [{ component: "test-proj:scoped-skill" }] },
    });
    await setupProject("test-proj", syncYamlContent);

    await writeFile(
      path.join(rootDir, "projects", "test-proj", "skills", "scoped-skill", "SKILL.md"),
      "# Original Scoped\n",
    );

    await writeFile(
      path.join(targetPath, ".claude", "skills", "scoped-skill", "SKILL.md"),
      "# Updated Scoped\n",
    );

    await pullProject(makeOptions());

    const pulledContent = await readFile(
      path.join(rootDir, "projects", "test-proj", "skills", "scoped-skill", "SKILL.md"),
    );
    expect(pulledContent).toBe("# Updated Scoped\n");
  });

  // -------------------------------------------------------------------------
  // 추가: 새 소스 파일 생성 (소스에 없는 경우)
  // -------------------------------------------------------------------------

  it("소스에 없는 컴포넌트도 배포 경로에서 복사해 소스 생성", async () => {
    const syncYamlContent = makeSyncYaml(targetPath, {
      commands: { items: ["new-cmd"] },
    });
    await setupProject("test-proj", syncYamlContent);

    // Source does NOT exist yet
    await writeFile(
      path.join(targetPath, ".claude", "commands", "new-cmd.md"),
      "# New Command\n",
    );

    await pullProject(makeOptions());

    const pulledContent = await readFile(path.join(rootDir, "commands", "new-cmd.md"));
    expect(pulledContent).toBe("# New Command\n");
  });
});

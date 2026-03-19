/**
 * oh-my-toong Pull Orchestrator
 *
 * CLI entry point for pulling deployed component files back to oh-my-toong source.
 * Inverse of sync.ts: reads a project's sync.yaml and copies from target to source.
 *
 * Usage:
 *   bun run tools/pull.ts <project-name> [--platform <name>] [--category <name>] [--component <name>] [--dry-run]
 */

import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { parse as parseYaml } from "yaml";

import type { SyncYaml, SyncItem, Category, Platform } from "./lib/types.ts";
import { getRootDir } from "./lib/config.ts";
import { CATEGORIES, SUPPORTED_CATEGORIES } from "./sync.ts";
import { resolvePlatforms } from "./lib/resolver.ts";
import {
  FILE_BASED_CATEGORIES,
  resolveDeployedPath,
  resolveSourcePath,
  reversePlatformPaths,
  stripInjectedFrontmatter,
} from "./lib/pull-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PullOptions = {
  projectName: string;
  platform: Platform;
  categoryFilter?: Category;
  componentFilter?: string;
  dryRun: boolean;
  rootDir: string;
};

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

export function printUsage(): void {
  process.stderr.write(
    [
      "Usage: bun tools/pull.ts <project-name> [options]",
      "",
      "Arguments:",
      "  <project-name>         Directory name under projects/ (required)",
      "",
      "Options:",
      "  --platform <name>      Target platform (default: claude)",
      "  --category <name>      Pull only this category",
      "  --component <name>     Pull only this component (requires --category)",
      "  --dry-run              Preview changes without writing files",
      "  --help                 Show this help message",
      "",
    ].join("\n"),
  );
}

export function parseCliArgs(args: string[]): {
  projectName: string;
  platform: Platform;
  categoryFilter?: Category;
  componentFilter?: string;
  dryRun: boolean;
} {
  let projectName = "";
  let platform: Platform = "claude";
  let categoryFilter: Category | undefined;
  let componentFilter: string | undefined;
  let dryRun = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--platform") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        process.stderr.write("[ERROR] --platform 플래그에 값이 필요합니다 (예: --platform gemini)\n");
        process.exit(1);
      }
      platform = value as Platform;
      i++;
    } else if (arg === "--category") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        process.stderr.write("[ERROR] --category 플래그에 값이 필요합니다 (예: --category skills)\n");
        process.exit(1);
      }
      categoryFilter = value as Category;
      i++;
    } else if (arg === "--component") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        process.stderr.write("[ERROR] --component 플래그에 값이 필요합니다 (예: --component oracle)\n");
        process.exit(1);
      }
      componentFilter = value;
      i++;
    } else if (arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("--")) {
      process.stderr.write(`[WARN] 알 수 없는 플래그: ${arg}\n`);
    } else if (!projectName) {
      projectName = arg;
    }

    i++;
  }

  return { projectName, platform, categoryFilter, componentFilter, dryRun };
}

// ---------------------------------------------------------------------------
// File copy helpers
// ---------------------------------------------------------------------------

async function copyFile(srcPath: string, destPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, content, "utf8");
}

/**
 * Recursively copy a directory, applying reversePlatformPaths to .md files.
 */
async function copyDirectory(
  deployedDir: string,
  sourceDir: string,
  platform: Platform,
): Promise<void> {
  await fs.mkdir(sourceDir, { recursive: true });
  const entries = await fs.readdir(deployedDir, { withFileTypes: true });
  for (const entry of entries) {
    const deployedEntry = path.join(deployedDir, entry.name);
    const sourceEntry = path.join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(deployedEntry, sourceEntry, platform);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".md")) {
        let content = await fs.readFile(deployedEntry, "utf8");
        content = reversePlatformPaths(content, platform);
        await copyFile(deployedEntry, sourceEntry, content);
      } else {
        await fs.mkdir(path.dirname(sourceEntry), { recursive: true });
        await fs.copyFile(deployedEntry, sourceEntry);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Core pull logic
// ---------------------------------------------------------------------------

/**
 * Main pull orchestration function.
 * Reads a project's sync.yaml and pulls deployed files back to oh-my-toong source.
 */
export async function pullProject(options: PullOptions): Promise<void> {
  const { projectName, platform, categoryFilter, componentFilter, dryRun, rootDir } = options;

  const syncYamlPath = path.join(rootDir, "projects", projectName, "sync.yaml");

  // Validate project exists
  if (!existsSync(syncYamlPath)) {
    process.stderr.write(`[ERROR] Project not found: projects/${projectName}/sync.yaml\n`);
    process.exit(1);
  }

  // Parse sync.yaml
  let syncYaml: SyncYaml;
  try {
    const rawText = await fs.readFile(syncYamlPath, "utf8");
    const parsed = parseYaml(rawText);
    if (parsed == null || typeof parsed !== "object") {
      process.stderr.write(`[ERROR] YAML이 비어 있거나 유효한 객체가 아님: ${syncYamlPath}\n`);
      process.exit(1);
    }
    syncYaml = parsed as SyncYaml;
  } catch (err) {
    process.stderr.write(`[ERROR] YAML 파싱 실패: ${syncYamlPath}: ${err}\n`);
    process.exit(1);
  }

  const targetPath = syncYaml.path;
  if (!targetPath) {
    process.stderr.write(`[ERROR] path가 정의되지 않음: ${syncYamlPath}\n`);
    process.exit(1);
  }

  if (dryRun) {
    process.stderr.write("[WARN] ========== DRY-RUN 모드 (실제 변경 없음) ==========\n");
  }

  // Iterate categories
  for (const category of CATEGORIES) {
    // Check platform supports this category
    const supported = SUPPORTED_CATEGORIES[platform];
    if (!supported || !supported.has(category)) {
      continue;
    }

    // Apply category filter
    if (categoryFilter && category !== categoryFilter) {
      continue;
    }

    const section = syncYaml[category as keyof SyncYaml] as
      | { platforms?: Platform[]; items?: SyncItem[] }
      | undefined;

    if (!section || !Array.isArray(section.items) || section.items.length === 0) {
      continue;
    }

    for (const item of section.items) {
      // Normalize item to get componentRef and componentName
      let componentRef: string;
      let syncItem: SyncItem;

      if (typeof item === "string") {
        componentRef = item;
        syncItem = item;
      } else {
        componentRef = item.component;
        syncItem = item;
      }

      // Extract just the component name (strip project prefix for matching)
      const componentName = componentRef.includes(":")
        ? componentRef.slice(componentRef.indexOf(":") + 1)
        : componentRef;

      // Apply component filter (match against parsed component name)
      if (componentFilter && componentName !== componentFilter) {
        continue;
      }

      // Check format compatibility: gemini commands use .toml format which cannot be reversed
      if (platform === "gemini" && category === "commands") {
        process.stderr.write(`[WARN] gemini 커맨드 .toml 형식 미지원 (스킵): ${componentName}\n`);
        continue;
      }

      // Check platform cascade: skip items not targeting the current platform
      const itemPlatforms = await resolvePlatforms(syncItem, section.platforms, syncYaml.platforms, category);
      if (!itemPlatforms.includes(platform)) {
        continue;
      }

      // Resolve paths
      const deployedPath = resolveDeployedPath(targetPath, platform, category, componentName);
      const sourcePathBase = resolveSourcePath(componentRef, category, rootDir, projectName);
      // File-based categories use .md suffix in source (mirrors resolveDeployedPath behavior)
      const sourcePath = FILE_BASED_CATEGORIES.has(category)
        ? `${sourcePathBase}.md`
        : sourcePathBase;

      // Check deployed path exists
      if (!existsSync(deployedPath)) {
        process.stderr.write(`[WARN] 배포된 컴포넌트 없음 (스킵): ${deployedPath}\n`);
        continue;
      }

      // Log or perform the pull
      const arrow = "→";
      if (dryRun) {
        process.stderr.write(`[DRY-RUN] [${category}] ${componentName}: ${deployedPath} ${arrow} ${sourcePath}\n`);
        continue;
      }

      // Perform file copy
      if (FILE_BASED_CATEGORIES.has(category)) {
        // File-based: read, transform, write
        let deployedContent = await fs.readFile(deployedPath, "utf8");
        deployedContent = reversePlatformPaths(deployedContent, platform);

        // For agents: strip injected frontmatter if add-skills/add-hooks present
        if (category === "agents") {
          let sourceContent = "";
          if (existsSync(sourcePath)) {
            sourceContent = await fs.readFile(sourcePath, "utf8");
          }
          deployedContent = stripInjectedFrontmatter(deployedContent, sourceContent, syncItem);
        }

        await copyFile(deployedPath, sourcePath, deployedContent);
      } else {
        // Directory-based: recursive copy
        await copyDirectory(deployedPath, sourcePath, platform);
      }

      process.stderr.write(`[${category}] ${componentName}: ${deployedPath} ${arrow} ${sourcePath}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const { projectName, platform, categoryFilter, componentFilter, dryRun } = parseCliArgs(args);

  if (!projectName) {
    process.stderr.write("[ERROR] <project-name>이 필요합니다\n");
    printUsage();
    process.exit(1);
  }

  if (componentFilter && !categoryFilter) {
    process.stderr.write("[ERROR] --component는 --category가 필요합니다\n");
    process.exit(1);
  }

  const rootDir = getRootDir();
  if (!rootDir) {
    process.stderr.write("[ERROR] config.yaml를 찾을 수 없음. 실행 위치를 확인하세요.\n");
    process.exit(1);
  }

  await pullProject({
    projectName,
    platform,
    categoryFilter,
    componentFilter,
    dryRun,
    rootDir,
  });

  process.exit(0);
}

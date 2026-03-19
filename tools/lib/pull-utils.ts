import path from "path";
import { existsSync } from "fs";

import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import type { Category, Platform, SyncItem } from "./types.ts";

// ---------------------------------------------------------------------------
// resolveDeployedPath
// ---------------------------------------------------------------------------

export const FILE_BASED_CATEGORIES: Set<Category> = new Set(["agents", "commands", "rules"]);

/**
 * Constructs the deployed file/directory path in the target project.
 *
 * Pattern: {targetPath}/.{platform}/{category}/{name}[.md]
 *
 * File-based categories (agents, commands, rules): append .md suffix.
 * Directory-based categories (skills, scripts): no suffix.
 */
export function resolveDeployedPath(
  targetPath: string,
  platform: Platform,
  category: Category,
  componentName: string,
): string {
  const suffix = FILE_BASED_CATEGORIES.has(category) ? ".md" : "";
  return path.join(targetPath, `.${platform}`, category, `${componentName}${suffix}`);
}

// ---------------------------------------------------------------------------
// resolveSourcePath
// ---------------------------------------------------------------------------

/**
 * Resolves the oh-my-toong source path where pulled content should be written.
 *
 * Checks filesystem to match resolveComponentPath's fallback chain
 * (.md → index.md → SKILL.md → directory). Falls back to default path
 * computation when no existing file is found (new component case).
 *
 * Returns the fully-resolved path including file extension for file-based
 * categories (agents, commands, rules).
 *
 * Scoped refs:  "project:name" → {rootDir}/projects/{project}/{category}/{name}
 * Global refs:  "name"         → {rootDir}/{category}/{name}
 */
export function resolveSourcePath(
  componentRef: string,
  category: Category,
  rootDir: string,
  projectDirName?: string,
): string {
  let project = "";
  let name = componentRef;

  if (componentRef.includes(":")) {
    const colonIndex = componentRef.indexOf(":");
    project = componentRef.slice(0, colonIndex);
    name = componentRef.slice(colonIndex + 1);
  }

  // Cross-project validation (mirrors resolveComponentPath in resolver.ts)
  if (project && projectDirName !== undefined && project !== projectDirName) {
    throw new Error(
      `Cross-project reference not allowed: ${componentRef} (current project: ${projectDirName})`,
    );
  }

  const baseDir = project
    ? path.join(rootDir, "projects", project, category)
    : path.join(rootDir, category);

  // Check filesystem for existing components (mirrors tryResolveInDir in resolver.ts)
  const resolved = tryResolveExisting(baseDir, name, category);
  if (resolved !== null) return resolved;

  // Default path for new components
  if (FILE_BASED_CATEGORIES.has(category)) {
    return path.join(baseDir, `${name}.md`);
  }
  return path.join(baseDir, name);
}

/**
 * Mirrors tryResolveInDir from resolver.ts — checks existing filesystem locations.
 */
function tryResolveExisting(dir: string, name: string, category: string): string | null {
  const filePath = path.join(dir, `${name}.md`);
  if (existsSync(filePath)) return filePath;

  const indexPath = path.join(dir, name, "index.md");
  if (existsSync(indexPath)) return indexPath;

  if (category === "skills") {
    const skillPath = path.join(dir, name, "SKILL.md");
    if (existsSync(skillPath)) return path.join(dir, name);
  }

  const dirPath = path.join(dir, name);
  if (existsSync(dirPath)) return dirPath;

  return null;
}

// ---------------------------------------------------------------------------
// reversePlatformPaths
// ---------------------------------------------------------------------------

/**
 * Replaces .{platform}/ with .claude/ in file content.
 *
 * Inverse of rewritePlatformPaths() in sync.ts.
 * If platform is "claude", content is returned unchanged.
 */
export function reversePlatformPaths(content: string, platform: Platform): string {
  if (platform === "claude") return content;
  return content.replace(new RegExp(`\\.${platform}\\/`, "g"), ".claude/");
}

// ---------------------------------------------------------------------------
// stripInjectedFrontmatter
// ---------------------------------------------------------------------------

/**
 * Removes frontmatter fields injected by push (add-skills / add-hooks) so that
 * pulled content matches the oh-my-toong source.
 *
 * Algorithm:
 *   1. If syncItem is a string or has no add-skills/add-hooks, return deployedContent as-is.
 *   2. Parse deployed and source frontmatters.
 *   3. For add-skills: restore source's skills value (or delete the key if source had none).
 *   4. For add-hooks:  restore source's hooks  value (or delete the key if source had none).
 *   5. Return serializeFrontmatter(modified, deployedBody).
 */
export function stripInjectedFrontmatter(
  deployedContent: string,
  sourceContent: string,
  syncItem: SyncItem,
): string {
  if (typeof syncItem === "string") return deployedContent;

  const hasAddSkills = "add-skills" in syncItem && syncItem["add-skills"] !== undefined;
  const hasAddHooks = "add-hooks" in syncItem && syncItem["add-hooks"] !== undefined;

  if (!hasAddSkills && !hasAddHooks) return deployedContent;

  const { frontmatter: deployedFm, body: deployedBody } = parseFrontmatter(deployedContent);
  const { frontmatter: sourceFm } = parseFrontmatter(sourceContent);

  const fm = { ...deployedFm };

  if (hasAddSkills) {
    if ("skills" in sourceFm) {
      fm["skills"] = sourceFm["skills"];
    } else {
      delete fm["skills"];
    }
  }

  if (hasAddHooks) {
    if ("hooks" in sourceFm) {
      fm["hooks"] = sourceFm["hooks"];
    } else {
      delete fm["hooks"];
    }
  }

  return serializeFrontmatter(fm, deployedBody);
}

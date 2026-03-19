import path from "path";

import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import type { Category, Platform, SyncItem } from "./types.ts";

// ---------------------------------------------------------------------------
// resolveDeployedPath
// ---------------------------------------------------------------------------

const FILE_BASED_CATEGORIES: Set<Category> = new Set(["agents", "commands", "rules"]);

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
 * Computes the oh-my-toong source path where pulled content should be written.
 *
 * Pure path computation — does NOT check filesystem existence.
 *
 * Scoped refs:  "project:name" → {rootDir}/projects/{project}/{category}/{name}
 * Global refs:  "name"         → {rootDir}/{category}/{name}
 *
 * When projectDirName is provided, unscoped refs still resolve to global paths
 * (mirrors the global fallback in resolveComponentPath).
 */
export function resolveSourcePath(
  componentRef: string,
  category: Category,
  rootDir: string,
  projectDirName?: string,
): string {
  if (componentRef.includes(":")) {
    const colonIndex = componentRef.indexOf(":");
    const project = componentRef.slice(0, colonIndex);
    const name = componentRef.slice(colonIndex + 1);
    return path.join(rootDir, "projects", project, category, name);
  }

  return path.join(rootDir, category, componentRef);
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

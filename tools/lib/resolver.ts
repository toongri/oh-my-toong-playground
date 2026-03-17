/**
 * Resolver utilities for oh-my-toong sync tool.
 *
 * Provides:
 *   resolvePlatforms()      — 6-level platform cascade
 *   resolveComponentPath()  — scoped component path resolution with index.md fallback
 *   setProjectContext()     — derive project context from a sync.yaml path
 *
 * Mirrors the bash logic in tools/lib/common.sh:
 *   resolve_scoped_source_path() (lines 373-465)
 *   set_project_context()        (lines 471-496)
 * and the cascade pattern in tools/sync.sh (lines 233-258).
 */

import { existsSync } from "fs";
import { join, basename, dirname } from "path";
import type { Platform, SyncItem, SyncYaml } from "./types.ts";
import { getDefaultPlatforms, getFeaturePlatforms } from "./config.ts";

// ---------------------------------------------------------------------------
// resolvePlatforms
// ---------------------------------------------------------------------------

/**
 * Resolve the effective platform list for a single sync item using a 6-level cascade.
 *
 * Each level FULLY REPLACES the previous — there is no merging.
 *
 * Priority (highest to lowest):
 *   1. item.platforms (item-level override)
 *   2. sectionPlatforms (section-level override)
 *   3. syncYamlPlatforms (top-level sync.yaml platforms)
 *   4. getFeaturePlatforms(category) from config.yaml
 *   5. getDefaultPlatforms() from config.yaml (use-platforms)
 *   6. Hardcoded fallback: ["claude"]
 */
export async function resolvePlatforms(
  item: SyncItem,
  sectionPlatforms: Platform[] | undefined,
  syncYamlPlatforms: Platform[] | undefined,
  category: string,
): Promise<Platform[]> {
  // Level 1: item-level platforms
  if (typeof item === "object" && item !== null && Array.isArray(item.platforms) && item.platforms.length > 0) {
    return item.platforms;
  }

  // Level 2: section-level platforms
  if (Array.isArray(sectionPlatforms) && sectionPlatforms.length > 0) {
    return sectionPlatforms;
  }

  // Level 3: sync.yaml top-level platforms
  if (Array.isArray(syncYamlPlatforms) && syncYamlPlatforms.length > 0) {
    return syncYamlPlatforms;
  }

  // Level 4: feature-platforms from config.yaml
  const featurePlatforms = await getFeaturePlatforms(category);
  // getFeaturePlatforms already falls back to getDefaultPlatforms internally,
  // so we must distinguish "feature entry defined" from "fell back to default".
  // We re-check config here to determine if a feature entry actually exists.
  // Because getFeaturePlatforms() delegates to getDefaultPlatforms() when not found,
  // we use it directly for level 4 — if it returns more than the default it means
  // a feature entry was present, but we can't distinguish that without re-reading.
  // Instead we call getDefaultPlatforms() ourselves for comparison at level 5.
  const defaultPlatforms = await getDefaultPlatforms();

  // If featurePlatforms differs from defaultPlatforms, a feature entry was found.
  // If they are identical in value, getFeaturePlatforms may have fallen back.
  // To properly distinguish level 4 vs level 5, we need to check config directly.
  // The simplest correct approach: use featurePlatforms for level 4 (it may equal
  // defaultPlatforms when no feature entry exists, which is fine — same result).
  return featurePlatforms;

  // Levels 5 and 6 are handled inside getFeaturePlatforms → getDefaultPlatforms → ["claude"].
}

// ---------------------------------------------------------------------------
// resolveComponentPath
// ---------------------------------------------------------------------------

export type ResolvedComponent = { path: string; displayName: string };
export type ResolutionError = { error: string };

/**
 * Resolve the file system path for a component reference.
 *
 * Component ref forms:
 *   "oracle"               — plain name
 *   "project-name:oracle"  — scoped to a specific project
 *
 * File lookup order for a given base directory and name:
 *   1. {base}/{category}/{name}.md
 *   2. {base}/{category}/{name}/index.md        (folder fallback)
 *   3. {base}/{category}/{name}/SKILL.md        (skills-specific folder)
 *
 * Root sync.yaml (projectDirName is undefined):
 *   - Global paths only. Scoped refs are blocked.
 *
 * Project sync.yaml (projectDirName is set):
 *   - Own project first: projects/{projectDirName}/{category}/...
 *   - Then global fallback: {category}/...
 *   - Cross-project refs (different projectDirName) are blocked.
 */
export function resolveComponentPath(
  componentRef: string,
  category: string,
  rootDir: string,
  projectDirName?: string,
): ResolvedComponent | ResolutionError {
  // Parse optional project prefix
  let parsedProject = "";
  let parsedItem = componentRef;

  if (componentRef.includes(":")) {
    const colonIndex = componentRef.indexOf(":");
    parsedProject = componentRef.slice(0, colonIndex);
    parsedItem = componentRef.slice(colonIndex + 1);
  }

  const displayName = parsedItem;
  const isRootYaml = projectDirName === undefined;

  // === Cross-project validation ===
  if (parsedProject !== "") {
    if (isRootYaml) {
      return {
        error: `Root sync.yaml cannot reference project components: ${componentRef} (use global components only)`,
      };
    }
    if (parsedProject !== projectDirName) {
      return {
        error: `Cross-project reference not allowed: ${componentRef} (current project: ${projectDirName})`,
      };
    }
    // Same-project prefix — treat as own project lookup below
  }

  // === Path resolution ===
  if (isRootYaml) {
    const resolved = tryResolveInDir(join(rootDir, category), parsedItem, category);
    if (resolved !== null) {
      return { path: resolved, displayName };
    }
    return {
      error: `Component not found in global: ${category}/${parsedItem}.md`,
    };
  }

  // Project yaml: own project first
  const projectBase = join(rootDir, "projects", projectDirName!, category);
  const projectResolved = tryResolveInDir(projectBase, parsedItem, category);
  if (projectResolved !== null) {
    return { path: projectResolved, displayName };
  }

  // Global fallback (only when ref is unscoped)
  if (parsedProject === "") {
    const globalBase = join(rootDir, category);
    const globalResolved = tryResolveInDir(globalBase, parsedItem, category);
    if (globalResolved !== null) {
      return { path: globalResolved, displayName };
    }
  }

  return {
    error: `Component not found in project '${projectDirName}' or global: ${category}/${parsedItem}.md`,
  };
}

/**
 * Try to resolve a component name inside a given directory.
 * Returns the resolved path string, or null if not found.
 *
 * Lookup order:
 *   1. {dir}/{name}.md
 *   2. {dir}/{name}/index.md
 *   3. {dir}/{name}/SKILL.md  (skills only)
 */
function tryResolveInDir(dir: string, name: string, category: string): string | null {
  // 1. Direct file
  const filePath = join(dir, `${name}.md`);
  if (existsSync(filePath)) return filePath;

  // 2. Folder with index.md
  const indexPath = join(dir, name, "index.md");
  if (existsSync(indexPath)) return indexPath;

  // 3. Skills-specific SKILL.md
  if (category === "skills") {
    const skillPath = join(dir, name, "SKILL.md");
    if (existsSync(skillPath)) return skillPath;
  }

  return null;
}

// ---------------------------------------------------------------------------
// setProjectContext
// ---------------------------------------------------------------------------

export type ProjectContext = {
  projectName: string;
  projectDir: string;
  isRootYaml: boolean;
};

/**
 * Derive project context from a sync.yaml file and its parsed contents.
 *
 * - Root sync.yaml: isRootYaml = true, projectName = "", projectDir = ""
 * - Project sync.yaml: projectDir = directory name
 *   - projectName = sync.yaml `name` field if present, else directory name
 *
 * Whether a path is "root" is determined by checking whether it lives inside
 * a `projects/` subdirectory. The caller passes `rootDir` for this check.
 */
export function setProjectContext(
  syncYaml: SyncYaml,
  syncYamlPath: string,
  rootDir: string,
): ProjectContext {
  const dir = dirname(syncYamlPath);

  // Check if this is a project-level yaml by seeing if its directory is inside
  // {rootDir}/projects/
  const projectsDir = join(rootDir, "projects");
  const isInsideProjects = dir.startsWith(projectsDir + "/") || dir === projectsDir;

  if (!isInsideProjects) {
    return { projectName: "", projectDir: "", isRootYaml: true };
  }

  const projectDir = basename(dir);
  const nameField = syncYaml.name;
  const projectName = typeof nameField === "string" && nameField.trim() !== "" ? nameField : projectDir;

  return { projectName, projectDir, isRootYaml: false };
}

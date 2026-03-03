import { readdir } from 'fs/promises';
import { readFileSync } from 'fs';
import { join } from 'path';

// Scan a single directory for skill subdirectories
// Returns directory names (skill names), empty array on any error
async function scanDirectory(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // Directory doesn't exist or can't be read — not an error
    return [];
  }
}

// Scan both skill directories and return deduplicated skill names
export async function scanSkillDirectories(cwd: string): Promise<string[]> {
  const homeDir = process.env.HOME || '/tmp';

  const projectSkillsDir = join(cwd, '.claude', 'skills');
  const userSkillsDir = join(homeDir, '.claude', 'skills');

  const [projectSkills, userSkills] = await Promise.all([
    scanDirectory(projectSkillsDir),
    scanDirectory(userSkillsDir),
  ]);

  // Deduplicate: project skills take precedence (same name = one entry)
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of [...projectSkills, ...userSkills]) {
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }

  return result;
}

// Read enabled plugin IDs from ~/.claude/settings.json
export function readEnabledPlugins(): Set<string> {
  try {
    const homeDir = process.env.HOME || '/tmp';
    const settingsPath = join(homeDir, '.claude', 'settings.json');
    const raw = readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(raw);
    const enabledPlugins = settings.enabledPlugins;

    if (!enabledPlugins || typeof enabledPlugins !== 'object') {
      return new Set();
    }

    const result = new Set<string>();
    for (const [pluginId, enabled] of Object.entries(enabledPlugins)) {
      if (enabled === true) {
        result.add(pluginId);
      }
    }
    return result;
  } catch {
    // File missing, parse error, or any other issue — return empty Set
    return new Set();
  }
}

import { readdir } from 'fs/promises';
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

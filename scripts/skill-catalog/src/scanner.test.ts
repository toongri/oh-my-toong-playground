import { scanSkillDirectories } from './scanner.js';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('scanSkillDirectories', () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'skill-catalog-test-'));
    originalHome = process.env.HOME;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('scans project .claude/skills/ directory', async () => {
    const projectDir = join(tempDir, 'project');
    const skillsDir = join(projectDir, '.claude', 'skills');
    await mkdir(join(skillsDir, 'prometheus'), { recursive: true });
    await mkdir(join(skillsDir, 'oracle'), { recursive: true });

    // Set HOME to a dir with no skills
    const fakeHome = join(tempDir, 'fakehome');
    await mkdir(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;

    const skills = await scanSkillDirectories(projectDir);
    expect(skills).toContain('prometheus');
    expect(skills).toContain('oracle');
    expect(skills).toHaveLength(2);
  });

  it('scans user ~/.claude/skills/ directory', async () => {
    const projectDir = join(tempDir, 'project');
    await mkdir(projectDir, { recursive: true });

    const fakeHome = join(tempDir, 'fakehome');
    const userSkillsDir = join(fakeHome, '.claude', 'skills');
    await mkdir(join(userSkillsDir, 'git-committer'), { recursive: true });
    process.env.HOME = fakeHome;

    const skills = await scanSkillDirectories(projectDir);
    expect(skills).toContain('git-committer');
    expect(skills).toHaveLength(1);
  });

  it('scans both directories and deduplicates', async () => {
    const projectDir = join(tempDir, 'project');
    const projectSkillsDir = join(projectDir, '.claude', 'skills');
    await mkdir(join(projectSkillsDir, 'shared-skill'), { recursive: true });
    await mkdir(join(projectSkillsDir, 'project-only'), { recursive: true });

    const fakeHome = join(tempDir, 'fakehome');
    const userSkillsDir = join(fakeHome, '.claude', 'skills');
    await mkdir(join(userSkillsDir, 'shared-skill'), { recursive: true });
    await mkdir(join(userSkillsDir, 'user-only'), { recursive: true });
    process.env.HOME = fakeHome;

    const skills = await scanSkillDirectories(projectDir);
    expect(skills).toContain('shared-skill');
    expect(skills).toContain('project-only');
    expect(skills).toContain('user-only');
    // shared-skill appears only once
    expect(skills.filter((s) => s === 'shared-skill')).toHaveLength(1);
    expect(skills).toHaveLength(3);
  });

  it('returns empty array when directories do not exist', async () => {
    const nonexistentDir = join(tempDir, 'nonexistent');
    const fakeHome = join(tempDir, 'fakehome');
    await mkdir(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;

    const skills = await scanSkillDirectories(nonexistentDir);
    expect(skills).toEqual([]);
  });

  it('ignores files (only returns directories)', async () => {
    const projectDir = join(tempDir, 'project');
    const skillsDir = join(projectDir, '.claude', 'skills');
    await mkdir(join(skillsDir, 'real-skill'), { recursive: true });
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, 'not-a-skill.txt'), 'ignored');

    const fakeHome = join(tempDir, 'fakehome');
    await mkdir(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;

    const skills = await scanSkillDirectories(projectDir);
    expect(skills).toEqual(['real-skill']);
  });
});

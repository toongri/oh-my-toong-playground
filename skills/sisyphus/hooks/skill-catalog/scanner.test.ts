import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { scanSkillDirectories, readEnabledPlugins } from './scanner.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { writeFileSync, mkdirSync } from 'fs';
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
    await mkdir(join(userSkillsDir, 'git-master'), { recursive: true });
    process.env.HOME = fakeHome;

    const skills = await scanSkillDirectories(projectDir);
    expect(skills).toContain('git-master');
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

describe('readEnabledPlugins', () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'enabled-plugins-test-'));
    originalHome = process.env.HOME;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('settings.json 없을 때 빈 Set 반환', () => {
    const fakeHome = join(tempDir, 'fakehome');
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;

    const result = readEnabledPlugins();
    expect(result.size).toBe(0);
  });

  it('enabledPlugins 키 없을 때 빈 Set 반환', () => {
    const fakeHome = join(tempDir, 'fakehome');
    const claudeDir = join(fakeHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ otherKey: true }));
    process.env.HOME = fakeHome;

    const result = readEnabledPlugins();
    expect(result.size).toBe(0);
  });

  it('정상 케이스: 활성화된 플러그인 ID Set 반환', () => {
    const fakeHome = join(tempDir, 'fakehome');
    const claudeDir = join(fakeHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify({
        enabledPlugins: {
          'superpowers@claude-plugins-official': true,
          'other-plugin@vendor': true,
        },
      }),
    );
    process.env.HOME = fakeHome;

    const result = readEnabledPlugins();
    expect(result.size).toBe(2);
    expect(result.has('superpowers@claude-plugins-official')).toBe(true);
    expect(result.has('other-plugin@vendor')).toBe(true);
  });

  it('비활성화(false) 플러그인은 제외', () => {
    const fakeHome = join(tempDir, 'fakehome');
    const claudeDir = join(fakeHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify({
        enabledPlugins: {
          'superpowers@claude-plugins-official': true,
          'disabled-plugin@vendor': false,
        },
      }),
    );
    process.env.HOME = fakeHome;

    const result = readEnabledPlugins();
    expect(result.size).toBe(1);
    expect(result.has('superpowers@claude-plugins-official')).toBe(true);
    expect(result.has('disabled-plugin@vendor')).toBe(false);
  });
});

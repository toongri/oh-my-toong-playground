import { describe, it, expect } from 'bun:test';
import { SKILL_HASHMAP, buildCatalog, formatCatalog } from './catalog.ts';

const SUPERPOWERS_PLUGIN = 'superpowers@claude-plugins-official';

describe('SKILL_HASHMAP', () => {
  it('TDD skill is present with correct key', () => {
    expect(SKILL_HASHMAP.has('superpowers:test-driven-development')).toBe(true);
  });

  it('TDD skill has description, criteria, and examples', () => {
    const tdd = SKILL_HASHMAP.get('superpowers:test-driven-development')!;
    expect(tdd.description).toContain('Test-Driven Development');
    expect(tdd.criteria).toBe('Implementation task that produces testable code');
    expect(tdd.examples).toHaveLength(3);
    expect(tdd.examples[0]).toContain('rate limiting');
    expect(tdd.examples[1]).toContain('user service CRUD');
    expect(tdd.examples[2]).toContain('authentication bug');
  });

  it('TDD skill에 pluginId가 설정되어 있다', () => {
    const tdd = SKILL_HASHMAP.get('superpowers:test-driven-development')!;
    expect(tdd.pluginId).toBe(SUPERPOWERS_PLUGIN);
  });
});

describe('buildCatalog', () => {
  it('플러그인 활성화 시 superpowers 스킬이 카탈로그에 포함된다', () => {
    const enabledPlugins = new Set([SUPERPOWERS_PLUGIN]);
    const entries = buildCatalog([], enabledPlugins);
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const tdd = entries.find((e) => e.name === 'superpowers:test-driven-development');
    expect(tdd).toBeDefined();
    expect(tdd!.discoveredOnly).toBe(false);
    expect(tdd!.description).toBeDefined();
    expect(tdd!.criteria).toBeDefined();
    expect(tdd!.examples).toBeDefined();
  });

  it('플러그인 비활성화 시 superpowers 스킬이 카탈로그에서 제외된다', () => {
    const entries = buildCatalog([], new Set());

    const tdd = entries.find((e) => e.name === 'superpowers:test-driven-development');
    expect(tdd).toBeUndefined();
  });

  it('discovered-only skills get name-only entries', () => {
    const entries = buildCatalog(['my-custom-skill'], new Set());
    const custom = entries.find((e) => e.name === 'my-custom-skill');
    expect(custom).toBeDefined();
    expect(custom!.discoveredOnly).toBe(true);
    expect(custom!.description).toBeUndefined();
    expect(custom!.criteria).toBeUndefined();
    expect(custom!.examples).toBeUndefined();
  });

  it('discovered skill matching hashmap gets full entry', () => {
    const entries = buildCatalog(['superpowers:test-driven-development'], new Set());
    const tdd = entries.find((e) => e.name === 'superpowers:test-driven-development');
    expect(tdd).toBeDefined();
    expect(tdd!.discoveredOnly).toBe(false);
    expect(tdd!.description).toContain('Test-Driven Development');
  });

  it('플러그인 활성화 + 스킬 디스커버리 시 중복 없이 하나만 포함된다', () => {
    const enabledPlugins = new Set([SUPERPOWERS_PLUGIN]);
    const entries = buildCatalog(['superpowers:test-driven-development'], enabledPlugins);
    const tddEntries = entries.filter((e) => e.name === 'superpowers:test-driven-development');
    expect(tddEntries).toHaveLength(1);
  });

  it('combines plugin-enabled and discovered skills correctly', () => {
    const enabledPlugins = new Set([SUPERPOWERS_PLUGIN]);
    const entries = buildCatalog(['prometheus', 'oracle'], enabledPlugins);
    const names = entries.map((e) => e.name);
    expect(names).toContain('superpowers:test-driven-development'); // plugin-enabled
    expect(names).toContain('prometheus'); // discovered-only
    expect(names).toContain('oracle'); // discovered-only
  });
});

describe('formatCatalog', () => {
  it('formats hashmap entries with description, criteria, and examples', () => {
    const enabledPlugins = new Set([SUPERPOWERS_PLUGIN]);
    const entries = buildCatalog([], enabledPlugins);
    const output = formatCatalog(entries);

    expect(output).toContain('<skill-catalog>');
    expect(output).toContain('</skill-catalog>');
    expect(output).toContain('## Available Skills for Delegation');
    expect(output).toContain('superpowers:test-driven-development');
    expect(output).toContain('Criteria:');
    expect(output).toContain('Examples:');
    expect(output).toContain('sisyphus-junior');
  });

  it('formats discovered-only entries with generic note', () => {
    const entries = buildCatalog(['my-skill'], new Set());
    const output = formatCatalog(entries);

    expect(output).toContain('my-skill: Available (invoke Skill(skill: "my-skill") to load');
    expect(output).toContain('no selection criteria defined, evaluate by name)');
  });

  it('contains delegation instruction', () => {
    const entries = buildCatalog([], new Set());
    const output = formatCatalog(entries);

    expect(output).toContain('When delegating to sisyphus-junior, evaluate the above skills against the task.');
    expect(output).toContain('Include relevant skills in ## 7. MANDATORY SKILLS section.');
  });
});

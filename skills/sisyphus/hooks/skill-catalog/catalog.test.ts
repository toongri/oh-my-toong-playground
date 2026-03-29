import { describe, it, expect } from 'bun:test';
import { SITUATIONS, SKILL_HASHMAP, getAvailableHashmapEntries, buildCatalog, formatCatalog } from './catalog.ts';

const SUPERPOWERS_PLUGIN = 'superpowers@claude-plugins-official';

describe('SITUATIONS', () => {
  it('5개의 상황이 정의되어 있다', () => {
    expect(SITUATIONS).toHaveLength(5);
  });

  it('모든 상황이 id, label, reasoning을 가진다', () => {
    for (const situation of SITUATIONS) {
      expect(situation.id).toBeTruthy();
      expect(situation.label).toBeTruthy();
      expect(situation.reasoning).toBeTruthy();
    }
  });

  it('required situation ids are present', () => {
    const ids = SITUATIONS.map((s) => s.id);
    expect(ids).toContain('bugfix');
    expect(ids).toContain('new-feature');
    expect(ids).toContain('refactoring');
    expect(ids).toContain('design');
    expect(ids).toContain('analytics');
  });
});

describe('SKILL_HASHMAP', () => {
  it('6개의 스킬이 정의되어 있다', () => {
    expect(SKILL_HASHMAP.size).toBe(6);
  });

  it('TDD 스킬이 올바른 키로 존재한다', () => {
    expect(SKILL_HASHMAP.has('superpowers:test-driven-development')).toBe(true);
  });

  it('TDD 스킬은 pluginId와 situationIds를 가진다', () => {
    const tdd = SKILL_HASHMAP.get('superpowers:test-driven-development')!;
    expect(tdd.pluginId).toBe(SUPERPOWERS_PLUGIN);
    expect(tdd.situationIds).toContain('bugfix');
    expect(tdd.situationIds).toContain('new-feature');
    expect(tdd.situationIds).toContain('refactoring');
  });

  it('TDD 스킬에 criteria, examples 필드가 없다', () => {
    const tdd = SKILL_HASHMAP.get('superpowers:test-driven-development')!;
    expect((tdd as any).criteria).toBeUndefined();
    expect((tdd as any).examples).toBeUndefined();
  });

  it('testing 스킬은 pluginId 없이 situationIds를 가진다', () => {
    const testing = SKILL_HASHMAP.get('testing')!;
    expect(testing).toBeDefined();
    expect(testing.pluginId).toBeUndefined();
    expect(testing.situationIds).toContain('bugfix');
    expect(testing.situationIds).toContain('new-feature');
  });

  it('implement 스킬은 bugfix, new-feature, refactoring situationIds를 가진다', () => {
    const impl = SKILL_HASHMAP.get('implement')!;
    expect(impl).toBeDefined();
    expect(impl.situationIds).toContain('bugfix');
    expect(impl.situationIds).toContain('new-feature');
    expect(impl.situationIds).toContain('refactoring');
  });

  it('frontend-design 스킬은 new-feature, design situationIds를 가진다', () => {
    const fd = SKILL_HASHMAP.get('frontend-design')!;
    expect(fd).toBeDefined();
    expect(fd.situationIds).toContain('new-feature');
    expect(fd.situationIds).toContain('design');
  });

  it('ux-design 스킬은 design situationId만 가진다', () => {
    const ux = SKILL_HASHMAP.get('ux-design')!;
    expect(ux).toBeDefined();
    expect(ux.situationIds).toEqual(['design']);
  });

  it('pm-data-analytics 스킬은 analytics, new-feature situationIds를 가진다', () => {
    const pm = SKILL_HASHMAP.get('pm-data-analytics')!;
    expect(pm).toBeDefined();
    expect(pm.situationIds).toContain('analytics');
    expect(pm.situationIds).toContain('new-feature');
  });
});

describe('getAvailableHashmapEntries', () => {
  it('플러그인이 활성화되면 해당 스킬이 포함된다', () => {
    const result = getAvailableHashmapEntries([], [SUPERPOWERS_PLUGIN]);
    expect(result.has('superpowers:test-driven-development')).toBe(true);
  });

  it('플러그인이 비활성화되면 해당 스킬이 제외된다', () => {
    const result = getAvailableHashmapEntries([], []);
    expect(result.has('superpowers:test-driven-development')).toBe(false);
  });

  it('pluginId 없는 스킬은 discoveredSkillNames로 판단된다', () => {
    const result = getAvailableHashmapEntries(['testing', 'implement'], []);
    expect(result.has('testing')).toBe(true);
    expect(result.has('implement')).toBe(true);
  });

  it('발견되지 않은 스킬은 제외된다', () => {
    const result = getAvailableHashmapEntries([], []);
    expect(result.has('testing')).toBe(false);
    expect(result.has('frontend-design')).toBe(false);
  });

  it('반환 타입이 Map<string, HashmapSkillEntry>이다', () => {
    const result = getAvailableHashmapEntries(['testing'], []);
    expect(result).toBeInstanceOf(Map);
    const entry = result.get('testing')!;
    expect(entry.description).toBeTruthy();
    expect(entry.situationIds).toBeDefined();
  });
});

describe('buildCatalog', () => {
  it('플러그인 활성화 시 superpowers 스킬이 카탈로그에 포함된다', () => {
    const enabledPlugins = new Set([SUPERPOWERS_PLUGIN]);
    const entries = buildCatalog([], enabledPlugins);
    const tdd = entries.find((e) => e.name === 'superpowers:test-driven-development');
    expect(tdd).toBeDefined();
    expect(tdd!.discoveredOnly).toBe(false);
    expect(tdd!.description).toBeDefined();
  });

  it('플러그인 비활성화 시 superpowers 스킬이 카탈로그에서 제외된다', () => {
    const entries = buildCatalog([], new Set());
    const tdd = entries.find((e) => e.name === 'superpowers:test-driven-development');
    expect(tdd).toBeUndefined();
  });

  it('discovered-only 스킬은 name-only entry로 추가된다', () => {
    const entries = buildCatalog(['my-custom-skill'], new Set());
    const custom = entries.find((e) => e.name === 'my-custom-skill');
    expect(custom).toBeDefined();
    expect(custom!.discoveredOnly).toBe(true);
    expect(custom!.description).toBeUndefined();
  });

  it('플러그인 활성화 + 스킬 디스커버리 시 중복 없이 하나만 포함된다', () => {
    const enabledPlugins = new Set([SUPERPOWERS_PLUGIN]);
    const entries = buildCatalog(['superpowers:test-driven-development'], enabledPlugins);
    const tddEntries = entries.filter((e) => e.name === 'superpowers:test-driven-development');
    expect(tddEntries).toHaveLength(1);
  });

  it('CatalogEntry에 criteria, examples 필드가 없다', () => {
    const enabledPlugins = new Set([SUPERPOWERS_PLUGIN]);
    const entries = buildCatalog([], enabledPlugins);
    const tdd = entries.find((e) => e.name === 'superpowers:test-driven-development')!;
    expect((tdd as any).criteria).toBeUndefined();
    expect((tdd as any).examples).toBeUndefined();
  });
});

describe('formatCatalog', () => {
  it('skill-catalog 태그를 포함한다', () => {
    const availableHashmap = getAvailableHashmapEntries([], [SUPERPOWERS_PLUGIN]);
    const entries = buildCatalog([], new Set([SUPERPOWERS_PLUGIN]));
    const output = formatCatalog(entries, availableHashmap);
    expect(output).toContain('<skill-catalog>');
    expect(output).toContain('</skill-catalog>');
  });

  it('Load Skills 헤더를 포함한다', () => {
    const availableHashmap = getAvailableHashmapEntries([], [SUPERPOWERS_PLUGIN]);
    const entries = buildCatalog([], new Set([SUPERPOWERS_PLUGIN]));
    const output = formatCatalog(entries, availableHashmap);
    expect(output).toContain('## Load Skills');
  });

  it('상황별 테이블이 available 스킬을 포함한다', () => {
    const availableHashmap = getAvailableHashmapEntries([], [SUPERPOWERS_PLUGIN]);
    const entries = buildCatalog([], new Set([SUPERPOWERS_PLUGIN]));
    const output = formatCatalog(entries, availableHashmap);
    // TDD has bugfix, new-feature, refactoring situationIds
    expect(output).toContain('Bug fix');
    expect(output).toContain('superpowers:test-driven-development');
  });

  it('How to evaluate 섹션에 reasoning이 포함된다', () => {
    const availableHashmap = getAvailableHashmapEntries([], [SUPERPOWERS_PLUGIN]);
    const entries = buildCatalog([], new Set([SUPERPOWERS_PLUGIN]));
    const output = formatCatalog(entries, availableHashmap);
    expect(output).toContain('### How to evaluate');
    // bugfix situation reasoning
    expect(output).toContain('Defect reproduction');
  });

  it('refactoring 행에 testing 스킬이 포함되지 않는다', () => {
    // testing has situationIds ['bugfix', 'new-feature'] — NOT refactoring
    const availableHashmap = getAvailableHashmapEntries(['testing', 'implement'], []);
    const entries = buildCatalog(['testing', 'implement'], new Set());
    const output = formatCatalog(entries, availableHashmap);

    // Split lines and find the refactoring row
    const lines = output.split('\n');
    const refactoringRow = lines.find((l) => l.includes('Refactoring') && l.includes('|'));
    expect(refactoringRow).toBeDefined();
    expect(refactoringRow).not.toContain('testing');
  });

  it('discovered-only 스킬이 별도 목록으로 출력된다', () => {
    const availableHashmap = getAvailableHashmapEntries([], []);
    const entries = buildCatalog(['my-skill'], new Set());
    const output = formatCatalog(entries, availableHashmap);
    expect(output).toContain('my-skill');
  });

  it('available 스킬이 없고 discovered-only도 없으면 최소 출력을 반환한다', () => {
    const availableHashmap = getAvailableHashmapEntries([], []);
    const entries = buildCatalog([], new Set());
    const output = formatCatalog(entries, availableHashmap);
    expect(output).toBe('<skill-catalog>\nNo skills available for delegation.\n</skill-catalog>');
  });

  it('formatCatalog는 entries와 availableHashmap 두 인수를 받는다', () => {
    const availableHashmap = getAvailableHashmapEntries([], []);
    const entries = buildCatalog([], new Set());
    // Must compile with two arguments — just verify it runs without error
    expect(() => formatCatalog(entries, availableHashmap)).not.toThrow();
  });
});

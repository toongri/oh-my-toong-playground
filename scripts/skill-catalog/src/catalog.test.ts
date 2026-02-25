import { SKILL_HASHMAP, buildCatalog, formatCatalog } from './catalog.js';

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

  it('TDD skill is alwaysAvailable', () => {
    const tdd = SKILL_HASHMAP.get('superpowers:test-driven-development')!;
    expect(tdd.alwaysAvailable).toBe(true);
  });
});

describe('buildCatalog', () => {
  it('returns alwaysAvailable skills even with empty discovered list', () => {
    const entries = buildCatalog([]);
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const tdd = entries.find((e) => e.name === 'superpowers:test-driven-development');
    expect(tdd).toBeDefined();
    expect(tdd!.discoveredOnly).toBe(false);
    expect(tdd!.description).toBeDefined();
    expect(tdd!.criteria).toBeDefined();
    expect(tdd!.examples).toBeDefined();
  });

  it('discovered-only skills get name-only entries', () => {
    const entries = buildCatalog(['my-custom-skill']);
    const custom = entries.find((e) => e.name === 'my-custom-skill');
    expect(custom).toBeDefined();
    expect(custom!.discoveredOnly).toBe(true);
    expect(custom!.description).toBeUndefined();
    expect(custom!.criteria).toBeUndefined();
    expect(custom!.examples).toBeUndefined();
  });

  it('discovered skill matching hashmap gets full entry', () => {
    const entries = buildCatalog(['superpowers:test-driven-development']);
    const tdd = entries.find((e) => e.name === 'superpowers:test-driven-development');
    expect(tdd).toBeDefined();
    expect(tdd!.discoveredOnly).toBe(false);
    expect(tdd!.description).toContain('Test-Driven Development');
  });

  it('does not duplicate alwaysAvailable skills when also discovered', () => {
    const entries = buildCatalog(['superpowers:test-driven-development']);
    const tddEntries = entries.filter((e) => e.name === 'superpowers:test-driven-development');
    expect(tddEntries).toHaveLength(1);
  });

  it('combines hashmap and discovered skills correctly', () => {
    const entries = buildCatalog(['prometheus', 'oracle']);
    const names = entries.map((e) => e.name);
    expect(names).toContain('superpowers:test-driven-development'); // alwaysAvailable
    expect(names).toContain('prometheus'); // discovered-only
    expect(names).toContain('oracle'); // discovered-only
  });
});

describe('formatCatalog', () => {
  it('formats hashmap entries with description, criteria, and examples', () => {
    const entries = buildCatalog([]);
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
    const entries = buildCatalog(['my-skill']);
    const output = formatCatalog(entries);

    expect(output).toContain('my-skill: Available (invoke Skill(skill: "my-skill") to load');
    expect(output).toContain('no selection criteria defined, evaluate by name)');
  });

  it('contains delegation instruction', () => {
    const entries = buildCatalog([]);
    const output = formatCatalog(entries);

    expect(output).toContain('When delegating to sisyphus-junior, evaluate the above skills against the task.');
    expect(output).toContain('Include relevant skills in ## 7. MANDATORY SKILLS section.');
  });
});

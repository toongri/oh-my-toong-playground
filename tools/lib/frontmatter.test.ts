import { describe, it, expect } from 'bun:test';

import { parseFrontmatter, serializeFrontmatter } from './frontmatter.ts';

describe('parseFrontmatter', () => {
  it('일반 프론트매터와 본문을 파싱한다', () => {
    const content = `---
name: oracle
model: sonnet
---

# Oracle

Body text here.`;

    const result = parseFrontmatter(content);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatter).toEqual({ name: 'oracle', model: 'sonnet' });
    expect(result.body).toBe('\n# Oracle\n\nBody text here.');
  });

  it('본문의 --- 수평선을 보존한다 (P2-4 회귀 테스트)', () => {
    // Mirrors the real structure of agents/metis.md which has 7 `---` horizontal
    // rules in the body. The buggy awk pattern consumed ALL of them.
    const content = `---
name: metis
model: opus
---

## Section A

Content A.

---

## Section B

Content B.

---

## Section C

Content C.`;

    const result = parseFrontmatter(content);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatter).toEqual({ name: 'metis', model: 'opus' });

    // Both --- horizontal rules must survive in body
    const bodyLines = result.body.split('\n');
    const hrCount = bodyLines.filter((line) => line === '---').length;
    expect(hrCount).toBe(2);

    expect(result.body).toContain('Content A.');
    expect(result.body).toContain('Content B.');
    expect(result.body).toContain('Content C.');
  });

  it('첫 번째 줄이 --- 가 아니면 hasFrontmatter=false를 반환한다', () => {
    const content = `# Just a markdown doc

No frontmatter here.`;

    const result = parseFrontmatter(content);

    expect(result.hasFrontmatter).toBe(false);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });

  it('빈 프론트매터를 파싱한다', () => {
    const content = `---
---
body content`;

    const result = parseFrontmatter(content);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('body content');
  });

  it('\\r\\n 줄바꿈을 정규화한다', () => {
    const content = '---\r\nname: test\r\n---\r\nbody line';

    const result = parseFrontmatter(content);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatter).toEqual({ name: 'test' });
    expect(result.body).toBe('body line');
  });
});

describe('serializeFrontmatter', () => {
  it('프론트매터와 본문을 직렬화한다', () => {
    const frontmatter = { name: 'oracle', model: 'sonnet' };
    const body = '\n# Oracle\n\nBody text.';

    const result = serializeFrontmatter(frontmatter, body);

    expect(result).toMatch(/^---\n/);
    expect(result).toContain('name: oracle');
    expect(result).toContain('model: sonnet');
    expect(result).toContain('\n---\n');
    expect(result).toContain('# Oracle');
  });
});

describe('왕복 변환 (parseFrontmatter → serializeFrontmatter)', () => {
  it('파싱 후 직렬화하면 동등한 결과를 생성한다', () => {
    const original = `---
name: metis
model: opus
tools: Read, Glob
---

## Phase 1

Content here.

---

## Phase 2

More content.
`;

    const { frontmatter, body } = parseFrontmatter(original);
    const roundTripped = serializeFrontmatter(frontmatter, body);

    // Re-parse the round-tripped result
    const reparsed = parseFrontmatter(roundTripped);

    expect(reparsed.hasFrontmatter).toBe(true);
    expect(reparsed.frontmatter['name']).toBe('metis');
    expect(reparsed.frontmatter['model']).toBe('opus');

    // Body --- horizontal rules must still be present after round-trip
    const hrCount = reparsed.body.split('\n').filter((l) => l === '---').length;
    expect(hrCount).toBe(1);

    expect(reparsed.body).toContain('Content here.');
    expect(reparsed.body).toContain('More content.');
  });
});

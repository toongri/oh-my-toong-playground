import { describe, it, expect } from 'bun:test';
import { serialize, parse } from './entity';
import type { Entity } from './types';

const FIXTURE: Entity = {
  frontmatter: {
    id: 'proj-auth-token-refresh',
    type: 'code',
    source: 'github',
    authority: 'toong@algocarelab.com',
    source_url: 'https://github.com/algo-care/algocare-backend/pull/42',
    tier: '1',
    tags: 'auth,token,refresh',
    sensitivity: 'shared',
    status: 'active',
    updated_at: '2026-06-01T00:00:00Z',
    checked_at: '2026-06-01T00:00:00Z',
    created_at: '2026-05-01T00:00:00Z',
    relations: [
      { target: 'proj-auth-jwt-strategy', type: 'related_to' },
      { target: 'proj-auth-session-cleanup', type: 'derived_from' },
    ],
  },
  body: `## 한 줄 요지\n\n액세스 토큰 만료 시 리프레시 토큰으로 자동 재발급한다.\n\n## SSOT 위치\n\nhttps://github.com/algo-care/algocare-backend/pull/42\n\n## 전후 컨텍스트\n\n2026-05 인증 리팩터링 때 도입. JWT 전략 변경 이후 세션 유지 문제 해결을 위한 패치.\n\n## 관련 cross-link\n\n- [[proj-auth-jwt-strategy]]\n- [[proj-auth-session-cleanup]]`,
};

describe('entity', () => {
  it('roundtrip: parse(serialize(e)) deep-equals e', () => {
    const md = serialize(FIXTURE);
    const result = parse(md);
    expect(result).toEqual(FIXTURE);
  });

  it('parse tolerates missing trailing newline', () => {
    const trimmed = serialize(FIXTURE).trimEnd();
    const result = parse(trimmed);
    expect(result).toEqual(FIXTURE);
  });

  it('Korean section headers and their content survive serialize→parse verbatim', () => {
    const md = serialize(FIXTURE);
    const result = parse(md);

    // Each Korean section header must appear in the body
    expect(result.body).toContain('## 한 줄 요지');
    expect(result.body).toContain('## SSOT 위치');
    expect(result.body).toContain('## 전후 컨텍스트');
    expect(result.body).toContain('## 관련 cross-link');

    // Content under each header must survive verbatim
    expect(result.body).toContain('액세스 토큰 만료 시 리프레시 토큰으로 자동 재발급한다.');
    expect(result.body).toContain('2026-05 인증 리팩터링 때 도입. JWT 전략 변경 이후 세션 유지 문제 해결을 위한 패치.');

    // Body must be byte-identical to input
    expect(result.body).toBe(FIXTURE.body);
  });
});

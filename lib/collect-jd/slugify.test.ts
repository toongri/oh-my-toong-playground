import { describe, it, expect } from 'bun:test';
import { slugify } from './slugify';

describe('slugify', () => {
  it('한글 음절 보존', () => {
    expect(slugify('토스')).toBe('토스');
  });

  it('라틴 lowercase + 공백 하이픈', () => {
    expect(slugify('AX Backend Engineer')).toBe('ax-backend-engineer');
  });

  it('한글 공백 섞인 구분자', () => {
    expect(slugify('백엔드 / 서버')).toBe('백엔드-서버');
  });

  it('괄호 · 특수문자 제거', () => {
    expect(slugify('Toss Bank (Korea)')).toBe('toss-bank-korea');
  });

  it('선후 공백 트림', () => {
    expect(slugify('   spaces   ')).toBe('spaces');
  });

  it('64자 길이 truncate', () => {
    const long = 'a'.repeat(80);
    expect(slugify(long).length).toBeLessThanOrEqual(64);
  });

  it('한글 + 영문 혼합', () => {
    expect(slugify('카카오 Frontend Dev')).toBe('카카오-frontend-dev');
  });

  it('연속 하이픈 압축', () => {
    expect(slugify('hello---world')).toBe('hello-world');
  });

  it('선후 하이픈 트림', () => {
    expect(slugify('-trim-')).toBe('trim');
  });

  it('64자 경계 truncate 후 trailing 하이픈 제거', () => {
    // 63 'a' chars + '-' + more chars => after truncate at 64, trailing '-' is trimmed
    const input = 'a'.repeat(63) + '-extra';
    const result = slugify(input);
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result.endsWith('-')).toBe(false);
  });
});

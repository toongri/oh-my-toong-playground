import { describe, it, expect } from 'bun:test';
import { normalizeUrl } from './url-normalize';

describe('normalizeUrl', () => {
  it('utm_* + gclid 제거', () => {
    expect(normalizeUrl('https://wanted.co.kr/wd/12345?utm_source=google&gclid=abc'))
      .toBe('https://wanted.co.kr/wd/12345');
  });

  it('LinkedIn currentJobId 보존, ref 제거', () => {
    expect(normalizeUrl('https://www.linkedin.com/jobs/view/?currentJobId=999&ref=home'))
      .toBe('https://www.linkedin.com/jobs/view?currentJobId=999');
  });

  it('fragment 제거', () => {
    expect(normalizeUrl('https://example.com/a#section'))
      .toBe('https://example.com/a');
  });

  it('trailing slash 제거 (root 아닌 경우)', () => {
    expect(normalizeUrl('https://example.com/jobs/'))
      .toBe('https://example.com/jobs');
  });

  it('trailing slash 유지 (root 인 경우)', () => {
    expect(normalizeUrl('https://example.com/'))
      .toBe('https://example.com/');
  });

  it('host 대소문자 정규화', () => {
    expect(normalizeUrl('HTTPS://Example.COM/Path?utm_medium=x'))
      .toBe('https://example.com/Path');
  });

  it('fbclid + _ga 제거', () => {
    expect(normalizeUrl('https://example.com/j?fbclid=1&_ga=2&keep=y'))
      .toBe('https://example.com/j?keep=y');
  });

  it('trailing slash 제거 시 userinfo(user:pass) 보존', () => {
    expect(normalizeUrl('https://user:pass@example.com/path/'))
      .toBe('https://user:pass@example.com/path');
  });

  it('trailing slash 제거 시 username-only userinfo 보존', () => {
    expect(normalizeUrl('https://admin@example.com/jobs/'))
      .toBe('https://admin@example.com/jobs');
  });

  it('잔여 query param 순서 정규화 (정렬)', () => {
    expect(normalizeUrl('https://example.com/j?lang=ko&jobId=123'))
      .toBe('https://example.com/j?jobId=123&lang=ko');
  });

  it('서로 다른 emit 순서의 동일 URL이 같은 정규형이 됨', () => {
    expect(normalizeUrl('https://example.com/j?lang=ko&jobId=123&utm_source=x'))
      .toBe(normalizeUrl('https://example.com/j?utm_source=y&jobId=123&lang=ko'));
  });

  it('malformed URL returns null (no protocol)', () => {
    expect(normalizeUrl('invalid-url')).toBeNull();
  });

  it('empty string returns null', () => {
    expect(normalizeUrl('')).toBeNull();
  });

  it('URL without protocol returns null', () => {
    expect(normalizeUrl('wanted.co.kr/jobs')).toBeNull();
  });

  it('query param order does not affect canonical form (keep + jobId)', () => {
    const a = normalizeUrl('https://example.com/x?keep=y&jobId=123');
    const b = normalizeUrl('https://example.com/x?jobId=123&keep=y');
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    // jobId < keep alphabetically
    expect(a).toBe('https://example.com/x?jobId=123&keep=y');
  });

  it('mixed tracking + kept params are sorted alphabetically after tracking removal', () => {
    // utm_source removed; remaining: wd=42, category=eng → alphabetical: category, wd
    const result = normalizeUrl('https://jobs.example.com/p?wd=42&utm_source=email&category=eng');
    expect(result).toBe('https://jobs.example.com/p?category=eng&wd=42');
  });
});

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
});

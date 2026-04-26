/**
 * URL normalization for job posting URLs.
 *
 * Removes tracking parameters (utm_*, gclid, fbclid, _ga, ref, source),
 * strips fragments, normalizes casing, and removes trailing slashes
 * (except for root paths).
 */

const REMOVE_KEYS = new Set(['gclid', 'fbclid', '_ga', 'ref', 'source']);

export function normalizeUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }

  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';

  const keys = [...u.searchParams.keys()];
  for (const k of keys) {
    const lower = k.toLowerCase();
    if (REMOVE_KEYS.has(lower) || lower.startsWith('utm_')) {
      u.searchParams.delete(k);
    }
  }

  // 잔여 query param 순서 정규화 (대소문자 무시 알파벳 순): emit 순서가 달라도 동일 정규형이어야 L1 dedup이 동작
  const sortedParams = Array.from(u.searchParams.entries()).sort(
    ([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase())
  );
  u.search = '';
  for (const [k, v] of sortedParams) {
    u.searchParams.append(k, v);
  }

  // trailing slash 제거: pathname 이 "/" 단독이면 유지
  if (u.pathname !== '/' && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }

  return u.toString();
}

/**
 * URL normalization for job posting URLs.
 *
 * Removes tracking parameters (utm_*, gclid, fbclid, _ga, ref, source),
 * strips fragments, normalizes casing, and removes trailing slashes
 * (except for root paths).
 */

const REMOVE_KEYS = new Set(['gclid', 'fbclid', '_ga', 'ref', 'source']);

export function normalizeUrl(input: string): string {
  const u = new URL(input);

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

  let out = u.toString();

  // trailing slash 제거: pathname 이 "/" 단독이면 유지
  if (u.pathname !== '/' && u.pathname.endsWith('/')) {
    const newPath = u.pathname.replace(/\/+$/, '');
    const search = u.search; // "?..." 또는 빈 문자열
    out = `${u.protocol}//${u.host}${newPath}${search}`;
  }

  return out;
}

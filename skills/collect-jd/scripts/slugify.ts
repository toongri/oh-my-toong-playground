/**
 * slugify — convert a company name or job title into a URL/filesystem-safe slug.
 *
 * Policy:
 *  - NFKD → combining diacritic strip → NFC (Hangul syllables recomposed; Latin diacritics removed)
 *  - Latin characters lowercased
 *  - Hangul syllables (가-힣) kept as-is (no romanization)
 *  - Whitespace replaced with hyphens
 *  - All characters outside [a-z0-9가-힣-] removed
 *  - Consecutive hyphens collapsed
 *  - Leading/trailing hyphens trimmed
 *  - Result truncated to 64 characters (trailing hyphens trimmed again after truncation)
 */
export function slugify(input: string): string {
  // Step 1: NFKD → combining diacritic 제거 → NFC
  //   Hangul: NFKD가 음절을 jamo로 분해하나 NFC가 재조합 → 보존
  //   Latin: precomposed (é, ü) → base + combining mark, mark 제거 후 base만 남음
  let s = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC');

  // Step 2: lowercase Latin characters
  s = s.toLowerCase();

  // Step 3: whitespace → hyphen
  s = s.replace(/\s+/g, '-');

  // Step 4: remove characters outside allowed set [a-z0-9가-힣-]
  s = s.replace(/[^a-z0-9가-힣-]/g, '');

  // Step 5: collapse consecutive hyphens
  s = s.replace(/-+/g, '-');

  // Step 6: trim leading/trailing hyphens
  s = s.replace(/^-+|-+$/g, '');

  // Step 7: truncate to 64 characters, then trim trailing hyphens again
  if (s.length > 64) {
    s = s.slice(0, 64).replace(/-+$/, '');
  }

  return s;
}

/**
 * D-5 path-extraction pipeline tests.
 *
 * extractCommandPaths takes the codex PostToolUse `tool_input.command`
 * (string OR argv array) and returns the deduped set of path-shaped tokens,
 * per the D-5 contract:
 *   1. argv array -> joined string
 *   2. conditional shell-wrapper unwrap (sh -c / bash -c / zsh -lc ...)
 *   3. quote-aware tokenize + operator-split (&& || | ; newline)
 *   4. keep path-shaped tokens (contain "/" OR known extension); drop flags
 *      but keep their following value; drop unexpanded-metachar tokens
 *   5. NO file-existence gate
 *   6. dedupe
 *
 * Each fixture is a discrete test() so a failure pinpoints the broken shape.
 */

import { describe, it, expect } from 'bun:test';
import { extractCommandPaths } from './extract.ts';

describe('extractCommandPaths (D-5 pipeline)', () => {
  it('(a) single path', () => {
    expect(extractCommandPaths('cat src/service.ts')).toEqual(['src/service.ts']);
  });

  it('(b) multi-path: cat a.ts b.ts', () => {
    expect(extractCommandPaths('cat a.ts b.ts')).toEqual(['a.ts', 'b.ts']);
  });

  it('(c) redirect: printf x > f.ts', () => {
    expect(extractCommandPaths('printf x > f.ts')).toEqual(['f.ts']);
  });

  it('(d) no-path: rg pat -> empty set, no crash', () => {
    expect(extractCommandPaths('rg pat')).toEqual([]);
  });

  it('(e) quoted path with space preserved', () => {
    expect(extractCommandPaths('cat "src/my file.ts"')).toEqual(['src/my file.ts']);
  });

  it('(f) wrapped: /bin/zsh -lc "sed -n \'1p\' src/x.ts" -> src/x.ts', () => {
    expect(
      extractCommandPaths('/bin/zsh -lc "sed -n \'1p\' src/x.ts"')
    ).toEqual(['src/x.ts']);
  });

  it('(g) argv array input', () => {
    expect(extractCommandPaths(['cat', 'src/service.ts'])).toEqual([
      'src/service.ts',
    ]);
  });

  it('(h) absent-file path-shaped token still extracted (no existence gate)', () => {
    expect(extractCommandPaths('cat src/missing.ts')).toEqual([
      'src/missing.ts',
    ]);
  });
});

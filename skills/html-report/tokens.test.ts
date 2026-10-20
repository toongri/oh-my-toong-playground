import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// html-report 디자인 토큰 블록의 세 사본이 서로 어긋나지 않는지 지킨다.
// SKILL.md §3 이 기준이고, 다른 사본은 같은 이름의 토큰에 같은 값을 가져야 한다. 사본에만 있는 토큰은 허용한다.

const HERE = import.meta.dir;
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

type Tokens = Map<string, string>;
export interface TokenBlocks {
  light: Tokens;
  darkMedia: Tokens;
  darkAttr: Tokens;
}

const norm = (v: string): string => v.trim().replace(/\s+/g, ' ').toLowerCase();

function declarations(body: string): Tokens {
  const out: Tokens = new Map();
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], norm(m[2]));
  }
  return out;
}

// 중괄호 짝을 세어 selector 바로 뒤 블록 본문을 꺼낸다.
function blockAfter(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced block: ${selector}`);
}

export function parseTokenBlocks(css: string): TokenBlocks {
  return {
    light: declarations(blockAfter(css, ':root {')),
    darkMedia: declarations(blockAfter(css, ':root:not([data-theme="light"])')),
    darkAttr: declarations(blockAfter(css, ':root[data-theme="dark"]')),
  };
}

const skillMd = read('SKILL.md');
const skillCss = /```css\n([\s\S]*?)```/.exec(skillMd.slice(skillMd.indexOf('## 3. Design tokens')))![1];
const qaSource = read('../qa/scripts/qa-report.ts');
const qaCss = /const STYLE = `([\s\S]*?)`;/.exec(qaSource)![1];

const base = parseTokenBlocks(skillCss);
const copies: Record<string, TokenBlocks> = {
  'references/diagram-classes.css': parseTokenBlocks(read('references/diagram-classes.css')),
  'qa-report.ts STYLE': parseTokenBlocks(qaCss),
};

export function mismatches(a: Tokens, b: Tokens): string[] {
  return [...a].filter(([k, v]) => b.has(k) && b.get(k) !== v).map(([k, v]) => `${k}: ${v} != ${b.get(k)}`);
}

describe('html-report 디자인 토큰 사본 일치', () => {
  test('SKILL.md 의 두 다크 블록이 같다', () => {
    expect([...base.darkAttr]).toEqual([...base.darkMedia]);
  });

  for (const [name, copy] of Object.entries(copies)) {
    test(`${name} 라이트 값이 SKILL.md 와 같다`, () => {
      expect(mismatches(base.light, copy.light)).toEqual([]);
    });
    test(`${name} 다크(media) 값이 SKILL.md 와 같다`, () => {
      expect(mismatches(base.darkMedia, copy.darkMedia)).toEqual([]);
    });
    test(`${name} 다크(data-theme) 값이 SKILL.md 와 같다`, () => {
      expect(mismatches(base.darkMedia, copy.darkAttr)).toEqual([]);
    });
  }

  test('드리프트를 감지한다', () => {
    const css = read('references/diagram-classes.css').replace('--accent: #3340C9', '--accent: #3340C8');
    expect(mismatches(base.light, parseTokenBlocks(css).light)).toEqual(['--accent: #3340c9 != #3340c8']);
  });
});

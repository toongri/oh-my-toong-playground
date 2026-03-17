import { parse, stringify } from 'yaml';

export interface FrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

/**
 * Parses markdown frontmatter from content.
 *
 * Splits on the FIRST two `---` lines only. Any subsequent `---` lines in the
 * body are preserved as-is (markdown horizontal rules, not frontmatter delimiters).
 */
export function parseFrontmatter(content: string): FrontmatterResult {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines[0] !== '---') {
    return { frontmatter: {}, body: normalized, hasFrontmatter: false };
  }

  // Find the closing --- (second occurrence)
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    // No closing delimiter found — treat whole content as body
    return { frontmatter: {}, body: normalized, hasFrontmatter: false };
  }

  const yamlContent = lines.slice(1, closingIndex).join('\n');
  const bodyLines = lines.slice(closingIndex + 1);
  // Preserve leading newline separator between --- and body
  const body = bodyLines.join('\n');

  const parsed = parse(yamlContent) as Record<string, unknown> | null;
  const frontmatter = parsed ?? {};

  return { frontmatter, body, hasFrontmatter: true };
}

/**
 * Reassembles a markdown document from frontmatter and body.
 *
 * Output format: `---\n{yaml}\n---\n{body}`
 */
export function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const yaml = stringify(frontmatter);
  return `---\n${yaml}---\n${body}`;
}

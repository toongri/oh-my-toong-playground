/**
 * Mandate referential integrity validator (Type A: file existence).
 *
 * For each skills/<name>/SKILL.md, extracts markdown link paths from the
 * "Reference Full-Read Mandate" or "Reference Guides" section and verifies
 * that each referenced .md/.html file actually exists on disk.
 *
 * This catches typos like requirements-analysis.md when the actual file is
 * requirements.md — discovered in PR #67 review Finding 2.
 */

// TODO: Type B verification (trigger coverage cross-check)
// For each reference invoked in SKILL.md body (e.g., "Apply X (references/Y.md)"),
// verify that Y.md is enumerated in either the Class A trigger table or Class B list.
// Requires semantic parsing of SKILL.md body — deferred until simple grep approach proves insufficient.

import { existsSync, readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { getRootDir } from "./lib/config.ts";

// ---------------------------------------------------------------------------
// Section extraction
// ---------------------------------------------------------------------------

const MANDATE_HEADING_RE = /^## (Reference Full-Read Mandate|Reference Guides)\s*$/m;
const H2_RE = /^## /m;
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Extract all markdown link paths from the "Reference Full-Read Mandate" or
 * "Reference Guides" section of a SKILL.md file content.
 *
 * Returns only paths ending in .md or .html, skipping absolute URLs and
 * absolute filesystem paths (starting with /).
 */
export function extractMandateSectionLinks(content: string): string[] {
  const headingMatch = MANDATE_HEADING_RE.exec(content);
  if (!headingMatch) return [];

  // Extract only the text from the mandate section heading to the next H2 or EOF
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const remaining = content.slice(sectionStart);

  // Find next H2 heading after the section start
  const nextH2 = H2_RE.exec(remaining);
  const sectionText = nextH2 ? remaining.slice(0, nextH2.index) : remaining;

  const links: string[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex in case LINK_RE is reused
  LINK_RE.lastIndex = 0;

  while ((match = LINK_RE.exec(sectionText)) !== null) {
    const path = match[2];

    // Skip absolute URLs (http/https/ftp/etc)
    if (/^[a-z][a-z0-9+\-.]*:/i.test(path)) continue;

    // Skip absolute filesystem paths
    if (path.startsWith("/")) continue;

    // Only include .md and .html files
    if (!path.endsWith(".md") && !path.endsWith(".html")) continue;

    links.push(path);
  }

  return links;
}

// ---------------------------------------------------------------------------
// Type A: File existence check
// ---------------------------------------------------------------------------

/**
 * Check referential integrity for all skills under skillsDir.
 * Enumerates 1-depth subdirectories (skills/<name>/SKILL.md).
 *
 * Returns an array of error strings (empty = all good).
 */
export function checkMandateReferences(skillsDir: string): string[] {
  const errors: string[] = [];

  let entries: Dirent<string>[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return errors;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = join(skillsDir, entry.name);
    const skillMd = join(skillDir, "SKILL.md");

    if (!existsSync(skillMd)) continue;

    let content: string;
    try {
      content = readFileSync(skillMd, "utf-8");
    } catch {
      continue;
    }

    const links = extractMandateSectionLinks(content);

    for (const linkPath of links) {
      const resolved = join(skillDir, linkPath);
      if (!existsSync(resolved)) {
        errors.push(
          `[ERROR] ${skillMd}: reference not found: ${linkPath}`,
        );
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const rootDir = getRootDir();

  if (!rootDir) {
    process.stderr.write("\x1b[0;31m[VALIDATE]\x1b[0m config.yaml를 찾을 수 없습니다\n");
    process.exit(1);
  }

  const skillsDir = join(rootDir, "skills");

  if (!existsSync(skillsDir)) {
    process.stderr.write("\x1b[0;31m[VALIDATE]\x1b[0m skills/ 디렉터리를 찾을 수 없습니다\n");
    process.exit(1);
  }

  // Count checked skills and references
  let skillsChecked = 0;
  let refsVerified = 0;
  const entries = readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillMd)) continue;

    const content = readFileSync(skillMd, "utf-8");
    const links = extractMandateSectionLinks(content);
    if (links.length > 0 || existsSync(skillMd)) {
      skillsChecked++;
      refsVerified += links.length;
    }
  }

  const errors = checkMandateReferences(skillsDir);

  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`\x1b[0;31m${error}\x1b[0m\n`);
    }
    process.stderr.write(
      `\x1b[0;31m[VALIDATE]\x1b[0m Mandate referential integrity 실패: ${errors.length} 개 오류\n`,
    );
    process.exit(1);
  }

  process.stderr.write(
    `\x1b[0;32m[VALIDATE]\x1b[0m Mandate referential integrity 통과 (${skillsChecked} skills checked, ${refsVerified} references verified)\n`,
  );
  process.exit(0);
}

if (import.meta.main) {
  main();
}

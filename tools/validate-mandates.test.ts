/**
 * Tests for validate-mandates.ts — Type A referential integrity.
 *
 * Verifies that the mandate checker correctly detects missing reference files
 * and passes when all references exist.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { checkMandateReferences, extractMandateSectionLinks } from "./validate-mandates";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(tmpdir(), `mandates-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(path: string, content: string): void {
  const parent = path.split("/").slice(0, -1).join("/");
  mkdirSync(parent, { recursive: true });
  writeFileSync(path, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Suite: extractMandateSectionLinks
// ---------------------------------------------------------------------------

describe("extractMandateSectionLinks", () => {
  it("extracts .md links from Reference Full-Read Mandate section", () => {
    const content = `# My Skill

## Overview
Some overview text.

## Reference Full-Read Mandate

| Trigger | Reference |
|---------|-----------|
| On start | [foo.md](references/foo.md) |
| On end | [bar.md](references/bar.md) |

## Next Section
Other content.
`;
    const links = extractMandateSectionLinks(content);
    expect(links).toContain("references/foo.md");
    expect(links).toContain("references/bar.md");
    expect(links).toHaveLength(2);
  });

  it("extracts links from Reference Guides section", () => {
    const content = `# My Skill

## Reference Guides

| When | Read |
|------|------|
| Looking up patterns | [interview.md](interview.md) |
| Looking up templates | [plan-template.md](plan-template.md) |

## After Guides
Text here.
`;
    const links = extractMandateSectionLinks(content);
    expect(links).toContain("interview.md");
    expect(links).toContain("plan-template.md");
    expect(links).toHaveLength(2);
  });

  it("ignores non-.md/.html links", () => {
    const content = `## Reference Full-Read Mandate

| Trigger | Reference |
|---------|-----------|
| On start | [external](https://example.com) |
| On docs | [website](http://docs.io/page) |
| Valid ref | [foo.md](references/foo.md) |
`;
    const links = extractMandateSectionLinks(content);
    expect(links).toContain("references/foo.md");
    expect(links).not.toContain("https://example.com");
    expect(links).not.toContain("http://docs.io/page");
    expect(links).toHaveLength(1);
  });

  it("includes .html links", () => {
    const content = `## Reference Full-Read Mandate

| Trigger | Reference |
|---------|-----------|
| On html | [template](references/template.html) |
| On md | [data.md](references/data.md) |
`;
    const links = extractMandateSectionLinks(content);
    expect(links).toContain("references/template.html");
    expect(links).toContain("references/data.md");
    expect(links).toHaveLength(2);
  });

  it("stops extraction at next H2 heading", () => {
    const content = `## Reference Full-Read Mandate

[in-section.md](in-section.md)

## Another Section

[out-of-section.md](out-of-section.md)
`;
    const links = extractMandateSectionLinks(content);
    expect(links).toContain("in-section.md");
    expect(links).not.toContain("out-of-section.md");
    expect(links).toHaveLength(1);
  });

  it("returns empty array when no mandate section exists", () => {
    const content = `# Skill

## Overview
No reference section here.

## Implementation
Details.
`;
    const links = extractMandateSectionLinks(content);
    expect(links).toHaveLength(0);
  });

  it("ignores absolute URL paths (starting with /)", () => {
    const content = `## Reference Full-Read Mandate

[absolute](/some/path/file.md)
[relative](references/file.md)
`;
    const links = extractMandateSectionLinks(content);
    expect(links).not.toContain("/some/path/file.md");
    expect(links).toContain("references/file.md");
    expect(links).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: checkMandateReferences (Type A file existence)
// ---------------------------------------------------------------------------

describe("checkMandateReferences", () => {
  let skillsDir: string;

  beforeEach(() => {
    skillsDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
  });

  it("should pass when all references exist (flat structure)", () => {
    // Create skill dir with SKILL.md and flat references
    const skillDir = join(skillsDir, "sisyphus");
    writeFile(join(skillDir, "SKILL.md"), `# Sisyphus

## Reference Full-Read Mandate

| Trigger | Reference |
|---------|-----------|
| About to delegate | [delegation.md](delegation.md) |
| About to verify | [verification.md](verification.md) |
`);
    writeFile(join(skillDir, "delegation.md"), "# Delegation");
    writeFile(join(skillDir, "verification.md"), "# Verification");

    const errors = checkMandateReferences(skillsDir);
    expect(errors).toHaveLength(0);
  });

  it("should pass when all references exist (nested references/ structure)", () => {
    const skillDir = join(skillsDir, "spec");
    writeFile(join(skillDir, "SKILL.md"), `# Spec

## Reference Full-Read Mandate

| Trigger | Reference |
|---------|-----------|
| On checkpoint | [core-protocols.md](references/core-protocols.md) |
| On session start | [references/persistence.md](references/persistence.md) |
`);
    writeFile(join(skillDir, "references", "core-protocols.md"), "# Core Protocols");
    writeFile(join(skillDir, "references", "persistence.md"), "# Persistence");

    const errors = checkMandateReferences(skillsDir);
    expect(errors).toHaveLength(0);
  });

  it("should fail when a reference is missing", () => {
    const skillDir = join(skillsDir, "myskill");
    writeFile(join(skillDir, "SKILL.md"), `# My Skill

## Reference Full-Read Mandate

| Trigger | Reference |
|---------|-----------|
| On start | [missing.md](references/missing.md) |
`);
    // Do NOT create references/missing.md

    const errors = checkMandateReferences(skillsDir);
    expect(errors.length).toBeGreaterThan(0);
    const errorMsg = errors[0];
    expect(errorMsg).toContain("missing.md");
    expect(errorMsg).toContain("myskill");
  });

  it("should fail with ERROR prefix for missing reference", () => {
    const skillDir = join(skillsDir, "alpha");
    writeFile(join(skillDir, "SKILL.md"), `# Alpha

## Reference Full-Read Mandate

[gone.md](references/gone.md)
`);

    const errors = checkMandateReferences(skillsDir);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/\[ERROR\]/);
  });

  it("should ignore non-.md/.html links in mandate section", () => {
    const skillDir = join(skillsDir, "beta");
    writeFile(join(skillDir, "SKILL.md"), `# Beta

## Reference Full-Read Mandate

[external site](https://example.com)
[valid ref](references/real.md)
`);
    writeFile(join(skillDir, "references", "real.md"), "# Real");

    const errors = checkMandateReferences(skillsDir);
    expect(errors).toHaveLength(0);
  });

  it("should return no errors when skills have no mandate section", () => {
    const skillDir = join(skillsDir, "nomandate");
    writeFile(join(skillDir, "SKILL.md"), `# No Mandate Skill

## Overview
No references here.
`);

    const errors = checkMandateReferences(skillsDir);
    expect(errors).toHaveLength(0);
  });

  it("should check multiple skills and report all missing references", () => {
    // Skill 1: missing ref
    const skill1Dir = join(skillsDir, "skill1");
    writeFile(join(skill1Dir, "SKILL.md"), `# Skill 1

## Reference Full-Read Mandate
[missing1.md](references/missing1.md)
`);

    // Skill 2: all refs present
    const skill2Dir = join(skillsDir, "skill2");
    writeFile(join(skill2Dir, "SKILL.md"), `# Skill 2

## Reference Full-Read Mandate
[present.md](references/present.md)
`);
    writeFile(join(skill2Dir, "references", "present.md"), "# Present");

    // Skill 3: missing ref
    const skill3Dir = join(skillsDir, "skill3");
    writeFile(join(skill3Dir, "SKILL.md"), `# Skill 3

## Reference Full-Read Mandate
[missing3.md](references/missing3.md)
`);

    const errors = checkMandateReferences(skillsDir);
    expect(errors.length).toBe(2);
    expect(errors.some((e: string) => e.includes("missing1.md"))).toBe(true);
    expect(errors.some((e: string) => e.includes("missing3.md"))).toBe(true);
  });
});

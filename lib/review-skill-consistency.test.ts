import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Review/advisory skills wrap the shared generic-job framework with a per-skill
 * `scripts/job.ts` CLI plus a SKILL.md that tells an agent how to drive it. The
 * doc and the CLI must stay in sync. These tests pin the two drift classes that
 * a cloud review surfaced as bugs — a documented resume-member invocation whose
 * argument form did not match the handler's parsing, and an "Allowed Bash Usage"
 * whitelist that omitted commands the workflow elsewhere instructs the agent to
 * run — so the same drift is caught for free here instead of by an expensive
 * external review. The check discovers skills from disk, so a newly added review
 * skill is covered automatically; skills that document neither concern are
 * skipped, not asserted against.
 */

const REPO_ROOT = join(import.meta.dir, "..");
const SKILLS_DIR = join(REPO_ROOT, "skills");

// All job.ts subcommands the framework exposes; used to recognise command
// references in prose without matching unrelated `job.ts` mentions.
const SUBCOMMAND = "(?:start|collect|results|stop|clean|status|resume-member)";

type ArgForm = "flag" | "positional";

interface JobSkill {
  name: string;
  jobTs: string;
  skillMd: string;
}

/** Every skills/<name> that ships both a scripts/job.ts CLI and a SKILL.md. */
function jobSkills(): JobSkill[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      jobTs: join(SKILLS_DIR, d.name, "scripts", "job.ts"),
      skillMd: join(SKILLS_DIR, d.name, "SKILL.md"),
    }))
    .filter((s) => existsSync(s.jobTs) && existsSync(s.skillMd));
}

/**
 * How the job.ts resume-member handler reads its arguments, determined by
 * running the CLI rather than grepping its source: `resume-member` with no args
 * fails fast with an error that reveals the contract — `--job required` (flag
 * form) vs `missing jobDir` (positional form). Probing behaviour keeps this
 * immune to refactors that relocate the arg parsing, which a source regex would
 * mis-read. Returns null when the error matches neither (no resume-member CLI).
 */
function implResumeForm(jobTs: string): ArgForm | null {
  let stderr = "";
  try {
    execFileSync(process.execPath, [jobTs, "resume-member"], {
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf-8",
    });
    return null; // resume-member with no args must never exit 0
  } catch (e) {
    stderr = String((e as { stderr?: unknown })?.stderr ?? "");
  }
  if (/--job\b/.test(stderr)) return "flag";
  if (/missing jobDir|missing member/.test(stderr)) return "positional";
  return null;
}

/**
 * The argument form of every full `job.ts resume-member ...` invocation shown in
 * SKILL.md (a skill may show more than one — e.g. a whitelist entry and a policy
 * example — and all must agree with the handler). Empty when the doc only names
 * the command without showing a full invocation.
 */
function docResumeForms(skillMd: string): ArgForm[] {
  return readFileSync(skillMd, "utf-8")
    .split("\n")
    .filter((l) => /job\.ts resume-member\s/.test(l))
    .map((l) => (/--(?:job|member|prompt)\b/.test(l) ? "flag" : "positional"));
}

/** Subcommands referenced anywhere in the SKILL.md body. */
function bodySubcommands(skillMd: string): Set<string> {
  const subs = new Set<string>();
  const re = new RegExp(`job\\.ts (${SUBCOMMAND})\\b`, "g");
  for (const m of readFileSync(skillMd, "utf-8").matchAll(re)) subs.add(m[1]);
  return subs;
}

/**
 * Subcommands listed under the "Allowed Bash Usage" heading, or null when the
 * skill has no such whitelist (only the Chairman orchestration skills do).
 */
function whitelistSubcommands(skillMd: string): Set<string> | null {
  const lines = readFileSync(skillMd, "utf-8").split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s+Allowed Bash Usage/.test(l));
  if (start === -1) return null;
  const subs = new Set<string>();
  const re = new RegExp(`job\\.ts (${SUBCOMMAND})\\b`, "g");
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break; // next heading ends the section
    for (const m of lines[i].matchAll(re)) subs.add(m[1]);
  }
  return subs;
}

const SKILLS = jobSkills();

describe("review skill family — resume-member arg form (doc ↔ impl)", () => {
  const documented = SKILLS.map((s) => ({
    name: s.name,
    impl: implResumeForm(s.jobTs),
    docForms: docResumeForms(s.skillMd),
  })).filter((s) => s.docForms.length > 0);

  it("at least two skills document a full resume-member invocation (parser guard)", () => {
    expect(documented.length).toBeGreaterThanOrEqual(2);
  });

  for (const s of documented) {
    it(`${s.name}: every documented arg form matches the job.ts handler`, () => {
      expect(s.impl).not.toBeNull();
      const mismatched = s.docForms.filter((f) => f !== s.impl);
      expect(mismatched).toEqual([]);
    });
  }
});

describe("review skill family — Allowed Bash whitelist completeness", () => {
  const chairman = SKILLS.map((s) => ({
    name: s.name,
    whitelist: whitelistSubcommands(s.skillMd),
    body: bodySubcommands(s.skillMd),
  })).filter((s): s is { name: string; whitelist: Set<string>; body: Set<string> } => s.whitelist !== null);

  it("at least two Chairman skills expose an Allowed Bash Usage section (parser guard)", () => {
    expect(chairman.length).toBeGreaterThanOrEqual(2);
  });

  for (const s of chairman) {
    it(`${s.name}: every job.ts subcommand used in the body is whitelisted`, () => {
      expect(s.whitelist.size).toBeGreaterThan(0);
      const missing = [...s.body].filter((c) => !s.whitelist.has(c)).sort();
      expect(missing).toEqual([]);
    });
  }
});

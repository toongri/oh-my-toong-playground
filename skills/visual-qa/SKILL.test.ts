import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

// ---------------------------------------------------------------------------
// Visual QA package port contract.
//
// These assertions describe the OMT-native surface.  The materialized
// upstream copy is intentionally RED until its harness references and path
// variables are ported.  Recursive scans exclude *.test.ts so the contract's
// own token literals do not satisfy (or violate) the package contract.
// ---------------------------------------------------------------------------

const skillDir = import.meta.dir;
const files = (readdirSync(skillDir, { recursive: true }) as string[])
	.map((entry) => join(skillDir, entry))
	.filter((file) => statSync(file).isFile() && !file.endsWith(".test.ts"))
	.map((file) => ({
		path: relative(skillDir, file),
		text: readFileSync(file, "utf8"),
	}));

const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf8");

function offendersContaining(token: string) {
	return files.filter(({ text }) => text.includes(token)).map(({ path }) => path);
}

function offendersMatching(pattern: RegExp) {
	return files.filter(({ text }) => pattern.test(text)).map(({ path }) => path);
}

// ---------------------------------------------------------------------------
// Forbidden upstream harness/platform tokens — one named assertion each.
// ---------------------------------------------------------------------------

describe("visual-qa forbidden upstream tokens", () => {
	test("browser:control-in-app-browser is absent from every shipped visual-qa file", () => {
		expect(offendersContaining("browser:control-in-app-browser"), "browser:control-in-app-browser").toEqual([]);
	});

	test(".omo is absent from every shipped visual-qa file", () => {
		expect(offendersContaining(".omo"), ".omo").toEqual([]);
	});

	test("$SKILL_DIR is absent from every shipped visual-qa file", () => {
		expect(offendersContaining("$SKILL_DIR"), "$SKILL_DIR").toEqual([]);
	});

	test("call_omo_agent is absent from every shipped visual-qa file", () => {
		expect(offendersContaining("call_omo_agent"), "call_omo_agent").toEqual([]);
	});

	test("multi_agent_v1 is absent from every shipped visual-qa file", () => {
		expect(offendersContaining("multi_agent_v1"), "multi_agent_v1").toEqual([]);
	});

	test("team_ is absent from every shipped visual-qa file", () => {
		expect(offendersContaining("team_"), "team_").toEqual([]);
	});

	test("lazycodex (case-insensitive, without a trailing-hyphen requirement) is absent from every shipped visual-qa file", () => {
		expect(offendersMatching(/lazycodex/i), "lazycodex").toEqual([]);
	});

	test("task(subagent_type= is absent from every shipped visual-qa file", () => {
		expect(offendersContaining("task(subagent_type="), "task(subagent_type=").toEqual([]);
	});

	test("OmO is absent from every shipped visual-qa file", () => {
		expect(offendersContaining("OmO"), "OmO").toEqual([]);
	});

	test("gpt-5.6-sol is absent from every shipped visual-qa file", () => {
		expect(offendersContaining("gpt-5.6-sol"), "gpt-5.6-sol").toEqual([]);
	});
});

// Orchestration routing is not part of this visual specialist.  Check the
// command in hyphen/underscore/space spellings, including slash/backtick
// command forms through the same token match.
describe("visual-qa orchestration routing", () => {
	test("review-work is absent in every spelling from every shipped visual-qa file", () => {
		expect(offendersMatching(/review[-_ ]work/i), "review-work").toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// OMT-native replacements that must remain in the port.
// ---------------------------------------------------------------------------

describe("visual-qa OMT port mappings", () => {
	test("agent-browser replacement is present", () => {
		expect(skillMd).toContain("agent-browser");
	});

	test("OMT_DIR replacement is present", () => {
		expect(skillMd).toContain("OMT_DIR");
	});

	test("evidence replacement is present", () => {
		expect(skillMd).toContain("evidence");
	});

	test("${CLAUDE_SKILL_DIR} replacement is present", () => {
		expect(skillMd).toContain("${CLAUDE_SKILL_DIR}");
	});

	test("oracle replacement is present", () => {
		expect(skillMd).toContain("oracle");
	});
});

describe("visual-qa harness prose", () => {
	test("Codex Harness Tool Compatibility section heading is absent", () => {
		expect(skillMd).not.toContain("## Codex Harness Tool Compatibility");
	});
});

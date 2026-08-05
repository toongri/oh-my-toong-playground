import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

// ---------------------------------------------------------------------------
// Frontend package contract tests.
//
// These assertions intentionally describe the post-port surface.  The
// materialized upstream copy is expected to be RED until its routing names,
// model frontmatter, path variables, and OMT provenance are adapted.
// `*.test.ts` is excluded from recursive scans so the contract's own token
// names do not satisfy (or violate) the package contract.
// ---------------------------------------------------------------------------

const frontendDir = import.meta.dir;
const files = (readdirSync(frontendDir, { recursive: true }) as string[])
	.map((entry) => join(frontendDir, entry))
	.filter((file) => statSync(file).isFile() && !file.endsWith(".test.ts"))
	.map((file) => ({
		path: relative(frontendDir, file),
		text: readFileSync(file, "utf8"),
	}));

const skillMd = readFileSync(join(frontendDir, "SKILL.md"), "utf8");
const attributionMd = readFileSync(join(frontendDir, "ATTRIBUTION.md"), "utf8");
const designpowersText = files
	.filter(({ path }) => path.startsWith("references/designpowers/"))
	.map(({ text }) => text)
	.join("\n");

function filesOutside(...excludedPaths: string[]) {
	return files.filter(({ path }) => !excludedPaths.includes(path));
}

function offendersContaining(token: string, candidates = files) {
	return candidates.filter(({ text }) => text.includes(token)).map(({ path }) => path);
}

// ---------------------------------------------------------------------------
// Forbidden upstream routing/integration names — one named assertion each.
// ---------------------------------------------------------------------------

describe("frontend forbidden upstream tokens", () => {
	test("ulw-plan is absent from every shipped frontend file", () => {
		const offenders = offendersContaining("ulw-plan");
		expect(offenders, "ulw-plan").toEqual([]);
	});

	test("start-work is absent from every shipped frontend file", () => {
		const offenders = offendersContaining("start-work");
		expect(offenders, "start-work").toEqual([]);
	});

	test("review-work is absent from every shipped frontend file", () => {
		const offenders = offendersContaining("review-work");
		expect(offenders, "review-work").toEqual([]);
	});

	test("browser:control-in-app-browser is absent from every shipped frontend file", () => {
		const offenders = offendersContaining("browser:control-in-app-browser");
		expect(offenders, "browser:control-in-app-browser").toEqual([]);
	});

	test("OmO is absent from every shipped frontend file", () => {
		const offenders = offendersContaining("OmO");
		expect(offenders, "OmO").toEqual([]);
	});

	test("OpenAgent is absent from every shipped frontend file", () => {
		const offenders = offendersContaining("OpenAgent");
		expect(offenders, "OpenAgent").toEqual([]);
	});

	test("$SKILL_DIR is absent from every shipped frontend file", () => {
		const offenders = offendersContaining("$SKILL_DIR");
		expect(offenders, "$SKILL_DIR").toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// `.omo` is allowed only in the captured Aside provenance reference.
// ---------------------------------------------------------------------------

describe(".omo provenance carve-out", () => {
	test(".omo word-boundary occurrences are absent outside aside.md", () => {
		const candidates = filesOutside("references/design/aside.md");
		const offenders = candidates
			.filter(({ text }) => /(?<!\w)\.omo(?!\w)/.test(text))
			.map(({ path }) => path);
		expect(offenders, ".omo").toEqual([]);
	});

	test("aside.md retains its positive .omo evidence carve-out", () => {
		const aside = files.find(({ path }) => path === "references/design/aside.md");
		expect(aside).toBeDefined();
		expect(aside?.text).toMatch(/(?<!\w)\.omo(?!\w)/);
	});
});

// ---------------------------------------------------------------------------
// Claude model pins are not portable package content.
// ---------------------------------------------------------------------------

describe("frontend model portability", () => {
	test("^model: (opus|sonnet)$ Claude model pins are absent", () => {
		const offenders = files
			.filter(({ text }) => /^model: (opus|sonnet)$/m.test(text))
			.map(({ path }) => path);
		expect(offenders, "^model: (opus|sonnet)$").toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Routing names are not shipped as runtime dependency routes.  Legal
// provenance mentions remain in ATTRIBUTION (and the Apache license's
// copyright notice for the spaced project name).
// ---------------------------------------------------------------------------

describe("frontend routing portability", () => {
	test("backticked/hyphenated `open-design` is absent outside ATTRIBUTION.md", () => {
		const token = ["open", "design"].join("-");
		const offenders = offendersContaining(token, filesOutside("ATTRIBUTION.md"));
		expect(offenders, "`open-design`").toEqual([]);
	});

	test("backticked `programming` is absent outside ATTRIBUTION.md", () => {
		const offenders = filesOutside("ATTRIBUTION.md")
			.filter(({ text }) => /`programming`/.test(text))
			.map(({ path }) => path);
		expect(offenders, "`programming`").toEqual([]);
	});

	test("spaced Open Design is absent outside ATTRIBUTION.md and LICENSE-Apache-2.0.txt", () => {
		const offenders = offendersContaining(
			"Open Design",
			filesOutside("ATTRIBUTION.md", "LICENSE-Apache-2.0.txt"),
		);
		expect(offenders, "Open Design").toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Positive provenance, OMT target mappings, and self-locating CLI examples.
// ---------------------------------------------------------------------------

describe("frontend OMT port mappings", () => {
	test("SKILL.md maps frontend execution to sisyphus-junior", () => {
		expect(skillMd).toContain("sisyphus-junior");
	});

	test("designpowers maps planning to prometheus", () => {
		expect(designpowersText).toContain("prometheus");
	});

	test("designpowers maps orchestration to sisyphus", () => {
		expect(designpowersText).toContain("sisyphus");
	});

	test("designpowers maps final review to code-review", () => {
		expect(designpowersText).toContain("code-review");
	});

	test("designpowers maps operational state to OMT_DIR", () => {
		expect(designpowersText).toContain("OMT_DIR");
	});
});

describe("frontend upstream provenance and CLI paths", () => {
	test("ATTRIBUTION.md preserves open-design upstream provenance", () => {
		expect(attributionMd).toContain("open-design");
	});

	test("SKILL.md uses ${CLAUDE_SKILL_DIR} for the Lighthouse CLI", () => {
		expect(skillMd).toContain(
			"uv run ${CLAUDE_SKILL_DIR}/scripts/perfection/lighthouse-audit.py",
		);
	});

	test("SKILL.md uses ${CLAUDE_SKILL_DIR} for the ui-ux-db CLI", () => {
		expect(skillMd).toContain(
			"python3 ${CLAUDE_SKILL_DIR}/references/ui-ux-db/scripts/search.py",
		);
	});
});

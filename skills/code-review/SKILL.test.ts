import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");

function extractSection(markdown: string, heading: string, nextHeading: string) {
	const start = markdown.indexOf(heading);
	const end = markdown.indexOf(nextHeading, start + heading.length);
	return markdown.slice(start, end === -1 ? undefined : end);
}

describe("code-review Terminal Output prose 계약", () => {
	test("`Terminal Output` keeps the handoff contract caller-agnostic", () => {
		const terminalOutput = extractSection(
			skillMd,
			"### Terminal Output",
			"## Reference Files (on-demand)",
		);

		expect(terminalOutput).not.toContain("review-report");
		expect(terminalOutput).toContain("ranked findings");
		expect(terminalOutput).toContain("handoff contract");
		expect(terminalOutput).toContain("do not invent a different format");
	});
});

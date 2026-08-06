import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");

function extractSection(markdown: string, heading: string, nextHeading: string) {
	const start = markdown.indexOf(heading);
	const end = markdown.indexOf(nextHeading, start + heading.length);
	return markdown.slice(start, end === -1 ? undefined : end);
}

describe("Sisyphus 정직한 보고 prose 계약", () => {
	test("`Honest Reporting` is caller-agnostic and preserves verification norms", () => {
		const honestReporting = extractSection(
			skillMd,
			"## Honest Reporting",
			"## Rationalization Table",
		);

		expect(honestReporting).not.toContain("goal/ultragoal");
		expect(honestReporting).toContain("completion claims require");
		expect(honestReporting).toContain("VERIFY command");
		expect(honestReporting).toContain("partial result");
	});
});

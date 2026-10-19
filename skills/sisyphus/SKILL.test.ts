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

describe("Sisyphus 실행자 티어 prose 계약", () => {
	test("`Executor Tier` maps each tier to concrete tool parameters per platform", () => {
		const tier = extractSection(
			skillMd,
			"## Executor Tier",
			"## Todo Discipline",
		);

		expect(tier).toContain("sisyphus-junior-light");
		expect(tier).toContain("sisyphus-junior-deep");
		expect(tier).toContain('model: "opus"');
		expect(tier).toContain('effort: "high"');
		expect(tier).toContain('effort: "low"');
		expect(tier).toContain("never pass `model` or `reasoning_effort`");
	});
});

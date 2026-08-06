import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");
const overviewMatch = skillMd.match(/^## Overview\n([\s\S]*?)(?=^---$)/m);
const overview = overviewMatch?.[1] ?? "";

describe("slides-review 개요 문구 계약", () => {
	test("Overview prose is caller-agnostic while preserving `Gemini CLI` handoff norms", () => {
		expect(overviewMatch).not.toBeNull();
		expect(overview).not.toContain("Claude");
		expect(overview).toContain("Gemini CLI");
		expect(overview).toContain("개선 지침");
		expect(overview).toContain("직접 적용");
	});
});

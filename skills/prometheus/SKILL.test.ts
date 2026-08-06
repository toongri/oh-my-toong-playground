import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const diagramGuide = readFileSync(join(import.meta.dir, "diagram-guide.md"), "utf8");

function extractCoverageTableNote(markdown: string): string {
	const start = markdown.indexOf("Note: this coverage table");
	const end = markdown.indexOf("## 1. Diagram Types", start + 1);

	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);

	return markdown.slice(start, end);
}

describe("다이어그램 커버리지 표 호출자 중립성 문서 계약", () => {
	test("`coverage-table note` omits caller names while preserving lens composition", () => {
		const note = extractCoverageTableNote(diagramGuide);

		expect(note).not.toContain("prometheus");
		expect(note).not.toContain("deep-interview");
		expect(note).toContain("coverage table");
		expect(note).toMatch(/includes[\s\S]*`classDiagram`/);
		expect(note).toMatch(/excludes[\s\S]*`erDiagram`/);
	});
});

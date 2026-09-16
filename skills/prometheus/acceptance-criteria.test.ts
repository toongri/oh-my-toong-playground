import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const acceptanceCriteria = readFileSync(join(import.meta.dir, "acceptance-criteria.md"), "utf8");

describe("worked example Out of Scope", () => {
	test("every bullet carries a nonblank decider", () => {
		const sectionStart = acceptanceCriteria.indexOf("### Out of Scope");
		const sectionEnd = acceptanceCriteria.indexOf("\n---", sectionStart);
		const section = acceptanceCriteria.slice(sectionStart, sectionEnd);
		const bullets = [...section.matchAll(/^-\s+(.+)$/gm)].map((match) => match[1].trim());

		expect(bullets.length).toBeGreaterThan(0);
		bullets.forEach((bullet) => {
			const decider = bullet.match(/\|\s*decider:\s*(.*)$/)?.[1].trim();
			expect(decider).toBeTruthy();
		});
	});
});

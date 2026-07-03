import { describe, expect, test } from "bun:test";

describe("Bun.YAML runtime availability", () => {
	test("Bun.YAML.parse is available", () => {
		expect(typeof Bun.YAML?.parse, "Bun.YAML.parse missing — upgrade Bun >=1.2.21").toBe(
			"function",
		);
	});

	test("Bun.YAML.stringify is available", () => {
		expect(typeof Bun.YAML?.stringify, "Bun.YAML.stringify missing — upgrade Bun >=1.2.21").toBe(
			"function",
		);
	});
});

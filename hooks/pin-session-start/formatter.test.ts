/**
 * Tests for pin-session-start formatter (AC-2, T16).
 *
 * AC-2 key requirements:
 * - Output contains <pins>...</pins> wrapper
 * - Model 2 guidance lines with current skill keywords: pin-query, pin-record, pin-setup
 * - Always non-empty
 * - Output bounded (token budget)
 *
 * T16 requirements:
 * - absent: passive setup suggestion (no count, invites setup)
 * - present: count + scope/location line (no per-entry listing) + guidance
 */

import { describe, it, expect } from "bun:test";
import { formatAbsentContext, formatIndexContext } from "./formatter.ts";
import type { PinsIndex } from "../../lib/pins/index.ts";
import type { PinsManifest } from "../../lib/pins/manifest.ts";

const TEST_SETTINGS: PinsManifest = { scope: "project", location: "/tmp/pins" };

function makePinsIndex(entries: Array<{ id: string; type?: string; tags?: string }>): PinsIndex {
	const indexEntries: PinsIndex["entries"] = {};
	for (const e of entries) {
		indexEntries[e.id] = {
			id: e.id,
			file: `${e.id}.md`,
			frontmatter: {
				id: e.id,
				type: (e.type ?? "code") as "code",
				source: "github",
				authority: "test",
				source_url: "https://example.com",
				tier: "1",
				tags: e.tags ?? "",
				sensitivity: "shared",
				status: "active",
				updated_at: "2025-01-01T00:00:00Z",
				checked_at: "2025-01-01T00:00:00Z",
				created_at: "2025-01-01T00:00:00Z",
				relations: [],
			},
		};
	}
	return { entries: indexEntries, skipped: [] };
}

describe("formatAbsentContext", () => {
	it("returns non-empty string", () => {
		const result = formatAbsentContext();
		expect(result.length).toBeGreaterThan(0);
	});

	it("contains <pins> wrapper tags", () => {
		const result = formatAbsentContext();
		expect(result).toContain("<pins>");
		expect(result).toContain("</pins>");
	});

	it("contains passive setup invitation", () => {
		const result = formatAbsentContext();
		expect(
			result.includes("pins.yaml") ||
				result.includes("not configured") ||
				result.includes("set up"),
		).toBe(true);
	});

	it("contains Model 2 guidance keywords (current skills)", () => {
		const result = formatAbsentContext();
		expect(result).toContain("pin-query");
		expect(result).toContain("pin-record");
		expect(result).toContain("pin-setup");
		expect(result).not.toContain("select-pin");
		expect(result).not.toContain("write-pin");
	});

	it("output is bounded (word count ≤80)", () => {
		const result = formatAbsentContext();
		const wordCount = result.split(/\s+/).filter(Boolean).length;
		expect(wordCount).toBeLessThanOrEqual(80);
	});
});

describe("formatIndexContext", () => {
	it("contains <pins> wrapper tags", () => {
		const index = makePinsIndex([{ id: "code-auth-jwt", type: "code", tags: "auth,jwt" }]);
		const result = formatIndexContext(index, TEST_SETTINGS);
		expect(result).toContain("<pins>");
		expect(result).toContain("</pins>");
	});

	it("includes pins:N count line", () => {
		const index = makePinsIndex([{ id: "code-auth-jwt" }, { id: "concept-retry" }]);
		const result = formatIndexContext(index, TEST_SETTINGS);
		expect(result).toContain("pins:2");
	});

	it("does not include per-entry id listing in output", () => {
		const index = makePinsIndex([{ id: "code-auth-jwt", type: "code", tags: "auth" }]);
		const result = formatIndexContext(index, TEST_SETTINGS);
		// Count is still present, but per-entry id listing is gone
		expect(result).toContain("pins:1");
		expect(result).not.toMatch(/^\s+code-auth-jwt/m);
	});

	it("contains Model 2 guidance keywords (current skills)", () => {
		const index = makePinsIndex([{ id: "code-auth-jwt" }]);
		const result = formatIndexContext(index, TEST_SETTINGS);
		expect(result).toContain("pin-query");
		expect(result).toContain("pin-record");
		expect(result).not.toContain("select-pin");
		expect(result).not.toContain("write-pin");
	});

	it("still reports total count even for large index (no overflow line)", () => {
		const entries = Array.from({ length: 15 }, (_, i) => ({ id: `pin-${i}` }));
		const index = makePinsIndex(entries);
		const result = formatIndexContext(index, TEST_SETTINGS);
		expect(result).toContain("pins:15");
		expect(result).not.toContain("more");
	});

	it("handles empty index without error", () => {
		const index = makePinsIndex([]);
		const result = formatIndexContext(index, TEST_SETTINGS);
		expect(result).toContain("pins:0");
		expect(result.length).toBeGreaterThan(0);
	});

	it("includes manifest scope and location when present", () => {
		const index = makePinsIndex([{ id: "code-auth-jwt" }]);
		const settings: PinsManifest = { scope: "project", location: "/workspace/pins" };
		const result = formatIndexContext(index, settings);
		expect(result).toContain("project");
		expect(result).toContain("/workspace/pins");
	});

	it("includes git-managed reminder when git is true", () => {
		const index = makePinsIndex([{ id: "code-auth-jwt" }]);
		const settings: PinsManifest = { scope: "project", location: "/tmp/pins", git: true };
		const result = formatIndexContext(index, settings);
		expect(result).toContain("git-managed: commit pin file changes after recording");
	});

	it("omits git-managed reminder when git is false", () => {
		const index = makePinsIndex([{ id: "code-auth-jwt" }]);
		const settings: PinsManifest = { scope: "project", location: "/tmp/pins", git: false };
		const result = formatIndexContext(index, settings);
		expect(result).not.toContain("git-managed: commit pin file changes after recording");
	});

	it("omits git-managed reminder when git is omitted", () => {
		const index = makePinsIndex([{ id: "code-auth-jwt" }]);
		const settings: PinsManifest = { scope: "project", location: "/tmp/pins" };
		const result = formatIndexContext(index, settings);
		expect(result).not.toContain("git-managed: commit pin file changes after recording");
	});
});

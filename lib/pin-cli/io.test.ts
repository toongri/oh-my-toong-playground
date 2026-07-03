import { describe, test, expect } from "bun:test";
import { readEntityFromStdin } from "./io.ts";

/**
 * Tests for readEntityFromStdin() — specifically the C11 normalization:
 * when a valid-shaped Entity arrives via stdin WITHOUT a `relations` field,
 * the function must default it to [] before returning, so the engine's
 * `for (const relation of fm.relations)` never throws a TypeError.
 *
 * The validator checks (in order): 1=type, 2=forbidden, 3=required, 4=enum,
 * 5=relations. A valid entity reaching check 5 with relations=undefined throws.
 * This test verifies normalization prevents that.
 */

/** A minimal valid Entity frontmatter (all required fields, no relations key). */
const BASE_FRONTMATTER_WITHOUT_RELATIONS = {
	id: "code-hello-world",
	type: "code",
	source: "github",
	authority: "toong",
	source_url: "https://github.com/example",
	tier: "2",
	tags: "backend",
	sensitivity: "shared",
	status: "active",
	updated_at: "2024-01-01T00:00:00Z",
	checked_at: "2024-01-01T00:00:00Z",
	created_at: "2024-01-01T00:00:00Z",
	// relations intentionally OMITTED — this is the C11 scenario
};

describe("readEntityFromStdin", () => {
	test("normalizes missing relations to [] (C11 — stdin path omits relations)", async () => {
		// Arrange: valid Entity shape but relations field absent
		const payload = {
			frontmatter: BASE_FRONTMATTER_WITHOUT_RELATIONS,
			body: "## 한 줄 요지\n본문",
		};

		// Inject stdin
		const originalStdin = process.stdin;
		const { Readable } = await import("stream");

		await new Promise<void>((resolve, reject) => {
			const json = JSON.stringify(payload);
			const chunks: string[] = [json];
			let chunkIdx = 0;

			const fakeStdin = new Readable({
				read() {
					if (chunkIdx < chunks.length) {
						this.push(chunks[chunkIdx++]);
						this.push(null); // signal end
					}
				},
			});

			(process as any).stdin = fakeStdin;

			readEntityFromStdin()
				.then((entity) => {
					(process as any).stdin = originalStdin;
					try {
						// C11: relations must be normalized to [] when absent in stdin
						expect(entity.frontmatter.relations).toEqual([]);
						resolve();
					} catch (e) {
						reject(e);
					}
				})
				.catch((err) => {
					(process as any).stdin = originalStdin;
					reject(err);
				});
		});
	});

	test("preserves existing relations when present", async () => {
		const payload = {
			frontmatter: {
				...BASE_FRONTMATTER_WITHOUT_RELATIONS,
				relations: [{ target: "doc-some-ref", type: "related_to" }],
			},
			body: "## 한 줄 요지\n본문",
		};

		const originalStdin = process.stdin;
		const { Readable } = await import("stream");

		await new Promise<void>((resolve, reject) => {
			const json = JSON.stringify(payload);

			const fakeStdin = new Readable({
				read() {
					this.push(json);
					this.push(null);
				},
			});

			(process as any).stdin = fakeStdin;

			readEntityFromStdin()
				.then((entity) => {
					(process as any).stdin = originalStdin;
					try {
						expect(entity.frontmatter.relations).toEqual([
							{ target: "doc-some-ref", type: "related_to" },
						]);
						resolve();
					} catch (e) {
						reject(e);
					}
				})
				.catch((err) => {
					(process as any).stdin = originalStdin;
					reject(err);
				});
		});
	});
});

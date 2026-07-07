import { describe, it, expect } from "bun:test";

import type { SyncYaml, DeployCategory, SourceCategory } from "./types.ts";

describe("docs 타입 확장", () => {
	it("DeployCategory는 docs를 포함하지 않고 SourceCategory는 docs를 포함한다", () => {
		const d: DeployCategory = "skills";
		const c: SourceCategory = "docs";
		expect(d).toBe("skills");
		expect(c).toBe("docs");
	});

	it("SyncYaml.docs는 string 아이템과 object 아이템을 모두 담을 수 있다", () => {
		const sy: SyncYaml = {
			docs: {
				path: "docs",
				items: ["readme", { component: "spec", path: "spec.md", as: "renamed-spec", delete: true }],
			},
		};

		expect(sy.docs?.items?.length).toBeGreaterThan(0);
	});
});

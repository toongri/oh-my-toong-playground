import { describe, expect, test } from "bun:test";
import { getWalkDirectories } from "./finder-paths.js";

describe("getWalkDirectories — static path (targetFile: null)", () => {
	test("cwd === projectRoot returns only projectRoot at distance 0", () => {
		const projectRoot = "/repo";
		const result = getWalkDirectories(projectRoot, null, "/repo");
		expect(result).toEqual([{ directory: "/repo", distance: 0 }]);
	});

	test("cwd one level below projectRoot includes both cwd and projectRoot", () => {
		const projectRoot = "/repo";
		const result = getWalkDirectories(projectRoot, null, "/repo/packages/ui");
		expect(result).toEqual([
			{ directory: "/repo/packages/ui", distance: 0 },
			{ directory: "/repo/packages", distance: 1 },
			{ directory: "/repo", distance: 2 },
		]);
	});

	test("cwd two levels below projectRoot walks all ancestors up to projectRoot", () => {
		const projectRoot = "/repo";
		const result = getWalkDirectories(projectRoot, null, "/repo/apps/web");
		expect(result).toEqual([
			{ directory: "/repo/apps/web", distance: 0 },
			{ directory: "/repo/apps", distance: 1 },
			{ directory: "/repo", distance: 2 },
		]);
	});

	test("cwd outside projectRoot falls back to projectRoot only (boundary guard)", () => {
		const projectRoot = "/repo";
		const result = getWalkDirectories(projectRoot, null, "/other/dir");
		expect(result).toEqual([{ directory: "/repo", distance: 0 }]);
	});

	test("no cwd provided (undefined) returns only projectRoot — backward compat", () => {
		const projectRoot = "/repo";
		const result = getWalkDirectories(projectRoot, null, undefined);
		expect(result).toEqual([{ directory: "/repo", distance: 0 }]);
	});
});

describe("getWalkDirectories — dynamic path (targetFile non-null)", () => {
	test("cwd param is ignored when targetFile is provided; walks from targetFile dir", () => {
		const projectRoot = "/repo";
		const result = getWalkDirectories(
			projectRoot,
			"/repo/apps/web/src/foo.ts",
			"/repo/packages/ui",
		);
		expect(result).toEqual([
			{ directory: "/repo/apps/web/src", distance: 0 },
			{ directory: "/repo/apps/web", distance: 1 },
			{ directory: "/repo/apps", distance: 2 },
			{ directory: "/repo", distance: 3 },
		]);
	});
});

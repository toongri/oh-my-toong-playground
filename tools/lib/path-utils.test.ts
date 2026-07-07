import { describe, it, expect } from "bun:test";
import os from "os";
import path from "path";
import {
	expandTilde,
	isGlobalSync,
	resolveDocsTarget,
	assertDocsTargetContained,
	detectDocsTargetCollisions,
} from "./path-utils.ts";

describe("expandTilde", () => {
	it("`~` 단독을 os.homedir()로 확장한다", () => {
		expect(expandTilde("~")).toBe(os.homedir());
	});

	it("`~/foo/bar`를 os.homedir() + '/foo/bar'로 확장한다", () => {
		expect(expandTilde("~/foo/bar")).toBe(path.join(os.homedir(), "foo/bar"));
	});

	it("`~user/foo` 형태는 지원하지 않으며 원본 그대로 반환한다", () => {
		expect(expandTilde("~user/foo")).toBe("~user/foo");
	});

	it("절대경로(`/Users/foo/bar`)는 원본 그대로 반환한다", () => {
		expect(expandTilde("/Users/foo/bar")).toBe("/Users/foo/bar");
	});

	it("상대경로(`foo/bar`)는 원본 그대로 반환한다", () => {
		expect(expandTilde("foo/bar")).toBe("foo/bar");
	});

	it("빈 문자열은 원본 그대로 반환한다", () => {
		expect(expandTilde("")).toBe("");
	});
});

describe("isGlobalSync", () => {
	it("expandTilde 후 homedir과 같으면 true — 단순 ~", () => {
		expect(isGlobalSync("~")).toBe(true);
	});

	it("expandTilde 후 homedir과 같으면 true — trailing slash ~/", () => {
		expect(isGlobalSync("~/")).toBe(true);
	});

	it("리터럴 절대경로 os.homedir()이면 true", () => {
		expect(isGlobalSync(os.homedir())).toBe(true);
	});

	it("홈 하위 디렉터리 ~/repos/foo는 false", () => {
		expect(isGlobalSync("~/repos/foo")).toBe(false);
	});

	it("비-홈 절대경로 /tmp/x는 false", () => {
		expect(isGlobalSync("/tmp/x")).toBe(false);
	});

	it("다른 사용자 home ~user/foo는 false (미지원)", () => {
		expect(isGlobalSync("~user/foo")).toBe(false);
	});

	it("리터럴 환경변수 문자열 $HOME은 false", () => {
		expect(isGlobalSync("$HOME")).toBe(false);
	});
});

describe("resolveDocsTarget", () => {
	it("sectionPath 미지정 시 base는 'docs' — nested componentName은 서브패스를 보존한다", () => {
		expect(resolveDocsTarget("skills/authoring", undefined, undefined, undefined)).toBe(
			"docs/skills/authoring",
		);
	});

	it("itemPath가 주어지면 base와 join되어 componentName을 오버라이드한다", () => {
		expect(resolveDocsTarget("ignored-component", "docs", "custom/file", undefined)).toBe(
			"docs/custom/file",
		);
	});

	it("as가 주어지면 최종 세그먼트 이름만 교체한다 (rename)", () => {
		expect(resolveDocsTarget("skills/authoring", undefined, undefined, "renamed")).toBe(
			"docs/skills/renamed",
		);
	});

	describe("docs traversal matrix", () => {
		const cases: Array<{
			name: string;
			componentName: string;
			sectionPath: string | undefined;
			itemPath: string | undefined;
			as: string | undefined;
			outcome: "reject" | string;
		}> = [
			{
				name: "escape — leading .. past root는 거부된다",
				componentName: "x",
				sectionPath: "docs",
				itemPath: "../../etc/passwd",
				as: undefined,
				outcome: "reject",
			},
			{
				name: "absolute — sectionPath 자체가 절대경로면 거부된다",
				componentName: "x",
				sectionPath: "/etc",
				itemPath: undefined,
				as: undefined,
				outcome: "reject",
			},
			{
				name: "equals-root — 정규화 결과가 deployRoot('.')이면 거부된다",
				componentName: ".",
				sectionPath: ".",
				itemPath: undefined,
				as: undefined,
				outcome: "reject",
			},
			{
				name: "empty — 정규화 결과가 빈 경로면 거부된다",
				componentName: "",
				sectionPath: "",
				itemPath: undefined,
				as: undefined,
				outcome: "reject",
			},
			{
				name: "contained-but-leaves-base — ../other/x는 base를 벗어나지만 root 안에 머물러 허용된다",
				componentName: "ignored-component",
				sectionPath: "docs",
				itemPath: "../other/x",
				as: undefined,
				outcome: "other/x",
			},
		];

		for (const c of cases) {
			it(c.name, () => {
				if (c.outcome === "reject") {
					expect(() =>
						resolveDocsTarget(c.componentName, c.sectionPath, c.itemPath, c.as),
					).toThrow();
				} else {
					expect(resolveDocsTarget(c.componentName, c.sectionPath, c.itemPath, c.as)).toBe(
						c.outcome,
					);
				}
			});
		}
	});
});

describe("assertDocsTargetContained", () => {
	it("leading ..은 deployRoot 탈출로 간주해 거부한다", () => {
		expect(() => assertDocsTargetContained("../etc/passwd")).toThrow();
	});

	it("절대경로는 거부한다", () => {
		expect(() => assertDocsTargetContained("/etc/passwd")).toThrow();
	});

	it("빈 문자열은 거부한다", () => {
		expect(() => assertDocsTargetContained("")).toThrow();
	});

	it("'.'(deployRoot 자체와 동일)는 거부한다", () => {
		expect(() => assertDocsTargetContained(".")).toThrow();
	});

	it("정상적인 상대경로는 통과시킨다", () => {
		expect(() => assertDocsTargetContained("docs/skills/authoring")).not.toThrow();
	});

	it("base를 벗어나지만 root 안에 머무는 경로는 통과시킨다", () => {
		expect(() => assertDocsTargetContained("other/x")).not.toThrow();
	});
});

describe("detectDocsTargetCollisions", () => {
	it("docs case collision — Foo.md와 foo.md는 fs 조회 없이 케이스충돌로 감지된다", () => {
		const collisions = detectDocsTargetCollisions(["docs/Foo.md", "docs/foo.md"]);
		expect(collisions.length).toBe(1);
		expect(collisions[0].kind).toBe("case-collision");
	});

	it("docs duplicate target — 동일 target으로 resolve된 두 아이템은 duplicate로 감지된다", () => {
		const collisions = detectDocsTargetCollisions(["docs/skills/a", "docs/skills/a"]);
		expect(collisions.length).toBe(1);
		expect(collisions[0].kind).toBe("duplicate");
	});

	it("충돌 없는 targets 집합은 빈 배열을 반환한다", () => {
		expect(detectDocsTargetCollisions(["docs/a", "docs/b"])).toEqual([]);
	});
});

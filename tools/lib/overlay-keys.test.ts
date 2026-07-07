import { describe, it, expect } from "bun:test";
import { getIdentityKey, hasRegistry } from "./overlay-keys.ts";

describe("hasRegistry", () => {
	it("plugins.items 경로는 등록됨", () => {
		expect(hasRegistry("plugins.items")).toBe(true);
	});

	it("sync items 경로들은 등록됨", () => {
		expect(hasRegistry("agents.items")).toBe(true);
		expect(hasRegistry("commands.items")).toBe(true);
		expect(hasRegistry("skills.items")).toBe(true);
		expect(hasRegistry("scripts.items")).toBe(true);
		expect(hasRegistry("rules.items")).toBe(true);
	});

	it("docs.items 경로는 등록됨", () => {
		expect(hasRegistry("docs.items")).toBe(true);
	});

	it("permissions 경로들은 등록됨", () => {
		expect(hasRegistry("permissions.allow")).toBe(true);
		expect(hasRegistry("permissions.deny")).toBe(true);
		expect(hasRegistry("permissions.ask")).toBe(true);
	});

	it("hooks 이벤트 경로들은 등록됨", () => {
		expect(hasRegistry("hooks.PreToolUse")).toBe(true);
		expect(hasRegistry("hooks.UserPromptSubmit")).toBe(true);
		expect(hasRegistry("hooks.SessionStart")).toBe(true);
		expect(hasRegistry("hooks.Stop")).toBe(true);
		expect(hasRegistry("hooks.PostToolUse")).toBe(true);
	});

	it("등록되지 않은 경로는 false", () => {
		expect(hasRegistry("config.language")).toBe(false);
		expect(hasRegistry("some.random.path")).toBe(false);
		expect(hasRegistry("plugins")).toBe(false);
	});
});

describe("getIdentityKey", () => {
	describe("plugins.items 경로", () => {
		it("객체 항목은 name 필드를 키로 반환", () => {
			expect(getIdentityKey("plugins.items", { name: "context7", version: 1 })).toBe("context7");
		});

		it("name 필드가 있는 복잡한 객체도 처리", () => {
			const entry = {
				name: "plannotator@plannotator",
				check: "some check command",
				"pre-commands": ["curl something"],
			};
			expect(getIdentityKey("plugins.items", entry)).toBe("plannotator@plannotator");
		});

		it("문자열 항목은 자기 자신이 키", () => {
			expect(getIdentityKey("plugins.items", "context7")).toBe("context7");
		});
	});

	describe("sync.yaml items 경로 (agents/commands/skills/scripts/rules)", () => {
		it("객체 항목은 component 필드를 키로 반환", () => {
			expect(getIdentityKey("agents.items", { component: "sisyphus-junior" })).toBe(
				"sisyphus-junior",
			);
			expect(getIdentityKey("commands.items", { component: "git-master" })).toBe("git-master");
			expect(getIdentityKey("skills.items", { component: "prometheus" })).toBe("prometheus");
			expect(getIdentityKey("scripts.items", { component: "hud" })).toBe("hud");
			expect(getIdentityKey("rules.items", { component: "coding-discipline" })).toBe(
				"coding-discipline",
			);
		});

		it("문자열 항목은 자기 자신이 키", () => {
			expect(getIdentityKey("agents.items", "oracle")).toBe("oracle");
			expect(getIdentityKey("skills.items", "prometheus")).toBe("prometheus");
		});
	});

	describe("docs.items 경로", () => {
		it("객체 항목은 component 필드를 키로 반환", () => {
			expect(getIdentityKey("docs.items", { component: "x" })).toBe("x");
		});

		it("문자열 항목은 자기 자신이 키", () => {
			expect(getIdentityKey("docs.items", "architecture")).toBe("architecture");
		});

		it("동일 component를 가진 두 docs 항목은 같은 키로 dedup되어 overlay가 우선함", () => {
			const global = { component: "architecture", path: "global/architecture.md" };
			const overlay = { component: "architecture", path: "project/architecture.md" };
			expect(getIdentityKey("docs.items", global)).toBe(getIdentityKey("docs.items", overlay));

			const merged = new Map<string, unknown>();
			for (const entry of [global, overlay]) {
				merged.set(getIdentityKey("docs.items", entry), entry);
			}
			expect(merged.size).toBe(1);
			expect(merged.get("architecture")).toEqual(overlay);
		});
	});

	describe("permissions 경로 (allow/deny/ask)", () => {
		it("문자열은 자기 자신이 키", () => {
			expect(getIdentityKey("permissions.deny", "Bash(rm -rf *)")).toBe("Bash(rm -rf *)");
			expect(getIdentityKey("permissions.allow", "Read")).toBe("Read");
			expect(getIdentityKey("permissions.ask", "Write")).toBe("Write");
		});
	});

	describe("hooks 이벤트 경로 - 복합 키 dedup", () => {
		it("component만 있으면 component가 키", () => {
			const entry = { component: "keyword-detector.sh", timeout: 10 };
			expect(getIdentityKey("hooks.PreToolUse", entry)).toBe("keyword-detector.sh");
		});

		it("component와 matcher 모두 있으면 JSON 복합 키", () => {
			const entry = { component: "pre-tool-enforcer.sh", matcher: "Bash", timeout: 5 };
			expect(getIdentityKey("hooks.PreToolUse", entry)).toBe(
				JSON.stringify({ component: "pre-tool-enforcer.sh", matcher: "Bash" }),
			);
		});

		it("동일한 component라도 matcher가 다르면 다른 키", () => {
			const entryA = { component: "pre-commit-gate.sh", matcher: "Bash" };
			const entryB = { component: "pre-commit-gate.sh", matcher: "Write" };
			const entryNoMatcher = { component: "pre-commit-gate.sh" };
			const keyA = getIdentityKey("hooks.PreToolUse", entryA);
			const keyB = getIdentityKey("hooks.PreToolUse", entryB);
			const keyNoMatcher = getIdentityKey("hooks.PreToolUse", entryNoMatcher);
			expect(keyA).not.toBe(keyB);
			expect(keyA).not.toBe(keyNoMatcher);
			expect(keyB).not.toBe(keyNoMatcher);
		});

		it("hooks 이벤트명은 동적으로 매칭됨", () => {
			const entry = { component: "session-start.sh", timeout: 10 };
			expect(getIdentityKey("hooks.SessionStart", entry)).toBe("session-start.sh");
			expect(getIdentityKey("hooks.Stop", entry)).toBe("session-start.sh");
			expect(getIdentityKey("hooks.PostToolUse", entry)).toBe("session-start.sh");
		});
	});
});

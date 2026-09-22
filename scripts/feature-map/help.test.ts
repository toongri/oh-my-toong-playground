import { describe, expect, test } from "bun:test";
import { FEATURE_MAP_COMMANDS, renderFeatureMapHelp, type FeatureMapCommand } from "./help.ts";

describe("feature-map 도움말", () => {
	test("여섯 개 작업 명령을 AI 사용 가능 roster로 내보낸다", () => {
		const names = FEATURE_MAP_COMMANDS.map((command) => command.name);
		expect(names).toEqual(["query", "get", "save", "validate", "status", "configure"]);
		for (const command of FEATURE_MAP_COMMANDS) expect(command.authority).toBe("ai");
	});

	test("개요는 공용 권한 렌더러와 실행 안내를 포함한다", () => {
		const help = renderFeatureMapHelp();
		expect(help).toContain("feature-map commands:");
		expect(help).toContain("AI-USABLE");
		expect(help).toContain("bun scripts/feature-map/feature-map.ts help");
		expect(help).toContain("feature-map query [--text TEXT] [--changed-by ID] [--project DIR]");
		expect(help).toContain('"status": "ok"');
		expect(help).toContain("0: success or expected not_found");
		expect(help).toContain("1: runtime error, invalid validation, or revision conflict");
		expect(help).toContain("2: usage error");
	});

	test("각 명령은 usage, effect, 상세 설명, 실행 예시를 제공한다", () => {
		for (const command of FEATURE_MAP_COMMANDS as FeatureMapCommand[]) {
			expect(command.usage.length).toBeGreaterThan(0);
			expect(command.effect.length).toBeGreaterThan(0);
			expect(command.details.length).toBeGreaterThan(0);
			expect(command.examples.length).toBeGreaterThan(0);
		}
	});

	test("상세 도움말은 요청한 명령만 설명한다", () => {
		const help = renderFeatureMapHelp("save");
		expect(help).toContain("feature-map save");
		expect(help).toContain("--file PATH");
		expect(help).toContain("--expect <new|sha256>");
		expect(help).toContain("schema_version: 1");
		expect(help).toContain("raw 64-character SHA-256");
		expect(help).toContain("library API uses null");
		expect(help).toContain("invocation working directory");
		expect(help).not.toContain("feature-map configure");
	});

	test("validate와 status의 검사 범위를 구분해 설명한다", () => {
		const validate = renderFeatureMapHelp("validate");
		const status = renderFeatureMapHelp("status");
		expect(validate).toContain("filename/id matches");
		expect(validate).toContain("duplicate feature IDs");
		expect(validate).toContain("dangling state_changed_by references");
		expect(status).toContain("manifest and configured storage directory accessibility");
		expect(status).toContain("Invalid feature files are reported by validate, not status");
	});

	test("configure는 사용자 동의를 안내하지만 user-only로 표시하지 않는다", () => {
		const help = renderFeatureMapHelp("configure");
		expect(help).toContain("ask the user to agree on a storage location first");
		expect(help).toContain("relative paths resolve against the manifest directory");
		expect(FEATURE_MAP_COMMANDS.find((command) => command.name === "configure")?.authority).toBe("ai");
	});

	test("알 수 없는 명령은 유용한 오류를 발생시킨다", () => {
		expect(() => renderFeatureMapHelp("missing")).toThrow("Unknown feature-map command 'missing'");
		expect(() => renderFeatureMapHelp("missing")).toThrow("query, get, save, validate, status, configure");
	});
});

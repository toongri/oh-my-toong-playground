import { describe, test, expect } from "bun:test";
import { tokenizeShell } from "./tool-paths";

describe("tokenizeShell", () => {
	describe("unquoted operator boundaries", () => {
		test("splits on && — path before && is a separate token", () => {
			const tokens = tokenizeShell("cat src/x.ts&&echo ok");
			expect(tokens).toContain("src/x.ts");
			expect(tokens).not.toContain("src/x.ts&&echo");
		});

		test("splits on ; — path before ; is a separate token", () => {
			const tokens = tokenizeShell("cat src/x.ts;echo ok");
			expect(tokens).toContain("src/x.ts");
			expect(tokens).not.toContain("src/x.ts;echo");
		});

		test("splits on | — path before | is a separate token", () => {
			const tokens = tokenizeShell("cat src/x.ts|grep x");
			expect(tokens).toContain("src/x.ts");
			expect(tokens).not.toContain("src/x.ts|grep");
		});

		test("splits on || — path before || is a separate token", () => {
			const tokens = tokenizeShell("cat src/x.ts||echo fallback");
			expect(tokens).toContain("src/x.ts");
			expect(tokens).not.toContain("src/x.ts||echo");
		});

		test("splits on newline — path before newline is a separate token", () => {
			const tokens = tokenizeShell("cat src/x.ts\necho ok");
			expect(tokens).toContain("src/x.ts");
		});
	});

	describe("quoted strings — operators inside quotes are NOT split boundaries", () => {
		test("double-quoted && is preserved as part of the token", () => {
			const tokens = tokenizeShell('echo "a&&b"');
			expect(tokens).toContain("a&&b");
			expect(tokens).not.toContain("a");
			expect(tokens).not.toContain("b");
		});

		test("single-quoted && is preserved as part of the token", () => {
			const tokens = tokenizeShell("echo 'a&&b'");
			expect(tokens).toContain("a&&b");
		});
	});

	describe("existing whitespace-split behavior is preserved", () => {
		test("splits on whitespace as before", () => {
			const tokens = tokenizeShell("cat src/a.ts src/b.ts");
			expect(tokens).toEqual(["cat", "src/a.ts", "src/b.ts"]);
		});

		test("handles escaped spaces inside tokens", () => {
			const tokens = tokenizeShell("cat src/a\\ b.ts");
			expect(tokens).toEqual(["cat", "src/a b.ts"]);
		});
	});
});

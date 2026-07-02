import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractCodexToolPaths, tokenizeShell } from "./tool-paths";

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

	// #12: redirection operators as token boundaries
	describe("#12 redirection operator boundaries", () => {
		test("splits on > — path before > is a separate token", () => {
			const tokens = tokenizeShell("grep foo src/x.ts>out.txt");
			expect(tokens).toContain("src/x.ts");
			expect(tokens).not.toContain("src/x.ts>out.txt");
		});

		test("splits on < — path after < is a separate token", () => {
			const tokens = tokenizeShell("wc -l<src/x.ts");
			expect(tokens).toContain("src/x.ts");
			expect(tokens).not.toContain("<src/x.ts");
		});

		test("splits on >> — path before >> is a separate token, path after >> is too", () => {
			const tokens = tokenizeShell("cat src/x.ts>>out.txt");
			expect(tokens).toContain("src/x.ts");
			expect(tokens).not.toContain("src/x.ts>>out.txt");
		});

		test("splits on 2> — path after 2> is a separate token", () => {
			const tokens = tokenizeShell("cat src/x.ts 2>err.log");
			expect(tokens).toContain("src/x.ts");
			expect(tokens).toContain("err.log");
			expect(tokens).not.toContain("2>err.log");
		});

		test("splits on 2>> — path after 2>> is a separate token", () => {
			const tokens = tokenizeShell("cat src/x.ts 2>>err.log");
			expect(tokens).toContain("err.log");
			expect(tokens).not.toContain("2>>err.log");
		});

		test("<<EOF heredoc delimiter is NOT split by < redirection boundary — double-< guard", () => {
			// The guard: `<<EOF` must be treated as an opaque token (not split on the first <).
			// Without the guard, the first < flushes an empty token and the second <EOF
			// flushes `<` with `EOF` as the next token — that `EOF` would look like a path.
			// With the guard, `<<EOF` is one opaque token and the word after << is NOT
			// extracted as a redirection target. Verify: the opaque token `<<EOF` appears
			// and there is no `<EOF` or bare `<` from a faulty split.
			const tokens = tokenizeShell("cat <<EOF");
			expect(tokens).toContain("<<EOF");
			expect(tokens).not.toContain("<EOF");
			expect(tokens).not.toContain("<");
		});

		test("<<-EOF heredoc with dash is NOT split by < — double-< guard", () => {
			const tokens = tokenizeShell("cat <<-EOF");
			expect(tokens).toContain("<<-EOF");
			expect(tokens).not.toContain("<-EOF");
			expect(tokens).not.toContain("<");
		});
	});
});

// #13: addPatchPayloadPaths gated on apply_patch only
describe("#13 patch-header scanning gated on apply_patch tool_name", () => {
	const cwd = mkdtempSync(join(tmpdir(), "tp-test-"));
	mkdirSync(join(cwd, "src"), { recursive: true });
	writeFileSync(join(cwd, "src", "x.ts"), "const x = 1;\n");

	test("apply_patch tool scans patch headers and extracts new-file paths (mustExist=false preserved)", () => {
		const paths = extractCodexToolPaths(
			{
				tool_name: "apply_patch",
				tool_input: {
					input: "*** Add File: src/new-file.ts\n--- src/new-file.ts\n+++ src/new-file.ts\n+const x = 1;\n",
				},
				tool_response: {},
			},
			cwd,
		);
		// apply_patch should extract the new file even though it does not exist yet
		const resolved = join(cwd, "src/new-file.ts");
		expect(paths).toContain(resolved);
	});

	test("bash tool command field is NOT scanned for patch headers", () => {
		// A bash command whose body contains a line starting with *** Add File: must
		// NOT cause addPatchPayloadPaths to run — only apply_patch triggers that scanner.
		// Use a multi-line heredoc-style command where one line IS the patch header prefix.
		const paths = extractCodexToolPaths(
			{
				tool_name: "bash",
				tool_input: {
					command: "cat <<'EOF'\n*** Add File: src/injected.ts\nEOF",
				},
				tool_response: {},
			},
			cwd,
		);
		const resolved = join(cwd, "src/injected.ts");
		expect(paths).not.toContain(resolved);
	});

	test("shell_command cmd field is NOT scanned for patch headers", () => {
		// Multi-line cmd where one line looks like a patch header.
		const nonExistent = join(cwd, "src/patch-only.ts");
		const paths = extractCodexToolPaths(
			{
				tool_name: "shell_command",
				tool_input: {
					cmd: "cat <<'EOF'\n*** Add File: src/patch-only.ts\nEOF",
				},
				tool_response: {},
			},
			cwd,
		);
		expect(paths).not.toContain(nonExistent);
	});
});

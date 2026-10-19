import { createHash } from "crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { resolve } from "path";

/** Writes the receipt lint.sh would write for a clean strict run; `overrides` break one field. */
export function writeLintReceipt(receiptPath: string, htmlPath: string, sourcePath: string, overrides: Record<string, unknown> = {}): string {
	writeFileSync(
		receiptPath,
		JSON.stringify({
			schema_version: 2,
			html_sha256: createHash("sha256").update(readFileSync(htmlPath)).digest("hex"),
			html_path: resolve(htmlPath),
			errors: 0,
			warnings: 0,
			runs: [
				{ viewport: 1280, theme: "light" },
				{ viewport: 1280, theme: "dark" },
				{ viewport: 400, theme: "light" },
			],
			source: resolve(sourcePath),
			source_sha256: existsSync(sourcePath) && statSync(sourcePath).isFile() ? createHash("sha256").update(readFileSync(sourcePath)).digest("hex") : null,
			strict: true,
			lint_js_sha256: "0".repeat(64),
			created_at: "2026-10-19T00:00:00Z",
			...overrides,
		}),
	);
	return receiptPath;
}

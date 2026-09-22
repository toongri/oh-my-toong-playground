import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { processYaml, createContext, type AdapterMap } from "./sync.ts";
import { readAndExpandSyncYaml } from "./lib/parse-sync-yaml.ts";
import { ClaudeAdapter } from "./adapters/claude.ts";
import { CodexAdapter } from "./adapters/codex.ts";
import type { Platform } from "./lib/types.ts";
import type { PlatformAdapter } from "./adapters/types.ts";

const repoRoot = path.dirname(import.meta.dir);

async function writeFile(file: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, content, "utf8");
}

async function readTsFiles(root: string): Promise<string[]> {
	const entries = await fs.readdir(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const file = path.join(root, entry.name);
		if (entry.isDirectory()) files.push(...await readTsFiles(file));
		else if (entry.name.endsWith(".ts")) files.push(file);
	}
	return files;
}

async function run(command: string[], cwd: string): Promise<{ status: number; stdout: string; stderr: string }> {
	const process = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
	return {
		status: (await process.exited) ?? 1,
		stdout: await new Response(process.stdout).text(),
		stderr: await new Response(process.stderr).text(),
	};
}

async function runWorkflow(runtime: "bun" | "node", script: string, cwd: string, home: string, storage: string): Promise<Record<string, any>> {
	const runner = path.join(cwd, "runner.ts");
	await writeFile(runner, [
		'import { pathToFileURL } from "node:url";',
		`const featureMap = await import(pathToFileURL(process.argv[2]).href);`,
		"const options = JSON.parse(process.argv[3]);",
		"const file = process.argv[4];",
		"const invoke = (args) => { const result = featureMap.runFeatureMapCli(args, options); if (result.exitCode !== 0) throw new Error(`${args.join(' ')}: ${result.stderr}`); return JSON.parse(result.stdout); };",
		"const bootstrap = invoke(['status']);",
		"const configured = invoke(['configure', '--location', process.argv[5]]);",
		"const saved = invoke(['save', '--file', file, '--expect', 'new']);",
		"const fetched = invoke(['get', 'stock.view']);",
		"const queried = invoke(['query', '--text', '재고']);",
		"const conflict = featureMap.runFeatureMapCli(['save', '--file', file, '--expect', '0000000000000000000000000000000000000000000000000000000000000000'], options);",
		"const validated = invoke(['validate']);",
		"if (conflict.exitCode !== 1 || JSON.parse(conflict.stdout).reason !== 'revision_mismatch') throw new Error('revision conflict was not reported');",
		"console.log(JSON.stringify({ bootstrap, configured, saved, fetched, queried, conflict: JSON.parse(conflict.stdout), validated }));",
	].join("\n"));
	const command = runtime === "bun" ? ["bun", "run", runner, script, JSON.stringify({ cwd, home }), path.join(cwd, "stock.view.md"), storage] : ["node", "--experimental-strip-types", runner, script, JSON.stringify({ cwd, home }), path.join(cwd, "stock.view.md"), storage];
	const result = await run(command, cwd);
	expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
	return JSON.parse(result.stdout);
}

describe("기능 지도 배포 회귀", () => {
	it("Claude/Codex 배포본을 등록하고 Bun/Node에서 실행한다", async () => {
		const rootSync = await readAndExpandSyncYaml(path.join(repoRoot, "sync.yaml"));
		expect(rootSync?.scripts?.items ?? []).not.toContainEqual({ component: "feature-map", platforms: ["claude", "codex"] });
		expect(rootSync?.rules?.items ?? []).not.toContainEqual({ component: "feature-map", platforms: ["claude", "codex"] });
		expect(rootSync?.docs?.items ?? []).not.toContain("components/feature-map");

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omt-feature-map-deploy-"));
		const target = path.join(tmpDir, "target");
		const yaml = path.join(tmpDir, "sync.yaml");
		await fs.mkdir(target, { recursive: true });
		await writeFile(
			yaml,
			[`path: ${target}`, "platforms: [claude, codex]", "skills:", "  items:", "    - component: qa", "      platforms: [claude, codex]", ""].join("\n"),
		);
		const previousOmtDir = process.env.OMT_DIR;
		process.env.OMT_DIR = path.join(tmpDir, "omt");
		try {
			const adapters: AdapterMap = new Map<Platform, PlatformAdapter>([
				["claude", new ClaudeAdapter(async () => {}, async () => ({ exitCode: 0 }))],
				["codex", new CodexAdapter(async () => [], async () => {}, async () => {})],
			]);
			await processYaml(createContext(false), yaml, adapters, repoRoot);

			for (const [platform, dir] of [["claude", ".claude"], ["codex", ".agents"]] as const) {
				const script = path.join(target, dir, "skills", "qa", "scripts", "feature-map", "feature-map.ts");
				const lib = path.join(target, dir, "lib", "feature-map", "index.ts");
				expect(await fs.readFile(script, "utf8")).not.toContain("@lib/");
				expect(await fs.stat(lib)).toBeTruthy();
				expect(await fs.stat(path.join(target, dir, "lib", "vendor", "yaml.js"))).toBeTruthy();
				for (const file of await readTsFiles(path.join(target, dir, "lib"))) {
					expect(await fs.readFile(file, "utf8")).not.toContain("@lib/");
				}
				expect(await fs.stat(path.join(target, dir, "scripts", "feature-map")).then(() => false).catch(() => true)).toBe(true);
				expect(await fs.stat(path.join(target, dir, "rules", "feature-map.md")).then(() => false).catch(() => true)).toBe(true);
				expect(await fs.stat(path.join(target, "docs", "components", "feature-map.md")).then(() => false).catch(() => true)).toBe(true);
				for (const runtime of ["bun", "node"] as const) {
					const flowDir = path.join(tmpDir, `${platform}-${runtime}`);
					const flowHome = path.join(flowDir, "home");
					const flowStorage = path.join(flowDir, "features");
					const flowCwd = path.join(flowDir, "project");
					await fs.mkdir(flowCwd, { recursive: true });
					await fs.mkdir(flowHome, { recursive: true });
					await fs.mkdir(flowStorage, { recursive: true });
					await writeFile(flowCwd + "/stock.view.md", "---\nschema_version: 1\nid: stock.view\ntitle: 재고 조회\nstate_changed_by: [stock.view]\n---\n\n사용자가 현재 재고를 확인한다.\n");
					const help = runtime === "bun" ? await run(["bun", "run", script, "help"], flowCwd) : await run(["node", "--experimental-strip-types", script, "help"], flowCwd);
					expect({ status: help.status, stderr: help.stderr }).toEqual({ status: 0, stderr: "" });
					expect(help.stdout).toContain("feature-map");
					const workflow = await runWorkflow(runtime, script, flowCwd, flowHome, flowStorage);
					expect(workflow.bootstrap.reason).toBe("storage_not_configured");
					expect(workflow.configured.status).toBe("ready");
					expect(workflow.saved.feature.metadata.id).toBe("stock.view");
					expect(workflow.fetched.feature.revision).toBe(workflow.saved.feature.revision);
					expect(workflow.queried.features[0].id).toBe("stock.view");
					expect(workflow.conflict.reason).toBe("revision_mismatch");
					expect(workflow.validated).toMatchObject({ status: "valid", feature_count: 1 });
				}
			}
		} finally {
			if (previousOmtDir === undefined) delete process.env.OMT_DIR;
			else process.env.OMT_DIR = previousOmtDir;
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});
});

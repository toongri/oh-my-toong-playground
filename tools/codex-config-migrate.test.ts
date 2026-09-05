import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readConfigSnapshot } from "./lib/codex-config-store";

let target: string;
const config = ".codex/config.toml";
const state = ".omt/codex-config-state.json";
const backup = ".omt/codex-config-before-adoption.toml";
const pending = ".omt/codex-config-pending.json";
const original = '# omt:config:end\n# omt:config:start\n# omt:config:start\nmodel = "private-model"\nitems = [1, 2]\n[features]\nexample = true\nother = false\n';
const read = (name: string) => fs.readFile(path.join(target, name), "utf8");
async function write(name: string, bytes: string) {
	await fs.mkdir(path.dirname(path.join(target, name)), { recursive: true });
	await fs.writeFile(path.join(target, name), bytes);
}
async function cli(args: string[]) {
	const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "codex-config-migrate.ts"), ...args], { stdout: "pipe", stderr: "pipe" });
	return { code: await child.exited, output: await new Response(child.stdout).text() + await new Response(child.stderr).text() };
}
const args = () => ["--target", target, "--key", '["model"]', "--key", '["features","example"]'];
beforeEach(async () => { target = await fs.mkdtemp(path.join(os.tmpdir(), "config-migrate-")); await write(config, original); });
afterEach(async () => { await fs.rm(target, { recursive: true, force: true }); });

test("기본 미리보기는 쓰기 없이 경로와 채택 동작만 출력", async () => {
	const result = await cli(args());
	expect(result.code).toBe(0);
	expect(result.output).toContain("adopt");
	expect(result.output).toContain('["model"]');
	expect(result.output).not.toContain("private-model");
	expect(await fs.readdir(target)).toEqual([".codex"]);
});

test("깨진 마커를 무시하고 선택한 리프만 채택하며 원본을 보존", async () => {
	expect((await cli([...args(), "--apply"])).code).toBe(0);
	expect((await readConfigSnapshot(target)).state?.entries.map((entry) => entry.path)).toEqual([["features", "example"], ["model"]]);
	expect(await read(config)).toBe(original);
	expect(await read(backup)).toBe(original);
	expect((await fs.stat(path.join(target, backup))).mode & 0o777).toBe(0o600);
	const before = await fs.stat(path.join(target, state));
	expect((await cli([...args(), "--apply"])).output).toContain("noop");
	expect((await fs.stat(path.join(target, state))).mtimeMs).toBe(before.mtimeMs);
});

test("추가 배열 채택은 기존 백업을 덮어쓰지 않음", async () => {
	await cli([...args(), "--apply"]);
	await write(config, original + "# changed\n");
	expect((await cli(["--target", target, "--key", '["items"]', "--apply"])).code).toBe(0);
	expect(await read(backup)).toBe(original);
	expect((await readConfigSnapshot(target)).state?.entries).toHaveLength(3);
});

for (const bad of [[], ["--apply"], ["--target", "x"], ["--key", "[]"], ["--key", '[1]'], ["--key", '"model"'], ["--key", "{"], ["--unknown"], ["--target", ""]]) {
	test(`잘못된 인자 거부 ${JSON.stringify(bad)}`, async () => { expect((await cli(bad)).code).not.toBe(0); });
}
test("도움말은 대상을 요구하지 않음", async () => { expect((await cli(["--help"])).code).toBe(0); });
for (const key of ['["features"]', '["missing"]', '["items","0"]']) {
	test(`테이블과 누락 경로 거부 ${key}`, async () => {
		expect((await cli(["--target", target, "--key", key, "--apply"])).code).not.toBe(0);
		expect(await fs.readdir(target)).toEqual([".codex"]);
	});
}
test("파싱 실패는 비밀 값을 노출하거나 백업을 쓰지 않음", async () => {
	await write(config, 'token = "SECRET-DO-NOT-LOG');
	const result = await cli([...args(), "--apply"]);
	expect(result.code).not.toBe(0);
	expect(result.output).toContain("TOML");
	expect(result.output).not.toContain("SECRET-DO-NOT-LOG");
	expect(await fs.readdir(target)).toEqual([".codex"]);
});
test("손상된 소유권 상태를 신규 상태로 취급하지 않음", async () => {
	await write(state, "SECRET-STATE");
	const result = await cli([...args(), "--apply"]);
	expect(result.code).not.toBe(0);
	expect(result.output).toContain("state");
	expect(result.output).not.toContain("SECRET-STATE");
	expect(await read(state)).toBe("SECRET-STATE");
});
test("이미 소유한 값의 드리프트는 재채택 거부", async () => {
	await cli([...args(), "--apply"]);
	const prior = await read(state);
	await write(config, original.replace("private-model", "changed-secret"));
	const result = await cli([...args(), "--apply"]);
	expect(result.code).not.toBe(0);
	expect(result.output).toContain("drift");
	expect(result.output).not.toContain("changed-secret");
	expect(await read(state)).toBe(prior);
});
for (const kind of ["symlink", "directory"]) test(`안전하지 않은 기존 백업 거부 ${kind}`, async () => {
	await fs.mkdir(path.join(target, ".omt"));
	if (kind === "symlink") await fs.symlink(path.join(target, config), path.join(target, backup));
	else await fs.mkdir(path.join(target, backup));
	expect((await cli([...args(), "--apply"])).code).not.toBe(0);
	expect((await readConfigSnapshot(target)).state).toBeUndefined();
});
test("대기 중인 저널은 복구 필요 오류로 보존", async () => {
	const pair = { configBytes: original, stateBytes: null };
	await write(pending, JSON.stringify({ version: 1, target, before: pair, after: pair }));
	const prior = await read(pending);
	const result = await cli([...args(), "--apply"]);
	expect(result.code).not.toBe(0);
	expect(result.output).toContain("recovery");
	expect(await read(pending)).toBe(prior);
});
test("검토 후 config 경합은 소유권 쓰기를 거부", async () => {
	const { migrateConfig } = await import("./codex-config-migrate");
	await expect(migrateConfig({ target, keys: [["model"]], apply: true, hooks: {
		async mutate(_file, operation) { await write(config, original + "# concurrent\n"); await operation(); },
	} })).rejects.toThrow("changed");
	expect((await readConfigSnapshot(target)).state).toBeUndefined();
});

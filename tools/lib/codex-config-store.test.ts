import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyConfig, previewConfig, readConfigSnapshot, commitConfigState } from "./codex-config-store";
import { DeployTransaction, type DeployMutationHooks } from "./deploy-transaction";

let target: string;
const config = ".codex/config.toml";
const state = ".omt/codex-config-state.json";
const pending = ".omt/codex-config-pending.json";
const lock = ".omt/codex-config.lock";
const read = (name: string) => fs.readFile(path.join(target, name), "utf8");
async function write(name: string, bytes: string) {
	await fs.mkdir(path.dirname(path.join(target, name)), { recursive: true });
	await fs.writeFile(path.join(target, name), bytes);
}
beforeEach(async () => { target = await fs.mkdtemp(path.join(os.tmpdir(), "config-store-")); });
afterEach(async () => { await fs.rm(target, { recursive: true, force: true }); });
function failAfter(name: string): DeployMutationHooks {
	return { async mutate(file, operation) { await operation(); if (file === path.join(target, name)) throw new Error("interrupted"); } };
}

test("미리보기는 누락된 파일을 만들지 않고 적용 결과와 일치", async () => {
	const snapshot = await readConfigSnapshot(target);
	expect(snapshot.configBytes).toBeNull();
	expect(snapshot.stateBytes).toBeNull();
	const preview = await previewConfig(target, { model: "first" });
	expect(preview.status).toBe("ready");
	expect(await fs.readdir(target)).toEqual([]);
	const applied = await applyConfig(target, { model: "first" });
	expect(applied.plan).toEqual(preview.plan);
	expect(preview.configBytes).toBe(await read(config));
	for (const name of [config, state]) expect((await fs.stat(path.join(target, name))).mode & 0o777).toBe(0o600);
});

test("빈 계획과 동일한 재적용은 파일 바이트와 수정 시각을 유지", async () => {
	await applyConfig(target, {});
	expect(await fs.stat(path.join(target, config)).catch(() => null)).toBeNull();
	expect(await fs.stat(path.join(target, state)).catch(() => null)).toBeNull();
	await applyConfig(target, { model: "first" });
	const before = await Promise.all([config, state].map(async (name) => [(await fs.stat(path.join(target, name))).mtimeMs, await read(name)]));
	expect((await applyConfig(target, { model: "first" })).status).toBe("noop");
	expect(await Promise.all([config, state].map(async (name) => [(await fs.stat(path.join(target, name))).mtimeMs, await read(name)]))).toEqual(before);
});

test("충돌과 손상 상태는 config나 상태를 변경하지 않음", async () => {
	await write(config, 'model = "user"\n');
	expect((await previewConfig(target, { model: "desired", other: true })).status).toBe("conflict");
	await expect(applyConfig(target, { model: "desired", other: true })).rejects.toThrow("model");
	expect(await read(config)).toBe('model = "user"\n');
	await write(state, "broken");
	await expect(previewConfig(target, {})).rejects.toThrow("state");
	await expect(applyConfig(target, {})).rejects.toThrow("state");
});

for (const interrupted of [pending, config, state]) test(`${interrupted} 기록 후 중단을 검증하고 복구`, async () => {
	await expect(applyConfig(target, { model: "first" }, failAfter(interrupted))).rejects.toThrow("interrupted");
	const before = await read(pending);
	expect((await fs.stat(path.join(target, pending))).mode & 0o777).toBe(0o600);
	expect((await previewConfig(target, { model: "first" })).status).toBe("recovery-required");
	expect(await read(pending)).toBe(before);
	await applyConfig(target, { model: "second" });
	expect((await readConfigSnapshot(target)).current.model).toBe("second");
	expect(await fs.stat(path.join(target, pending)).catch(() => null)).toBeNull();
});

test("복구 전 전체 쌍을 검증하여 외부 config 및 state 편집을 보존", async () => {
	await expect(applyConfig(target, { model: "first" }, failAfter(config))).rejects.toThrow();
	await write(state, "external");
	const before = await read(config);
	await expect(applyConfig(target, {})).rejects.toThrow();
	expect(await read(config)).toBe(before);
	expect(await read(state)).toBe("external");
	await write(config, 'model = "external"\n');
	await expect(previewConfig(target, {})).rejects.toThrow();
	expect(await read(config)).toBe('model = "external"\n');
});

test("교체 직전 외부 편집은 덮어쓰지 않음", async () => {
	const hooks: DeployMutationHooks = { async mutate(file, operation) {
		if (file === path.join(target, config)) await write(config, 'model = "external"\n');
		await operation();
	} };
	await expect(applyConfig(target, { model: "first" }, hooks)).rejects.toThrow("changed");
	expect(await read(config)).toBe('model = "external"\n');
});

test("살아 있거나 불명확한 잠금은 거부하고 죽은 PID만 회수", async () => {
	await write(lock, JSON.stringify({ version: 1, pid: process.pid, token: "owner" }));
	await expect(applyConfig(target, { model: "first" })).rejects.toThrow("lock");
	await write(lock, "invalid");
	await expect(applyConfig(target, {})).rejects.toThrow("lock");
	await write(lock, JSON.stringify({ version: 1, pid: 2147483647, token: "dead" }));
	await applyConfig(target, { model: "first" });
	expect(await fs.stat(path.join(target, lock)).catch(() => null)).toBeNull();
});

test("저널 손상은 부트스트랩 대신 실패", async () => {
	await write(pending, "{}");
	await expect(previewConfig(target, {})).rejects.toThrow("pending");
	await expect(applyConfig(target, {})).rejects.toThrow("pending");
	expect(await read(pending)).toBe("{}");
});

test("배포 롤백은 config 상태 및 저널을 함께 되돌림", async () => {
	await applyConfig(target, { model: "first" });
	const before = [await read(config), await read(state)];
	const transaction = await DeployTransaction.begin(target, false);
	if (!transaction) throw new Error("missing transaction");
	await applyConfig(target, { model: "second" }, transaction);
	await transaction.rollback();
	await transaction.finish();
	expect([await read(config), await read(state)]).toEqual(before);
	expect(await fs.stat(path.join(target, pending)).catch(() => null)).toBeNull();
});


test("명시 채택은 설정 바이트를 보존하고 오래된 미리보기는 거부", async () => {
	await write(config, '# user comment\nmodel = "user" # retained\n');
	const reviewed = await readConfigSnapshot(target);
	const nextState = { version: 1 as const, target: ".codex/config.toml" as const, entries: [{ path: ["model"], valueToml: 'value = "user"\n' }] };
	await commitConfigState(target, reviewed, nextState);
	expect(reviewed.configBytes).toBe(await read(config));
	await applyConfig(target, { model: "managed" });
	await expect(commitConfigState(target, reviewed, nextState)).rejects.toThrow("snapshot changed");
	expect(await read(config)).toBe('# user comment\nmodel = "managed" # retained\n');
});

for (const interrupted of [pending, config, state]) test(`${interrupted} 중단 뒤 배포 롤백이 최초 누락 상태 복원`, async () => {
	const transaction = await DeployTransaction.begin(target, false);
	if (!transaction) throw new Error("missing transaction");
	const hooks: DeployMutationHooks = { async mutate(file, operation) {
		await transaction.mutate(file, async () => { await operation(); if (file === path.join(target, interrupted)) throw new Error("interrupted"); });
	} };
	await expect(applyConfig(target, { model: "first" }, hooks)).rejects.toThrow("interrupted");
	await transaction.rollback();
	await transaction.finish();
	for (const file of [config, state, pending]) expect(await fs.stat(path.join(target, file)).catch(() => null)).toBeNull();
});

test("복구에서 상태 쓰기와 저널 삭제도 mutation hook을 경유", async () => {
	await expect(applyConfig(target, { model: "first" }, failAfter(config))).rejects.toThrow();
	const writes: string[] = [];
	await applyConfig(target, { model: "first" }, { async mutate(file, operation) { writes.push(path.relative(target, file)); await operation(); } });
	expect(writes).toEqual([state, pending]);
});

test("상태 교체 직전 config 경합은 상태 쓰기와 임시 파일 잔존을 방지", async () => {
	await applyConfig(target, { model: "first" });
	const before = await read(state);
	await expect(applyConfig(target, { model: "second" }, { async mutate(file, operation) {
		if (file === path.join(target, state)) await write(config, 'model = "external"\n');
		await operation();
	} })).rejects.toThrow("changed");
	expect(await read(state)).toBe(before);
	expect(await read(config)).toBe('model = "external"\n');
	expect((await fs.readdir(path.join(target, ".omt"))).some((file) => file.endsWith(".tmp"))).toBe(false);
});

test("상태가 소유한 config 누락과 존재하는 config의 상태 누락을 구별", async () => {
	await applyConfig(target, { model: "first" });
	await fs.unlink(path.join(target, config));
	expect((await previewConfig(target, { model: "first" })).plan.conflicts[0]?.reason).toBe("owned-key-drift");
	await write(config, 'model = "first"\n');
	await fs.unlink(path.join(target, state));
	expect((await previewConfig(target, { model: "first" })).plan.conflicts[0]?.reason).toBe("adoption-required");
});

test("채택 미리보기 후 생긴 pending은 설정 복구 없이 채택을 거부", async () => {
	const reviewed = await readConfigSnapshot(target);
	await expect(applyConfig(target, { model: "first" }, failAfter(pending))).rejects.toThrow();
	const pendingBefore = await read(pending);
	await expect(commitConfigState(target, reviewed, { version: 1, target: ".codex/config.toml", entries: [] })).rejects.toThrow();
	expect(await fs.stat(path.join(target, config)).catch(() => null)).toBeNull();
	expect(await read(pending)).toBe(pendingBefore);
});

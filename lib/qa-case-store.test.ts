import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	configureQaCaseStore,
	disableQaCaseStore,
	getQaCase,
	getQaCaseStoreStatus,
	listQaCases,
	resolveQaCaseContext,
	resolveQaCaseOutputPath,
	resolveQaCaseRunPath,
	saveQaCase,
	type QaCaseRecord,
} from "@lib/qa-case-store.ts";

const roots: string[] = [];
function tempDir(): string {
	const root = mkdtempSync(join(tmpdir(), "qa-case-store-"));
	roots.push(root);
	return root;
}
function repo(name = "repo"): string {
	const root = join(tempDir(), name);
	mkdirSync(root);
	execFileSync("git", ["init", "-q", root]);
	return root;
}
function sample(id = "checkout-happy-path"): QaCaseRecord {
	return {
		id,
		title: "Checkout happy path",
		goal: "A shopper completes checkout",
		given: ["A cart contains one item"],
		when: ["The shopper submits payment"],
		then: ["An order confirmation is shown"],
		acceptance_criteria: ["The order is created once"],
		surface: "curl",
		runner: ["curl", "-fsS", "http://localhost/checkout"],
		execution_cwd: "project-root",
		native_files: ["fixtures/cart.json"],
		reset_description: "Delete the test order",
		feature_refs: ["checkout"],
	};
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("qa case store", () => {
	test("처음 조회는 unconfigured manifest를 만들고 다시 읽어도 유지한다", () => {
		const cwd = repo();
		const home = tempDir();
		const first = getQaCaseStoreStatus({ cwd, home });
		const second = getQaCaseStoreStatus({ cwd, home });
		expect(first.status).toBe("unconfigured");
		expect(second).toEqual(first);
		expect(readFileSync(resolveQaCaseContext({ cwd, home }).manifestPath, "utf8")).toContain("mode: unconfigured");
	});

	test("configure는 절대 경로만 허용하고 project 내부는 명시적 opt-in 없이는 거부한다", () => {
		const cwd = repo();
		const home = tempDir();
		expect(() => configureQaCaseStore("relative", { cwd, home })).toThrow(/absolute/);
		expect(() => configureQaCaseStore(join(cwd, "qa-cases"), { cwd, home })).toThrow(/allow-project-storage/);
		const location = join(tempDir(), "cases");
		const result = configureQaCaseStore(location, { cwd, home });
		expect(result.status).toBe("configured");
		if (result.status === "configured") expect(result.location).toBe(realpathSync(location));
	});

	test("존재하지 않는 nested external location도 nearest existing ancestor 기준으로 configure한다", () => {
		const cwd = repo();
		const home = tempDir();
		const parent = tempDir();
		const location = join(parent, "new-parent", "new-child");
		expect(configureQaCaseStore(location, { cwd, home }).status).toBe("configured");
	});

	test("project-local configure 실패는 디렉터리를 생성한 뒤 잔여물을 남기지 않는다", () => {
		const cwd = repo();
		const home = tempDir();
		const location = join(cwd, "qa-cases");
		expect(() => configureQaCaseStore(location, { cwd, home })).toThrow(/allow-project-storage/);
		expect(existsSync(location)).toBe(false);
	});

	test("project 내부 symlink target도 opt-in 없이 거부한다", () => {
		const cwd = repo();
		const home = tempDir();
		const outside = tempDir();
		const link = join(outside, "link");
		symlinkSync(join(cwd, "inside"), link);
		expect(() => configureQaCaseStore(link, { cwd, home })).toThrow(/allow-project-storage/);
	});

	test("disable은 설정을 기억하고 케이스 API는 명시적 disabled 상태를 반환한다", () => {
		const cwd = repo();
		const home = tempDir();
		const location = join(tempDir(), "cases");
		configureQaCaseStore(location, { cwd, home });
		const disabled = disableQaCaseStore({ cwd, home });
		expect(disabled).toMatchObject({ status: "disabled", location: realpathSync(location) });
		expect(listQaCases({ cwd, home })).toMatchObject({ status: "disabled" });
	});

	test("save/get/list는 JSON record를 저장하고 expected revision 충돌을 막는다", () => {
		const cwd = repo();
		const home = tempDir();
		configureQaCaseStore(join(tempDir(), "cases"), { cwd, home });
		const created = saveQaCase({ record: sample(), expectedRevision: null }, { cwd, home });
		expect(created.status).toBe("ok");
		if (created.status !== "ok") return;
		expect(getQaCase(sample().id, { cwd, home })).toMatchObject({ status: "ok", record: sample() });
		expect(listQaCases({ cwd, home })).toMatchObject({ status: "ok", cases: [{ id: sample().id }] });
		expect(saveQaCase({ record: { ...sample(), title: "changed" }, expectedRevision: "0".repeat(64) }, { cwd, home })).toMatchObject({ status: "conflict" });
	});

	test("given/when/then/acceptance_criteria/runner는 빈 배열을 허용하지 않는다", () => {
		const cwd = repo();
		const home = tempDir();
		configureQaCaseStore(join(tempDir(), "cases"), { cwd, home });
		for (const field of ["given", "when", "then", "acceptance_criteria", "runner"] as const) {
			const record = { ...sample(), [field]: [] };
			expect(() => saveQaCase({ record, expectedRevision: null }, { cwd, home })).toThrow(new RegExp(`${field}.*string array`));
		}
	});

	test("native_files는 direct runner case에서 빈 배열을 허용한다", () => {
		const cwd = repo();
		const home = tempDir();
		configureQaCaseStore(join(tempDir(), "cases"), { cwd, home });
		expect(saveQaCase({ record: { ...sample(), native_files: [] }, expectedRevision: null }, { cwd, home }).status).toBe("ok");
	});

	test("cases 조상 symlink를 따라 product 밖에 저장하지 않는다", () => {
		const cwd = repo();
		const home = tempDir();
		const store = join(tempDir(), "store");
		const outside = tempDir();
		configureQaCaseStore(store, { cwd, home });
		symlinkSync(outside, join(store, "cases"));
		expect(() => saveQaCase({ record: sample(), expectedRevision: null }, { cwd, home })).toThrow();
		expect(existsSync(join(outside, `${sample().id}.json`))).toBe(false);
	});

	test("get과 list는 파일명과 JSON id가 불일치하면 거부한다", () => {
		const cwd = repo();
		const home = tempDir();
		const store = join(tempDir(), "store");
		configureQaCaseStore(store, { cwd, home });
		mkdirSync(join(store, "cases"), { recursive: true });
		writeFileSync(join(store, "cases", "wanted.json"), `${JSON.stringify(sample("actual"))}\n`);
		expect(() => getQaCase("wanted", { cwd, home })).toThrow(/filename\/id mismatch/);
		expect(() => listQaCases({ cwd, home })).toThrow(/filename\/id mismatch/);
	});

	test("manifest의 unknown keys를 보존하고 output resolver는 store 밖 탈출을 막는다", () => {
		const cwd = repo();
		const home = tempDir();
		const context = resolveQaCaseContext({ cwd, home });
		mkdirSync(join(home, ".qa-cases", context.projectKey), { recursive: true });
		writeFileSync(context.manifestPath, `version: 1\nproject: ${context.projectKey}\nmode: unconfigured\nextra:\n  keep: true\n`);
		const location = join(tempDir(), "cases");
		configureQaCaseStore(location, { cwd, home });
		expect(readFileSync(context.manifestPath, "utf8")).toContain("keep: true");
		expect(resolveQaCaseOutputPath(location, "id", "out.json")).toBe(join(realpathSync(location), "outputs", "id", "out.json"));
		expect(() => resolveQaCaseOutputPath(location, "id", "../../escape")).toThrow(/outside/);
	});

	test("outputs 조상 symlink를 resolver가 반환하지 않는다", () => {
		const cwd = repo();
		const home = tempDir();
		const store = join(tempDir(), "store");
		const outside = tempDir();
		configureQaCaseStore(store, { cwd, home });
		symlinkSync(outside, join(store, "outputs"));
		expect(() => resolveQaCaseOutputPath(store, "case", "result.json")).toThrow();
	});

	test("run resolver는 dot path aliases를 run id로 허용하지 않는다", () => {
		const store = tempDir();
		expect(() => resolveQaCaseRunPath(store, ".")).toThrow(/run id/);
		expect(() => resolveQaCaseRunPath(store, "..")).toThrow(/run id/);
	});

	test("invalid configured manifest는 원문을 보존하고 자동 재생성하지 않는다", () => {
		const cwd = repo();
		const home = tempDir();
		const context = resolveQaCaseContext({ cwd, home });
		mkdirSync(join(home, ".qa-cases", context.projectKey), { recursive: true });
		const raw = "version: 1\nproject: wrong\nmode: configured\nlocation: [broken\n";
		writeFileSync(context.manifestPath, raw);
		expect(() => getQaCaseStoreStatus({ cwd, home })).toThrow();
		expect(readFileSync(context.manifestPath, "utf8")).toBe(raw);
	});
});

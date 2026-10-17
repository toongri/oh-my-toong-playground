import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hydrateEngineState, markSessionCompacted, persistEngineState } from "./persistent-cache.js";
import { createRulesEngine } from "./rules-engine-factory.js";

const SCOPE = "session";
let dir = "";

afterEach(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
	dir = "";
});

function cacheWith(state: object): string {
	dir = mkdtempSync(join(tmpdir(), "rules-cache-"));
	const cachePath = join(dir, "sid.json");
	writeFileSync(cachePath, JSON.stringify({ version: 1, ...state }));
	return cachePath;
}

function hydrated(cachePath: string) {
	const engine = createRulesEngine({});
	hydrateEngineState(engine, cachePath);
	return engine;
}

function readState(cachePath: string) {
	return JSON.parse(readFileSync(cachePath, "utf8"));
}

test("압축 전에 상태를 읽은 PostToolUse가 압축 뒤에 저장해도 압축이 지운 dedup 표시는 되살아나지 않는다", () => {
	const cachePath = cacheWith({
		staticDedup: ["start.md::s"],
		dynamicDedup: { [SCOPE]: ["older.md::o", "latest.md::l"] },
		latestDynamicInjectionKeys: ["latest.md::l"],
	});
	const inFlight = hydrated(cachePath);

	markSessionCompacted(cachePath);
	inFlight.state.dynamicDedup.get(SCOPE)?.add("new.md::n");
	persistEngineState(inFlight, cachePath);

	const state = readState(cachePath);
	expect([...state.dynamicDedup[SCOPE]].sort()).toEqual(["latest.md::l", "new.md::n"]);
	expect(state.staticDedup).toEqual([]);
	expect(state.postCompactPending).toEqual({ static: true, dynamic: true });
});

test("동시에 돈 두 PostToolUse가 각자 주입한 dedup 표시와 마지막 lazy 묶음을 서로 덮어쓰지 않는다", () => {
	const cachePath = cacheWith({ staticDedup: [], dynamicDedup: { [SCOPE]: ["a.md::a"] } });
	const first = hydrated(cachePath);
	const second = hydrated(cachePath);

	first.state.dynamicDedup.get(SCOPE)?.add("b.md::b");
	first.state.latestDynamicInjectionKeys = ["b.md::b"];
	persistEngineState(first, cachePath);
	second.state.dynamicDedup.get(SCOPE)?.add("c.md::c");
	persistEngineState(second, cachePath);

	const state = readState(cachePath);
	expect([...state.dynamicDedup[SCOPE]].sort()).toEqual(["a.md::a", "b.md::b", "c.md::c"]);
	// The second run injected nothing new as a unit, so the first run's unit stays the latest.
	expect(state.latestDynamicInjectionKeys).toEqual(["b.md::b"]);
});

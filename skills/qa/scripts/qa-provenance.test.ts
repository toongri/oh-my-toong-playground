import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { configureFeatureMap, saveFeature } from "@lib/feature-map/index.ts";
import {
	addActor,
	addStory,
	authorCell,
	incCycle,
	readQaState,
	readQaView,
	recordBaseline,
	recordCell,
	recordStoryProvenance,
	resolveStatePath,
	setQaState,
	startQa,
} from "./qa-state.ts";

test("검증된 feature provenance를 현재 cycle에 기록한다", () => {
	const home = mkdtempSync(join(tmpdir(), "qa-provenance-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "qa-provenance-cwd-"));
	const omt = mkdtempSync(join(tmpdir(), "qa-provenance-omt-"));
	const sid = "provenance-test";
	const oldOmt = process.env.OMT_DIR;
	process.env.OMT_DIR = omt;
	try {
		const storage = join(home, "features");
		configureFeatureMap(storage, { cwd, home });
		const saved = saveFeature(
			{
				metadata: { schema_version: 1, id: "feature-a", title: "Feature A" },
				body: "body",
				expectedRevision: null,
			},
			{ cwd, home },
		);
		if (saved.status !== "ok" || !saved.feature) throw new Error("feature setup failed");
		setQaState(sid, { phase: "PLAN" });
		addActor(sid, {
			id: "actor",
			name: "Actor",
			boundary: "CLI",
			driver: "bash",
			reachable: "yes",
		});
		addStory(sid, { id: "story", actor: "actor" });
		recordStoryProvenance(
			sid,
			"story",
			{
				features: [
					{
						id: "feature-a",
						revision: saved.feature.revision,
						entrypoints: ["cli"],
						states: ["ready"],
					},
				],
				code_ref: "git:abc",
			},
			{ cwd, home },
		);
		const view = readQaView(sid);
		expect(view).not.toBeNull();
		expect(view).toMatchObject({ stories: [{ provenance: { code_ref: "git:abc", cycle: 0 } }] });
	} finally {
		rmSync(home, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
		rmSync(omt, { recursive: true, force: true });
		if (oldOmt === undefined) delete process.env.OMT_DIR;
		else process.env.OMT_DIR = oldOmt;
	}
});

test("새 cycle의 동일 payload는 재바인딩하고 이전 cycle을 history에 보존한다", () => {
	const home = mkdtempSync(join(tmpdir(), "qa-provenance-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "qa-provenance-cwd-"));
	const omt = mkdtempSync(join(tmpdir(), "qa-provenance-omt-"));
	const oldOmt = process.env.OMT_DIR;
	process.env.OMT_DIR = omt;
	try {
		const saved = setupFeature(home, cwd);
		setQaState("cycle", { phase: "PLAN" });
		addActor("cycle", {
			id: "actor",
			name: "Actor",
			boundary: "CLI",
			driver: "bash",
			reachable: "yes",
		});
		addStory("cycle", { id: "story", actor: "actor" });
		const input = {
			features: [{ id: "feature-a", revision: saved.revision, entrypoints: [], states: [] }],
			code_ref: "git:abc",
		};
		recordStoryProvenance("cycle", "story", input, { cwd, home });
		incCycle("cycle");
		recordStoryProvenance("cycle", "story", input, { cwd, home });
		const story = (readQaView("cycle")!.stories ?? [])[0]!;
		expect(story.provenance?.cycle).toBe(1);
		expect(story.provenance_history).toHaveLength(1);
		expect(story.provenance_history![0]!.cycle).toBe(0);
	} finally {
		rmSync(home, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
		rmSync(omt, { recursive: true, force: true });
		if (oldOmt === undefined) delete process.env.OMT_DIR;
		else process.env.OMT_DIR = oldOmt;
	}
});

test("baseline 또는 결과 기록 뒤 최초 provenance 바인딩을 거부한다", () => {
	const home = mkdtempSync(join(tmpdir(), "qa-provenance-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "qa-provenance-cwd-"));
	const omt = mkdtempSync(join(tmpdir(), "qa-provenance-omt-"));
	const oldOmt = process.env.OMT_DIR;
	process.env.OMT_DIR = omt;
	try {
		const saved = setupFeature(home, cwd);
		setQaState("gate", { phase: "PLAN" });
		addActor("gate", {
			id: "actor",
			name: "Actor",
			boundary: "CLI",
			driver: "bash",
			reachable: "yes",
		});
		addStory("gate", { id: "story", actor: "actor" });
		const input = {
			features: [{ id: "feature-a", revision: saved.revision, entrypoints: [], states: [] }],
			code_ref: "git:abc",
		};
		recordBaseline("gate", { story: "story", result: "fail" });
		expect(() => recordStoryProvenance("gate", "story", input, { cwd, home })).toThrow(
			/cannot change provenance/,
		);
		incCycle("gate");
		authorCell("gate", { story: "story", cls: 1, attackPoint: "attack", priority: "H" });
		recordCell("gate", { story: "story", cls: 1, status: "fail" });
		expect(() => recordStoryProvenance("gate", "story", input, { cwd, home })).toThrow(
			/cannot change provenance/,
		);
		expect(readQaState("gate")!.stories![0]!.provenance).toBeUndefined();
	} finally {
		rmSync(home, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
		rmSync(omt, { recursive: true, force: true });
		if (oldOmt === undefined) delete process.env.OMT_DIR;
		else process.env.OMT_DIR = oldOmt;
	}
});

function setupFeature(home: string, cwd: string): { revision: string } {
	configureFeatureMap(join(home, "features"), { cwd, home });
	const saved = saveFeature(
		{
			metadata: { schema_version: 1, id: "feature-a", title: "Feature A" },
			body: "body",
			expectedRevision: null,
		},
		{ cwd, home },
	);
	if (saved.status !== "ok" || !saved.feature) throw new Error("feature setup failed");
	return { revision: saved.feature.revision };
}

function makeFixture(sid: string) {
	const home = mkdtempSync(join(tmpdir(), "qa-provenance-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "qa-provenance-cwd-"));
	const omt = mkdtempSync(join(tmpdir(), "qa-provenance-omt-"));
	const oldOmt = process.env.OMT_DIR;
	process.env.OMT_DIR = omt;
	const saved = setupFeature(home, cwd);
	setQaState(sid, { phase: "PLAN" });
	addActor(sid, { id: "actor", name: "Actor", boundary: "CLI", driver: "bash", reachable: "yes" });
	addStory(sid, { id: "story", actor: "actor" });
	const input = (extra: Record<string, unknown> = {}) => ({
		features: [
			{ id: "feature-a", revision: saved.revision, entrypoints: [], states: [], ...extra },
		],
		code_ref: "git:abc",
	});
	return {
		home,
		cwd,
		omt,
		sid,
		input,
		cleanup() {
			rmSync(home, { recursive: true, force: true });
			rmSync(cwd, { recursive: true, force: true });
			rmSync(omt, { recursive: true, force: true });
			if (oldOmt === undefined) delete process.env.OMT_DIR;
			else process.env.OMT_DIR = oldOmt;
		},
		bytes() {
			return readFileSync(resolveStatePath(sid), "utf8");
		},
	};
}

test("잘못된 provenance 입력 표는 상태 bytes를 바꾸지 않는다", () => {
	const f = makeFixture("malformed");
	try {
		const cases: unknown[] = [
			{},
			{ features: [], code_ref: "x" },
			{
				features: [
					{ id: "feature-a", revision: "a".repeat(64), entrypoints: [], states: [] },
					{ id: "feature-a", revision: "a".repeat(64), entrypoints: [], states: [] },
				],
				code_ref: "x",
			},
			{
				features: [{ id: "BAD", revision: "a".repeat(64), entrypoints: [], states: [] }],
				code_ref: "x",
			},
			{
				features: [{ id: "feature-a", revision: "A".repeat(64), entrypoints: [], states: [] }],
				code_ref: "x",
			},
			{
				features: [{ id: "feature-a", revision: "a".repeat(64), entrypoints: [], states: [] }],
				code_ref: " ",
			},
			{
				features: [{ id: "feature-a", revision: "a".repeat(64), entrypoints: "x", states: [] }],
				code_ref: "x",
			},
			{
				features: [{ id: "feature-a", revision: "a".repeat(64), entrypoints: [" "], states: [] }],
				code_ref: "x",
			},
		];
		for (const value of cases) {
			const before = f.bytes();
			expect(() =>
				recordStoryProvenance(f.sid, "story", value, { cwd: f.cwd, home: f.home }),
			).toThrow();
			expect(f.bytes()).toBe(before);
		}
	} finally {
		f.cleanup();
	}
});

test("stale revision은 raw state를 바꾸지 않는다", () => {
	const f = makeFixture("stale");
	try {
		const before = f.bytes();
		expect(() =>
			recordStoryProvenance(
				f.sid,
				"story",
				{
					...f.input(),
					features: [{ id: "feature-a", revision: "b".repeat(64), entrypoints: [], states: [] }],
				},
				{ cwd: f.cwd, home: f.home },
			),
		).toThrow(/revision mismatch/);
		expect(f.bytes()).toBe(before);
	} finally {
		f.cleanup();
	}
});

test("unconfigured feature map은 raw state를 바꾸지 않는다", () => {
	const f = makeFixture("unconfigured");
	try {
		rmSync(join(f.home, ".feature-maps"), { recursive: true, force: true });
		const before = f.bytes();
		expect(() =>
			recordStoryProvenance(f.sid, "story", f.input(), { cwd: f.cwd, home: f.home }),
		).toThrow();
		expect(f.bytes()).toBe(before);
	} finally {
		f.cleanup();
	}
});

test("missing feature와 unreadable/missing configured store는 raw state를 바꾸지 않는다", () => {
	const f = makeFixture("missing");
	try {
		const before = f.bytes();
		expect(() =>
			recordStoryProvenance(
				f.sid,
				"story",
				{
					...f.input(),
					features: [{ id: "missing", revision: "a".repeat(64), entrypoints: [], states: [] }],
				},
				{ cwd: f.cwd, home: f.home },
			),
		).toThrow();
		expect(f.bytes()).toBe(before);
		const storage = join(f.home, "features");
		rmSync(storage, { recursive: true, force: true });
		expect(() =>
			recordStoryProvenance(f.sid, "story", f.input(), { cwd: f.cwd, home: f.home }),
		).toThrow();
		expect(f.bytes()).toBe(before);
		writeFileSync(storage, "unreadable store");
		expect(() =>
			recordStoryProvenance(f.sid, "story", f.input(), { cwd: f.cwd, home: f.home }),
		).toThrow();
		expect(f.bytes()).toBe(before);
	} finally {
		f.cleanup();
	}
});

test("unknown story는 raw state를 바꾸지 않는다", () => {
	const f = makeFixture("unknown");
	try {
		const before = f.bytes();
		expect(() =>
			recordStoryProvenance(f.sid, "unknown", f.input(), { cwd: f.cwd, home: f.home }),
		).toThrow(/unknown story/);
		expect(f.bytes()).toBe(before);
	} finally {
		f.cleanup();
	}
});

test("동일 cycle 재기록은 raw state bytes가 동일하다", () => {
	const f = makeFixture("same");
	try {
		recordStoryProvenance(f.sid, "story", f.input(), { cwd: f.cwd, home: f.home });
		const before = f.bytes();
		recordStoryProvenance(f.sid, "story", f.input(), { cwd: f.cwd, home: f.home });
		expect(f.bytes()).toBe(before);
	} finally {
		f.cleanup();
	}
});

test("실행 전 context 변경은 이전 provenance를 history에 보존한다", () => {
	const f = makeFixture("before");
	try {
		recordStoryProvenance(f.sid, "story", f.input(), { cwd: f.cwd, home: f.home });
		recordStoryProvenance(
			f.sid,
			"story",
			{ ...f.input(), code_ref: "git:def" },
			{ cwd: f.cwd, home: f.home },
		);
		expect(readQaState(f.sid)!.stories![0]!.provenance_history).toHaveLength(1);
		expect(readQaState(f.sid)!.stories![0]!.provenance?.code_ref).toBe("git:def");
	} finally {
		f.cleanup();
	}
});

test("결과 이후 context 변경은 거부되고 raw state를 보존한다", () => {
	const f = makeFixture("after");
	try {
		recordStoryProvenance(f.sid, "story", f.input(), { cwd: f.cwd, home: f.home });
		incCycle(f.sid);
		authorCell(f.sid, { story: "story", cls: 1, attackPoint: "attack", priority: "H" });
		recordCell(f.sid, { story: "story", cls: 1, status: "fail" });
		const before = f.bytes();
		expect(() =>
			recordStoryProvenance(
				f.sid,
				"story",
				{ ...f.input(), code_ref: "git:def" },
				{ cwd: f.cwd, home: f.home },
			),
		).toThrow(/cannot change provenance/);
		expect(f.bytes()).toBe(before);
	} finally {
		f.cleanup();
	}
});

test("결과 없는 authored-only cell은 provenance 변경을 허용한다", () => {
	const f = makeFixture("authored");
	try {
		recordStoryProvenance(f.sid, "story", f.input(), { cwd: f.cwd, home: f.home });
		incCycle(f.sid);
		authorCell(f.sid, { story: "story", cls: 1, attackPoint: "attack", priority: "H" });
		expect(() =>
			recordStoryProvenance(
				f.sid,
				"story",
				{ ...f.input(), code_ref: "git:def" },
				{ cwd: f.cwd, home: f.home },
			),
		).not.toThrow();
	} finally {
		f.cleanup();
	}
});

test("readQaView는 stale provenance를 숨기고 history는 보존한다", () => {
	const f = makeFixture("view");
	try {
		recordStoryProvenance(f.sid, "story", f.input(), { cwd: f.cwd, home: f.home });
		incCycle(f.sid);
		const staleView = (readQaView(f.sid)!.stories ?? [])[0]!;
		expect(staleView.provenance).toBeUndefined();
		expect(staleView.provenance_history).toHaveLength(1);
		expect(staleView.provenance_history![0]!.cycle).toBe(0);
		expect(readQaState(f.sid)!.stories![0]!.provenance?.cycle).toBe(0);
		recordStoryProvenance(
			f.sid,
			"story",
			{ ...f.input(), code_ref: "git:def" },
			{ cwd: f.cwd, home: f.home },
		);
		const current = (readQaView(f.sid)!.stories ?? [])[0]!;
		expect(current.provenance?.cycle).toBe(1);
		expect(current.provenance_history).toHaveLength(1);
	} finally {
		f.cleanup();
	}
});

test("start는 완료된 cycle의 provenance와 stories를 reset한다", () => {
	const f = makeFixture("start");
	try {
		recordStoryProvenance(f.sid, "story", f.input(), { cwd: f.cwd, home: f.home });
		const raw = JSON.parse(f.bytes());
		raw.active = false;
		writeFileSync(resolveStatePath(f.sid), JSON.stringify(raw, null, 2));
		startQa(f.sid, "fresh");
		expect(readQaState(f.sid)!.stories).toEqual([]);
		expect(readQaState(f.sid)!.target).toBe("fresh");
	} finally {
		f.cleanup();
	}
});

test("provenance 변경은 report snapshot을 변경한다", () => {
	const f = makeFixture("snapshot");
	try {
		const before = readQaView(f.sid)!.report_source_snapshot;
		recordStoryProvenance(f.sid, "story", f.input(), { cwd: f.cwd, home: f.home });
		expect(readQaView(f.sid)!.report_source_snapshot).not.toBe(before);
	} finally {
		f.cleanup();
	}
});

test("CLI help는 features 비공백과 label 배열 공백 규칙을 구분한다", () => {
	const help = execFileSync("bun", ["skills/qa/scripts/qa-state.ts", "help"], {
		cwd: process.cwd(),
		encoding: "utf8",
	});
	expect(help).toContain("features non-empty, entrypoints/states may be empty");
	expect(help).not.toContain("arrays may be empty");
});

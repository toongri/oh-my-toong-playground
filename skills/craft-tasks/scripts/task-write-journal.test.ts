import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
	createChild,
	createComplete,
	createPrepare,
	getIntent,
	manualReconciliation,
	updateComplete,
	updateMutationWritten,
	updatePrepare,
	journalPath,
	listPending,
	receiptAck,
} from "./task-write-journal";

const omtDir = join(process.cwd(), ".tmp-task-write-journal-test");
const sid = "journal-test-session";
const anchor = "design-anchor: deep-interview:design-123";
const parentId = "parent-123";

afterEach(() => {
	rmSync(omtDir, { recursive: true, force: true });
	delete process.env.OMT_DIR;
	delete process.env.OMT_SESSION_ID;
	delete process.env.CODEX_THREAD_ID;
});

function setup() {
	process.env.OMT_DIR = omtDir;
	process.env.OMT_SESSION_ID = sid;
}

describe("task write journal", () => {
	test("create prepared -> child-created -> complete preserves exact payload", () => {
		setup();
		const payload = {
			title: "정확한 제목",
			body: "목적\n...",
			relations: [{ type: "blockedBy", id: "task-1" }],
			designAnchor: anchor,
		};
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: payload });
		expect(prepared.state).toBe("prepared");
		expect(prepared.taskKey).not.toBe(prepared.createIntentId);
		const canonicalComment = `<!-- Task identity\ntaskKey: ${prepared.taskKey}\n-->`;
		expect(prepared.creationPayload).toEqual({ title: payload.title, body: payload.body, relations: payload.relations, parentId });
		expect(prepared.identityComment).toBe(canonicalComment);
		expect(prepared.creationPayload).not.toHaveProperty("identityComment");
		expect((prepared.creationPayload as Record<string, unknown>).body).toBe(payload.body);
		expect((prepared.creationPayload as Record<string, unknown>).relations).toEqual(payload.relations);
		expect((prepared.creationPayload as Record<string, unknown>).title).toBe(payload.title);

		const child = createChild(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor });
		expect(child.state).toBe("child-created");
		const complete = createComplete(prepared.createIntentId, {
			childId: "child-123",
			parentId,
			designAnchor: anchor,
			creationPayload: prepared.creationPayload,
			identityComment: canonicalComment,
		});
		expect(complete.state).toBe("complete");
		expect(existsSync(journalPath(sid))).toBe(true);
		expect(getIntent(prepared.createIntentId).state).toBe("complete");
	});

	test("completes a Linear-native payload with description and multiple blockedBy relations", () => {
		setup();
		const creationPayload = {
			description: "세부 내용",
			blockedBy: ["task-1", "task-2"],
		};
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload });
		createChild(prepared.createIntentId, { childId: "child-native", parentId, designAnchor: anchor });
		const complete = createComplete(prepared.createIntentId, {
			childId: "child-native",
			parentId,
			designAnchor: anchor,
			creationPayload: { ...creationPayload, parentId },
			identityComment: prepared.identityComment,
		});
		expect(complete.state).toBe("complete");
	});

	test("completes a native payload when optional blockedBy is absent", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { description: "차단 없음" } });
		createChild(prepared.createIntentId, { childId: "child-no-blockers", parentId, designAnchor: anchor });
		expect(createComplete(prepared.createIntentId, {
			childId: "child-no-blockers", parentId, designAnchor: anchor,
			creationPayload: prepared.creationPayload, identityComment: prepared.identityComment,
		}).state).toBe("complete");
	});

	test("requires nested creationPayload and rejects every exact-payload mismatch without terminalizing", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { description: "원문" } });
		createChild(prepared.createIntentId, { childId: "child-exact", parentId, designAnchor: anchor });
		const base = { childId: "child-exact", parentId, designAnchor: anchor, identityComment: prepared.identityComment };
		for (const creationPayload of [
			undefined,
			{ description: "원문", extra: true, parentId },
			{ description: "변경", parentId },
			{ description: "원문", parentId },
		]) {
			const verification = { ...base, ...(creationPayload === undefined ? {} : { creationPayload }) };
			if (creationPayload && creationPayload.description === "원문" && Object.keys(creationPayload).length === 2) continue;
			expect(() => createComplete(prepared.createIntentId, verification)).toThrow();
			expect(getIntent(prepared.createIntentId).state).toBe("child-created");
		}
		expect(createComplete(prepared.createIntentId, {
			...base,
			creationPayload: { description: "원문", parentId },
		}).state).toBe("complete");
	});

	test("keeps child-created when an exact payload property is omitted", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: {
			description: "원문", blockedBy: ["task-1", "task-2"],
		} });
		createChild(prepared.createIntentId, { childId: "child-missing-property", parentId, designAnchor: anchor });
		expect(() => createComplete(prepared.createIntentId, {
			childId: "child-missing-property", parentId, designAnchor: anchor,
			creationPayload: { description: "원문", parentId }, identityComment: prepared.identityComment,
		})).toThrow("creationPayload verification mismatch");
		expect(getIntent(prepared.createIntentId).state).toBe("child-created");
	});

	test("uses whole-payload equality for title presence and absence", () => {
		setup();
		const withoutTitle = createPrepare({ parentId, designAnchor: anchor, creationPayload: { description: "내용" } });
		createChild(withoutTitle.createIntentId, { childId: "child-no-title", parentId, designAnchor: anchor });
		expect(() => createComplete(withoutTitle.createIntentId, {
			childId: "child-no-title", parentId, designAnchor: anchor,
			creationPayload: { description: "내용", parentId, title: "추가" }, identityComment: withoutTitle.identityComment,
		})).toThrow();
		expect(getIntent(withoutTitle.createIntentId).state).toBe("child-created");

		const withTitle = createPrepare({ parentId, designAnchor: anchor, creationPayload: { description: "내용", title: "제목" } });
		createChild(withTitle.createIntentId, { childId: "child-title", parentId, designAnchor: anchor });
		expect(() => createComplete(withTitle.createIntentId, {
			childId: "child-title", parentId, designAnchor: anchor,
			creationPayload: { description: "내용", parentId }, identityComment: withTitle.identityComment,
		})).toThrow();
	});

	test("keeps identityComment separate from the exact creationPayload", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { description: "내용", identityComment: "caller" } });
		expect(prepared.creationPayload).toEqual({ description: "내용", parentId });
		createChild(prepared.createIntentId, { childId: "child-identity", parentId, designAnchor: anchor });
		expect(createComplete(prepared.createIntentId, {
			childId: "child-identity", parentId, designAnchor: anchor,
			creationPayload: prepared.creationPayload, identityComment: prepared.identityComment,
		}).identityComment).toBe(prepared.identityComment);
	});

	test("rejects a creation payload parentId that conflicts with the verified parent", () => {
		setup();
		expect(() => createPrepare({
			parentId,
			designAnchor: anchor,
			creationPayload: { parentId: "other-parent", title: "제목", body: "b", relations: [] },
		})).toThrow("parentId mismatch");
	});

	test("rejects flattened create input when creationPayload is missing", () => {
		setup();
		expect(() => createPrepare({ parentId, designAnchor: anchor, title: "제목", body: "b", relations: [] }))
			.toThrow("creationPayload is required");
	});

	test("rejects arbitrary or mismatched identity comments", () => {
		setup();
		const prepared = createPrepare({
			parentId,
			designAnchor: anchor,
			creationPayload: { title: "제목", body: "b", relations: [], identityComment: "arbitrary" },
		});
		const canonicalComment = `<!-- Task identity\ntaskKey: ${prepared.taskKey}\n-->`;
		expect(prepared.identityComment).toBe(canonicalComment);
		expect(prepared.creationPayload).not.toHaveProperty("identityComment");
		createChild(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor });
		expect(() => createComplete(prepared.createIntentId, {
			childId: "child-123", parentId, designAnchor: anchor,
			creationPayload: prepared.creationPayload, identityComment: "arbitrary",
		})).toThrow("identityComment verification mismatch");
		expect(getIntent(prepared.createIntentId).state).toBe("child-created");
	});

	test("rejects a journal identity comment that no longer matches its taskKey", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { title: "제목", body: "b", relations: [] } });
		createChild(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor });
		const path = journalPath(sid);
		const journal = JSON.parse(readFileSync(path, "utf8")) as { intents: Array<{ creationPayload: Record<string, unknown>; identityComment: string }> };
		journal.intents[0].identityComment = "<!-- Task identity\ntaskKey: forged\n-->";
		writeFileSync(path, `${JSON.stringify(journal)}\n`, "utf8");
		expect(() => createComplete(prepared.createIntentId, {
			childId: "child-123", parentId, designAnchor: anchor,
			creationPayload: prepared.creationPayload, identityComment: "<!-- Task identity\ntaskKey: forged\n-->",
		})).toThrow("stored identityComment mismatch");
	});

	test("rejects mismatched child association and terminal mutation", () => {
		setup();
		const prepared = createPrepare({
			parentId,
			designAnchor: anchor,
			creationPayload: { parentId, designAnchor: anchor, body: "b", relations: [] },
		});
		expect(() => createChild(prepared.createIntentId, { childId: "child-123", parentId: "other", designAnchor: anchor })).toThrow();
		createChild(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor });
		createComplete(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor, creationPayload: prepared.creationPayload, identityComment: prepared.identityComment });
		expect(() => manualReconciliation(prepared.createIntentId, "late discovery")).toThrow();
	});

	test("manual reconciliation is terminal and does not create a replacement entry", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { parentId, designAnchor: anchor } });
		const reconciled = manualReconciliation(prepared.createIntentId, "PM response was lost");
		expect(reconciled.state).toBe("manual-reconciliation-required");
		expect(existsSync(journalPath(sid))).toBe(true);
		expect(getIntent(prepared.createIntentId).state).toBe("manual-reconciliation-required");
	});

	test("removes the journal when completing its only intent while returning the terminal result", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { body: "b", relations: [] } });
		createChild(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor });
		const complete = createComplete(prepared.createIntentId, {
			childId: "child-123", parentId, designAnchor: anchor, creationPayload: prepared.creationPayload, identityComment: prepared.identityComment,
		});
		expect(complete.state).toBe("complete");
		expect(existsSync(journalPath(sid))).toBe(true);
		expect(readdirSync(omtDir).some((name) => name.includes(".tmp."))).toBe(false);
	});

	test("compacts terminal intents and preserves every nonterminal intent and opaque payload", () => {
		setup();
		const terminal = createPrepare({ parentId: "terminal-parent", designAnchor: anchor, creationPayload: { body: "terminal", relations: [] } });
		const pending = updatePrepare({
			childId: "child-123", parentId, designAnchor: anchor,
			before: { opaque: "before\\n\t\u0000" }, after: { opaque: "after", nested: [{ value: 7 }] }, changeComment: "keep exactly",
		});
		const before = JSON.parse(readFileSync(journalPath(sid), "utf8")) as { version: number; intents: unknown[] };
		const result = manualReconciliation(terminal.createIntentId, "resolved");
		const after = JSON.parse(readFileSync(journalPath(sid), "utf8")) as { version: number; intents: unknown[] };
		expect(result.state).toBe("manual-reconciliation-required");
		expect(after.version).toBe(before.version);
		expect(after.intents).toHaveLength(2);
		expect(after.intents[0]).toMatchObject({ ...before.intents[0] as object, state: "manual-reconciliation-required", reason: "resolved" });
		expect(after.intents).toContainEqual(pending);
		expect(readFileSync(journalPath(sid), "utf8")).toContain(terminal.createIntentId);
		expect(readFileSync(journalPath(sid), "utf8")).toContain("manual-reconciliation-required");
	});

	test("update prepared -> mutation-written -> complete preserves delta and comment", () => {
		setup();
		const before = { body: "old", relations: [{ type: "blocks", id: "x" }] };
		const after = { body: "new", relations: [{ type: "blocks", id: "y" }] };
		const prepared = updatePrepare({ childId: "child-123", parentId, designAnchor: anchor, before, after, changeComment: "결정 변경" });
		expect(prepared.state).toBe("prepared");
		updateMutationWritten(prepared.updateIntentId, { childId: "child-123", parentId, designAnchor: anchor });
		const complete = updateComplete(prepared.updateIntentId, {
			childId: "child-123", parentId, designAnchor: anchor,
			body: after.body, relations: after.relations, changeComment: "결정 변경",
		});
		expect(complete.state).toBe("complete");
		expect(existsSync(journalPath(sid))).toBe(true);
		expect(getIntent(prepared.updateIntentId).state).toBe("complete");
	});

	test("rejects missing or mismatched completion verification", () => {
		setup();
		const prepared = updatePrepare({ childId: "child-123", parentId, designAnchor: anchor, before: {}, after: { body: "new", relations: [] }, changeComment: "why" });
		expect(() => updateComplete(prepared.updateIntentId, { childId: "child-123", parentId, designAnchor: anchor, body: "new", relations: [] } as never)).toThrow();
		updateMutationWritten(prepared.updateIntentId, { childId: "child-123", parentId, designAnchor: anchor });
		expect(() => updateComplete(prepared.updateIntentId, { childId: "child-123", parentId, designAnchor: "wrong", body: "new", relations: [], changeComment: "why" })).toThrow();
	});

	test("writes are session-scoped, omit sessionId, and leave no temp files", () => {
		setup();
		const first = createPrepare({ parentId, designAnchor: anchor, creationPayload: { parentId, designAnchor: anchor } });
		process.env.OMT_SESSION_ID = "other-session";
		const second = createPrepare({ parentId, designAnchor: anchor, creationPayload: { parentId, designAnchor: anchor } });
		expect(first.createIntentId).not.toBe(second.createIntentId);
		const firstRaw = readFileSync(journalPath(sid), "utf8");
		expect(firstRaw).not.toContain("sessionId");
		expect(existsSync(journalPath("other-session"))).toBe(true);
		expect(readdirSync(omtDir).some((name) => name.includes(".tmp."))).toBe(false);
	});

	test("serializes concurrent appends to one session journal", async () => {
		setup();
		const modulePath = resolve("skills/craft-tasks/scripts/task-write-journal.ts");
		const workers = 24;
		const script = `import { createPrepare } from ${JSON.stringify(modulePath)}; createPrepare({ parentId: process.argv[1], designAnchor: ${JSON.stringify(anchor)}, creationPayload: { body: process.argv[1], relations: [] } });`;
		await Promise.all(Array.from({ length: workers }, (_, index) => new Promise<void>((resolveWorker, rejectWorker) => {
			const child = spawn("bun", ["-e", script, `parent-${index}`], {
				env: { ...process.env, OMT_DIR: omtDir, OMT_SESSION_ID: sid },
				stdio: "ignore",
			});
			child.once("error", rejectWorker);
			child.once("exit", (code) => code === 0 ? resolveWorker() : rejectWorker(new Error(`worker exited with code ${code}`)));
		})));
		const journal = JSON.parse(readFileSync(journalPath(sid), "utf8")) as { intents: unknown[] };
		expect(journal.intents).toHaveLength(workers);
	});

	test("retries when a normal owner release briefly leaves an empty lock", async () => {
		setup();
		const lockPath = `${journalPath(sid)}.lock`;
		mkdirSync(lockPath, { recursive: true });
		const modulePath = resolve("skills/craft-tasks/scripts/task-write-journal.ts");
		const child = spawn("bun", ["-e", `import { createPrepare } from ${JSON.stringify(modulePath)}; createPrepare({ parentId: "p", designAnchor: "a", creationPayload: { body: "b", relations: [] } });`], {
			env: { ...process.env, OMT_DIR: omtDir, OMT_SESSION_ID: sid },
			stdio: "ignore",
		});
		await new Promise((resolveRelease) => setTimeout(() => {
			rmSync(lockPath, { recursive: true, force: true });
			resolveRelease(undefined);
		}, 25));
		const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
			child.once("error", rejectExit);
			child.once("exit", (code) => resolveExit(code ?? 1));
		});
		expect(exitCode).toBe(0);
		expect(JSON.parse(readFileSync(journalPath(sid), "utf8")).intents).toHaveLength(1);
	});

	test("recovers a legacy empty ownerless lock", () => {
		setup();
		const lockPath = `${journalPath(sid)}.lock`;
		mkdirSync(lockPath, { recursive: true });
		const stale = new Date(Date.now() - 2000);
		utimesSync(lockPath, stale, stale);
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { body: "b", relations: [] } });
		expect(prepared.state).toBe("prepared");
		expect(existsSync(lockPath)).toBe(false);
	});

	test("preserves a fresh empty legacy lock and fails boundedly without journal mutation", () => {
		setup();
		const lockPath = `${journalPath(sid)}.lock`;
		mkdirSync(lockPath, { recursive: true });
		const modulePath = resolve("skills/craft-tasks/scripts/task-write-journal.ts");
		expect(() => execFileSync("bun", ["-e", `import { createPrepare } from ${JSON.stringify(modulePath)}; createPrepare({ parentId: "p", designAnchor: "a", creationPayload: { body: "b", relations: [] } });`], {
			env: { ...process.env, OMT_DIR: omtDir, OMT_SESSION_ID: sid },
			stdio: "ignore",
			timeout: 1000,
		})).toThrow();
		expect(existsSync(lockPath)).toBe(true);
		expect(existsSync(journalPath(sid))).toBe(false);
	});

	test("recovers an empty legacy lock older than the initialization grace", () => {
		setup();
		const lockPath = `${journalPath(sid)}.lock`;
		mkdirSync(lockPath, { recursive: true });
		const stale = new Date(Date.now() - 2000);
		utimesSync(lockPath, stale, stale);
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { body: "b", relations: [] } });
		expect(prepared.state).toBe("prepared");
		expect(existsSync(lockPath)).toBe(false);
	});

	test("fails boundedly and preserves a malformed owner lock", () => {
		setup();
		const lockPath = `${journalPath(sid)}.lock`;
		mkdirSync(lockPath, { recursive: true });
		writeFileSync(`${lockPath}/owner`, "not-a-pid\n", "utf8");
		const modulePath = resolve("skills/craft-tasks/scripts/task-write-journal.ts");
		const started = Date.now();
		expect(() => execFileSync("bun", ["-e", `import { createPrepare } from ${JSON.stringify(modulePath)}; createPrepare({ parentId: "p", designAnchor: "a", creationPayload: { body: "b", relations: [] } });`], {
			env: { ...process.env, OMT_DIR: omtDir, OMT_SESSION_ID: sid },
			stdio: "ignore",
			timeout: 1000,
		})).toThrow();
		expect(Date.now() - started).toBeLessThan(900);
		expect(readFileSync(`${lockPath}/owner`, "utf8")).toBe("not-a-pid\n");
	});

	test("fails boundedly and preserves a live owner lock without journal mutation", () => {
		setup();
		const lockPath = `${journalPath(sid)}.lock`;
		mkdirSync(lockPath, { recursive: true });
		writeFileSync(`${lockPath}/owner`, `${process.pid}\n`, "utf8");
		const modulePath = resolve("skills/craft-tasks/scripts/task-write-journal.ts");
		const started = Date.now();
		expect(() => execFileSync("bun", ["-e", `import { createPrepare } from ${JSON.stringify(modulePath)}; createPrepare({ parentId: "p", designAnchor: "a", creationPayload: { body: "b", relations: [] } });`], {
			env: { ...process.env, OMT_DIR: omtDir, OMT_SESSION_ID: sid },
			stdio: "ignore",
			timeout: 1000,
		})).toThrow();
		expect(Date.now() - started).toBeLessThan(900);
		expect(readFileSync(`${lockPath}/owner`, "utf8")).toBe(`${process.pid}\n`);
		expect(existsSync(journalPath(sid))).toBe(false);
	});

	test("lists pending intents from another session without changing journals", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { body: "b", relations: [] } });
		const before = readFileSync(journalPath(sid), "utf8");
		process.env.OMT_SESSION_ID = "new-session";
		expect(() => getIntent(prepared.createIntentId)).toThrow(`Unknown intent: ${prepared.createIntentId}`);
		expect(listPending()).toEqual([{
			sourceSessionId: sid,
			intentId: prepared.createIntentId,
			kind: "create",
			state: "prepared",
			parentId,
			designAnchor: anchor,
		}]);
		expect(readFileSync(journalPath(sid), "utf8")).toBe(before);
	});

	test("keeps default lookup isolated and allows explicit source-session transitions", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { body: "b", relations: [] } });
		process.env.OMT_SESSION_ID = "new-session";
		expect(() => getIntent(prepared.createIntentId)).toThrow(`Unknown intent: ${prepared.createIntentId}`);
		expect(getIntent(prepared.createIntentId, sid).state).toBe("prepared");
		expect(createChild(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor }, sid).state).toBe("child-created");
	});

	test("lists deterministic nonterminal entries and omits terminal intents", () => {
		setup();
		const first = createPrepare({ parentId: "parent-z", designAnchor: anchor, creationPayload: { body: "z", relations: [] } });
		const second = createPrepare({ parentId: "parent-a", designAnchor: anchor, creationPayload: { body: "a", relations: [] } });
		manualReconciliation(first.createIntentId, "stop");
		process.env.OMT_SESSION_ID = "another-session";
		const third = createPrepare({ parentId, designAnchor: anchor, creationPayload: { body: "c", relations: [] } });
		const pending = listPending();
		const ids = pending.map((entry) => {
			if ("error" in entry) throw new Error(entry.error);
			return entry.intentId;
		});
		expect(ids[0]).toBe(third.createIntentId);
		expect(ids.slice(1)).toEqual([first.createIntentId, second.createIntentId].sort());
	});

	test("reports malformed matching journals and rejects unsafe explicit sessions", () => {
		setup();
		mkdirSync(omtDir, { recursive: true });
		writeFileSync(join(omtDir, "task-write-journal-bad-session.json"), "{broken\n", "utf8");
		writeFileSync(join(omtDir, "task-write-journal-unsafe.session.json"), "{broken\n", "utf8");
		expect(listPending()).toEqual([{ sourceSessionId: "bad-session", error: "Malformed task-write journal JSON" }]);
		expect(() => getIntent("anything", "unsafe.session")).toThrow("Unsafe session id");
	});

	test("explicit source-session supports update transition", () => {
		setup();
		const prepared = updatePrepare({ childId: "child-123", parentId, designAnchor: anchor, before: {}, after: { body: "new", relations: [] }, changeComment: "why" });
		process.env.OMT_SESSION_ID = "new-session";
		updateMutationWritten(prepared.updateIntentId, { childId: "child-123", parentId, designAnchor: anchor }, sid);
		expect(updateComplete(prepared.updateIntentId, { childId: "child-123", parentId, designAnchor: anchor, body: "new", relations: [], changeComment: "why" }, sid).state).toBe("complete");
	});

	test("CLI emits JSON and accepts the nested creation payload on stdin", () => {
		setup();
		const output = execFileSync("bun", [resolve("skills/craft-tasks/scripts/task-write-journal.ts"), "create-prepare"], {
			input: JSON.stringify({ parentId, designAnchor: anchor, creationPayload: { body: "b", relations: [], identityComment: "i" } }),
			env: { ...process.env, OMT_DIR: omtDir, OMT_SESSION_ID: sid },
			encoding: "utf8",
		});
		const parsed = JSON.parse(output) as { state: string; taskKey: string; creationPayload: Record<string, unknown>; identityComment: string };
		expect(parsed.state).toBe("prepared");
		expect(parsed.creationPayload).toEqual({ parentId, body: "b", relations: [] });
		expect(parsed.identityComment).toBe(`<!-- Task identity\ntaskKey: ${parsed.taskKey}\n-->`);
		expect(parsed.creationPayload).not.toHaveProperty("identityComment");
	});

	test("CLI create-complete accepts the nested exact creation payload", () => {
		setup();
		const cli = resolve("skills/craft-tasks/scripts/task-write-journal.ts");
		const env = { ...process.env, OMT_DIR: omtDir, OMT_SESSION_ID: sid };
		const prepared = JSON.parse(execFileSync("bun", [cli, "create-prepare"], {
			input: JSON.stringify({ parentId, designAnchor: anchor, creationPayload: { description: "CLI 내용", blockedBy: ["task-1", "task-2"] } }), env, encoding: "utf8",
		})) as { createIntentId: string; taskKey: string; creationPayload: Record<string, unknown>; identityComment: string };
		execFileSync("bun", [cli, "create-child", prepared.createIntentId], {
			input: JSON.stringify({ childId: "child-cli", parentId, designAnchor: anchor }), env, encoding: "utf8",
		});
		const complete = JSON.parse(execFileSync("bun", [cli, "create-complete", prepared.createIntentId], {
			input: JSON.stringify({ childId: "child-cli", parentId, designAnchor: anchor, creationPayload: { ...prepared.creationPayload }, identityComment: prepared.identityComment }), env, encoding: "utf8",
		})) as { state: string };
		expect(complete.state).toBe("complete");
	});

	test("retains terminal create receipt and acknowledges it by exact identity", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { body: "b", relations: [] } });
		createChild(prepared.createIntentId, { childId: "child-receipt", parentId, designAnchor: anchor });
		const complete = createComplete(prepared.createIntentId, { childId: "child-receipt", parentId, designAnchor: anchor, creationPayload: prepared.creationPayload, identityComment: prepared.identityComment });
		expect(complete.state).toBe("complete");
		expect(getIntent(prepared.createIntentId).childId).toBe("child-receipt");
		expect(listPending()).toEqual([{ sourceSessionId: sid, intentId: prepared.createIntentId, kind: "create", state: "complete", parentId, designAnchor: anchor, childId: "child-receipt", taskKey: prepared.taskKey }]);
		receiptAck(prepared.createIntentId, { taskKey: prepared.taskKey, childId: "child-receipt", parentId, designAnchor: anchor });
		expect(() => getIntent(prepared.createIntentId)).toThrow();
		expect(existsSync(journalPath(sid))).toBe(false);
	});

	test("complete replay is idempotent only with full matching association", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { body: "b", relations: [] } });
		createChild(prepared.createIntentId, { childId: "child-replay", parentId, designAnchor: anchor });
		const verification = { childId: "child-replay", parentId, designAnchor: anchor, creationPayload: prepared.creationPayload, identityComment: prepared.identityComment };
		createComplete(prepared.createIntentId, verification);
		expect(createComplete(prepared.createIntentId, verification).state).toBe("complete");
		expect(() => createComplete(prepared.createIntentId, { ...verification, childId: "other" })).toThrow();
	});

	test("ack preserves unrelated terminal and nonterminal intents and supports update", () => {
		setup();
		const first = createPrepare({ parentId, designAnchor: anchor, creationPayload: { body: "a", relations: [] } });
		const update = updatePrepare({ childId: "child-u", parentId, designAnchor: anchor, before: {}, after: { body: "new", relations: [] }, changeComment: "why" });
		manualReconciliation(first.createIntentId, "recover");
		updateMutationWritten(update.updateIntentId, { childId: "child-u", parentId, designAnchor: anchor });
		updateComplete(update.updateIntentId, { childId: "child-u", parentId, designAnchor: anchor, body: "new", relations: [], changeComment: "why" });
		expect(() => receiptAck(update.updateIntentId, { childId: "wrong", parentId, designAnchor: anchor })).toThrow();
		receiptAck(first.createIntentId, { taskKey: first.taskKey, parentId, designAnchor: anchor });
		expect(getIntent(update.updateIntentId).state).toBe("complete");
		receiptAck(update.updateIntentId, { childId: "child-u", parentId, designAnchor: anchor });
		expect(existsSync(journalPath(sid))).toBe(false);
	});

	test("CLI receipt-ack removes a terminal receipt", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { body: "b", relations: [] } });
		manualReconciliation(prepared.createIntentId, "recover");
		const output = execFileSync("bun", [resolve("skills/craft-tasks/scripts/task-write-journal.ts"), "receipt-ack", prepared.createIntentId], {
			input: JSON.stringify({ parentId, designAnchor: anchor, taskKey: prepared.taskKey }), env: { ...process.env, OMT_DIR: omtDir, OMT_SESSION_ID: sid }, encoding: "utf8",
		});
		expect(JSON.parse(output)).toMatchObject({ state: "manual-reconciliation-required", createIntentId: prepared.createIntentId });
		expect(existsSync(journalPath(sid))).toBe(false);
	});
});

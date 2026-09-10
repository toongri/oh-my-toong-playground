import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
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
		};
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: payload });
		expect(prepared.state).toBe("prepared");
		expect(prepared.taskKey).not.toBe(prepared.createIntentId);
		const canonicalComment = `<!-- Task identity\ntaskKey: ${prepared.taskKey}\n-->`;
		expect(prepared.creationPayload).toEqual({ ...payload, identityComment: canonicalComment });
		expect((prepared.creationPayload as Record<string, unknown>).body).toBe(payload.body);
		expect((prepared.creationPayload as Record<string, unknown>).relations).toEqual(payload.relations);
		expect((prepared.creationPayload as Record<string, unknown>).title).toBe(payload.title);

		const child = createChild(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor });
		expect(child.state).toBe("child-created");
		const complete = createComplete(prepared.createIntentId, {
			childId: "child-123",
			parentId,
			designAnchor: anchor,
			title: payload.title,
			body: payload.body,
			relations: payload.relations,
			identityComment: canonicalComment,
		});
		expect(complete.state).toBe("complete");
		expect(getIntent(prepared.createIntentId)).toMatchObject({
			createIntentId: prepared.createIntentId,
			taskKey: prepared.taskKey,
			creationPayload: { ...payload, identityComment: canonicalComment },
		});
	});

	test("rejects arbitrary or mismatched identity comments", () => {
		setup();
		const prepared = createPrepare({
			parentId,
			designAnchor: anchor,
			creationPayload: { title: "제목", body: "b", relations: [], identityComment: "arbitrary" },
		});
		const canonicalComment = `<!-- Task identity\ntaskKey: ${prepared.taskKey}\n-->`;
		expect((prepared.creationPayload as Record<string, unknown>).identityComment).toBe(canonicalComment);
		createChild(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor });
		expect(() => createComplete(prepared.createIntentId, {
			childId: "child-123", parentId, designAnchor: anchor,
			title: "제목", body: "b", relations: [], identityComment: "arbitrary",
		})).toThrow("identityComment verification mismatch");
		expect(getIntent(prepared.createIntentId).state).toBe("child-created");
	});

	test("rejects a journal identity comment that no longer matches its taskKey", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { title: "제목", body: "b", relations: [] } });
		createChild(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor });
		const path = journalPath(sid);
		const journal = JSON.parse(readFileSync(path, "utf8")) as { intents: Array<{ creationPayload: Record<string, unknown> }> };
		journal.intents[0].creationPayload.identityComment = "<!-- Task identity\ntaskKey: forged\n-->";
		writeFileSync(path, `${JSON.stringify(journal)}\n`, "utf8");
		expect(() => createComplete(prepared.createIntentId, {
			childId: "child-123", parentId, designAnchor: anchor,
			title: "제목", body: "b", relations: [], identityComment: "<!-- Task identity\ntaskKey: forged\n-->",
		})).toThrow("stored identityComment mismatch");
	});

	test("rejects mismatched child association and terminal mutation", () => {
		setup();
		const prepared = createPrepare({
			parentId,
			designAnchor: anchor,
			creationPayload: { parentId, designAnchor: anchor, body: "b", relations: [], identityComment: "i" },
		});
		expect(() => createChild(prepared.createIntentId, { childId: "child-123", parentId: "other", designAnchor: anchor })).toThrow();
		createChild(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor });
		createComplete(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor, body: "b", relations: [], identityComment: (prepared.creationPayload as Record<string, unknown>).identityComment });
		expect(() => manualReconciliation(prepared.createIntentId, "late discovery")).toThrow();
	});

	test("manual reconciliation is terminal and does not create a replacement entry", () => {
		setup();
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: { parentId, designAnchor: anchor } });
		const reconciled = manualReconciliation(prepared.createIntentId, "PM response was lost");
		expect(reconciled.state).toBe("manual-reconciliation-required");
		expect(getIntent(prepared.createIntentId).reason).toBe("PM response was lost");
		expect(readFileSync(journalPath(sid), "utf8")).not.toContain("replacement");
		expect((getIntent(prepared.createIntentId) as { createIntentId: string }).createIntentId).toBe(prepared.createIntentId);
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
		expect(getIntent(prepared.updateIntentId)).toMatchObject({ before, after, changeComment: "결정 변경" });
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
		expect(pending.map((entry) => {
			if ("error" in entry) throw new Error(entry.error);
			return entry.intentId;
		})).toEqual([third.createIntentId, second.createIntentId]);
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

	test("CLI emits JSON and accepts the exact creation payload on stdin", () => {
		setup();
		const output = execFileSync("bun", [resolve("skills/craft-tasks/scripts/task-write-journal.ts"), "create-prepare"], {
			input: JSON.stringify({ parentId, designAnchor: anchor, body: "b", relations: [], identityComment: "i" }),
			env: { ...process.env, OMT_DIR: omtDir, OMT_SESSION_ID: sid },
			encoding: "utf8",
		});
		const parsed = JSON.parse(output) as { state: string; taskKey: string; creationPayload: Record<string, unknown> };
		expect(parsed.state).toBe("prepared");
		expect(parsed.creationPayload).toEqual({ parentId, designAnchor: anchor, body: "b", relations: [], identityComment: `<!-- Task identity\ntaskKey: ${parsed.taskKey}\n-->` });
});
});

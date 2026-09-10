import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "fs";
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
			parentId,
			designAnchor: anchor,
			body: "목적\n...",
			relations: [{ type: "blockedBy", id: "task-1" }],
			identityComment: "taskKey: opaque-key",
			title: "정확한 제목",
		};
		const prepared = createPrepare({ parentId, designAnchor: anchor, creationPayload: payload });
		expect(prepared.state).toBe("prepared");
		expect(prepared.taskKey).not.toBe(prepared.createIntentId);

		const child = createChild(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor });
		expect(child.state).toBe("child-created");
		const complete = createComplete(prepared.createIntentId, {
			childId: "child-123",
			parentId,
			designAnchor: anchor,
			body: payload.body,
			relations: payload.relations,
			identityComment: payload.identityComment,
		});
		expect(complete.state).toBe("complete");
		expect(getIntent(prepared.createIntentId)).toMatchObject({
			createIntentId: prepared.createIntentId,
			taskKey: prepared.taskKey,
			creationPayload: payload,
		});
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
		createComplete(prepared.createIntentId, { childId: "child-123", parentId, designAnchor: anchor, body: "b", relations: [], identityComment: "i" });
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

	test("CLI emits JSON and accepts the exact creation payload on stdin", () => {
		setup();
		const output = execFileSync("bun", [resolve("skills/craft-tasks/scripts/task-write-journal.ts"), "create-prepare"], {
			input: JSON.stringify({ parentId, designAnchor: anchor, body: "b", relations: [], identityComment: "i" }),
			env: { ...process.env, OMT_DIR: omtDir, OMT_SESSION_ID: sid },
			encoding: "utf8",
		});
		const parsed = JSON.parse(output) as { state: string; creationPayload: unknown };
		expect(parsed.state).toBe("prepared");
		expect(parsed.creationPayload).toEqual({ parentId, designAnchor: anchor, body: "b", relations: [], identityComment: "i" });
	});
});

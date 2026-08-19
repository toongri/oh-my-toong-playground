import { describe, expect, it, spyOn } from "bun:test";
import fs from "fs/promises";
import { mkdtemp, readFile, rm, writeFile, mkdir, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DeployTransaction } from "./deploy-transaction.ts";

async function tempRoot(name: string): Promise<string> {
	return mkdtemp(join(tmpdir(), `omt-${name}-`));
}

describe("DeployTransaction", () => {
	it("restores an inventoried file after a successful mutation and rollback", async () => {
		const root = await tempRoot("success");
		try {
			const target = join(root, "settings.json");
			await writeFile(target, "before");
			const transaction = await DeployTransaction.begin(root, false, ["settings.json"]);
			expect(transaction).not.toBeNull();
			expect("checkpoint" in transaction!).toBe(false);
			await transaction!.mutate(target, async () => writeFile(target, "after"));
			await transaction!.rollback();
			expect(await readFile(target, "utf8")).toBe("before");
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("rejects a pre-write external conflict without running the operation", async () => {
		const root = await tempRoot("conflict");
		try {
			const target = join(root, "settings.json");
			await writeFile(target, "before");
			const transaction = await DeployTransaction.begin(root, false, [target]);
			await writeFile(target, "external");
			let calls = 0;
			await expect(transaction!.mutate(target, async () => { calls++; })).rejects.toThrow("conflict");
			expect(calls).toBe(0);
			expect(await readFile(target, "utf8")).toBe("external");
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("records a partial postimage when the operation throws, then rolls back", async () => {
		const root = await tempRoot("partial");
		try {
			const target = join(root, "settings.json");
			await writeFile(target, "before");
			const transaction = await DeployTransaction.begin(root, false, [target]);
			const operationError = new Error("write failed");
			await expect(transaction!.mutate(target, async () => {
				await writeFile(target, "partial");
				throw operationError;
			})).rejects.toBe(operationError);
			await transaction!.rollback();
			expect(await readFile(target, "utf8")).toBe("before");
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("preserves an external overwrite after a successful mutation", async () => {
		const root = await tempRoot("external");
		try {
			const target = join(root, "settings.json");
			await writeFile(target, "before");
			const transaction = await DeployTransaction.begin(root, false, [target]);
			await transaction!.mutate(target, async () => writeFile(target, "omt"));
			await writeFile(target, "external");
			await transaction!.rollback();
			expect(await readFile(target, "utf8")).toBe("external");
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("removes a path that was absent at the transaction boundary", async () => {
		const root = await tempRoot("absent");
		try {
			const target = join(root, "created.json");
			const transaction = await DeployTransaction.begin(root, false, [target]);
			await transaction!.mutate(target, async () => writeFile(target, "created"));
			await transaction!.rollback();
			expect(await lstat(target).catch(() => null)).toBeNull();
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("rejects an inventoried dependency conflict before running its operation", async () => {
		const root = await tempRoot("owner-conflict");
		try {
			const owner = join(root, "hook");
			const dependency = join(root, "dep.sh");
			await writeFile(owner, "old-hook");
			await writeFile(dependency, "old-dep");
			const transaction = await DeployTransaction.begin(root, false, [owner, dependency]);
			await writeFile(dependency, "external");
			let calls = 0;
			await expect(transaction!.mutate(dependency, async () => { calls++; })).rejects.toThrow("conflict");
			expect(calls).toBe(0);
			expect(await readFile(dependency, "utf8")).toBe("external");
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("returns null for dry-run and rejects un-inventoried paths", async () => {
		const root = await tempRoot("guards");
		try {
			expect(await DeployTransaction.begin(root, true, ["x"])).toBeNull();
			const transaction = await DeployTransaction.begin(root, false, ["owned"]);
			await expect(transaction!.mutate(join(root, "other"), async () => undefined)).rejects.toThrow("not inventoried");
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("cleans snapshot files on finish", async () => {
		const root = await tempRoot("finish");
		try {
			const target = join(root, "settings.json");
			await writeFile(target, "before");
			const transaction = await DeployTransaction.begin(root, false, [target]);
			await mkdir(join(root, ".claude"), { recursive: true });
			expect((await fs.readdir(join(root, ".claude"))).filter((name) => name.includes("txn-before-")).length).toBe(0);
			await transaction!.finish();
			expect(await fs.readdir(join(root, ".omt", "transactions")).catch(() => [])).toEqual([]);
			expect(await lstat(join(root, ".omt")).catch(() => null)).toBeNull();
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("preserves a manifest-created .omt directory after transaction cleanup", async () => {
		const root = await tempRoot("manifest-topology");
		try {
			await mkdir(join(root, ".omt"), { recursive: true });
			await writeFile(join(root, ".omt", "sync-manifest.json"), "{}\n");
			const transaction = await DeployTransaction.begin(root, false, ["owned"]);
			await transaction!.finish();
			expect(await readFile(join(root, ".omt", "sync-manifest.json"), "utf8")).toBe("{}\n");
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("does not remove a concurrent sibling transaction snapshot", async () => {
		const root = await tempRoot("siblings");
		try {
			const target = join(root, "settings.json");
			await writeFile(target, "before");
			const first = await DeployTransaction.begin(root, false, [target]);
			const second = await DeployTransaction.begin(root, false, [target]);
			await first!.finish();
			await second!.mutate(target, async () => writeFile(target, "after"));
			await second!.rollback();
			await second!.finish();
			expect(await readFile(target, "utf8")).toBe("before");
			expect(await lstat(join(root, ".omt")).catch(() => null)).toBeNull();
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("keeps finish best-effort when snapshot cleanup fails", async () => {
		const root = await tempRoot("finish-error");
		try {
			const transaction = await DeployTransaction.begin(root, false, ["owned"]);
			const rmSpy = spyOn(fs, "rm").mockRejectedValueOnce(new Error("cleanup failed"));
			await expect(transaction!.finish()).resolves.toBeUndefined();
			rmSpy.mockRestore();
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("restores a file when its parent directory was removed by the operation", async () => {
		const root = await tempRoot("parent-removed");
		try {
			const target = join(root, ".claude", "settings.json");
			await mkdir(join(root, ".claude"), { recursive: true });
			await writeFile(target, "before");
			const transaction = await DeployTransaction.begin(root, false, [target]);
			await transaction!.mutate(target, async () => rm(join(root, ".claude"), { recursive: true, force: true }));
			await transaction!.rollback();
			expect(await readFile(target, "utf8")).toBe("before");
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("propagates a baseline restore rename failure", async () => {
		const root = await tempRoot("rename-failure");
		try {
			const target = join(root, "settings.json");
			await writeFile(target, "before");
			const transaction = await DeployTransaction.begin(root, false, [target]);
			await transaction!.mutate(target, async () => writeFile(target, "after"));
			const renameSpy = spyOn(fs, "rename").mockRejectedValueOnce(new Error("restore failed"));
			await expect(transaction!.rollback()).rejects.toThrow("restore failed");
			renameSpy.mockRestore();
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("restores after a delete-then-throw mutation even when rm reports an error", async () => {
		const root = await tempRoot("rm-throw");
		try {
			const target = join(root, "settings.json");
			await writeFile(target, "before");
			const transaction = await DeployTransaction.begin(root, false, [target]);
			const originalRm = fs.rm.bind(fs);
			const rmSpy = spyOn(fs, "rm");
			rmSpy.mockImplementation(async (candidate, options) => {
				await originalRm(candidate, options);
				if (String(candidate) === target) throw new Error("delete reported late");
			});
			await expect(transaction!.mutate(target, async () => fs.rm(target, { force: true }))).rejects.toThrow("delete reported late");
			await transaction!.rollback();
			rmSpy.mockRestore();
			expect(await readFile(target, "utf8")).toBe("before");
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("preserves the operation error when postimage fingerprinting fails", async () => {
		const root = await tempRoot("postimage-error");
		try {
			const target = join(root, "settings.json");
			await writeFile(target, "before");
			const transaction = await DeployTransaction.begin(root, false, [target]);
			const operationError = new Error("operation failed");
			const fingerprintError = new Error("fingerprint failed");
			let restoreRead: (() => void) | undefined;
			await expect(transaction!.mutate(target, async () => {
				await writeFile(target, "partial");
				const readSpy = spyOn(fs, "readFile").mockRejectedValue(fingerprintError);
				restoreRead = () => readSpy.mockRestore();
				throw operationError;
			})).rejects.toBe(operationError);
			restoreRead?.();
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("propagates snapshot and fingerprint read failures instead of treating them as absent", async () => {
		const root = await tempRoot("snapshot-errors");
		try {
			const target = join(root, "settings.json");
			await writeFile(target, "before");
			const cpSpy = spyOn(fs, "cp").mockRejectedValueOnce(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
			await expect(DeployTransaction.begin(root, false, [target])).rejects.toThrow("disk full");
			cpSpy.mockRestore();
			const readSpy = spyOn(fs, "readFile").mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }));
			await expect(DeployTransaction.begin(root, false, [target])).rejects.toThrow("permission denied");
			readSpy.mockRestore();
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("rejects absolute, relative-escape, and root paths without snapshot writes", async () => {
		const root = await tempRoot("confinement");
		try {
			for (const owned of [join(root, "..", "outside"), "../outside", root]) {
				await expect(DeployTransaction.begin(root, false, [owned])).rejects.toThrow();
			}
			expect((await fs.readdir(root)).length).toBe(0);
		} finally { await rm(root, { recursive: true, force: true }); }
	});
});

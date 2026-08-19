import fs from "fs/promises";
import path from "path";
import { createHash } from "node:crypto";

export type DeployMutationHooks = {
	mutate(targetPath: string, operation: () => Promise<void>): Promise<void>;
};

type DeployTransactionEntry = {
	live: string;
	before: string;
	expected: string;
	owners?: string[];
};

export type DeployOwnedPath = string | { path: string; owner?: string };

const DEFAULT_PATHS = [
	".claude/lib", ".codex/lib", ".agents/lib",
	".claude/scripts/pretool-trace", ".codex/scripts/pretool-trace",
	".claude/settings.local.json", ".claude/settings.json", ".gemini/settings.json",
	".codex/hooks.json", ".codex/config.toml", ".opencode/opencode.json",
];

function isWithin(root: string, candidate: string): boolean {
	return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const code = Reflect.get(error, "code");
	return typeof code === "string" ? code : undefined;
}

async function removeEmptyDirectory(target: string): Promise<void> {
	try { await fs.rmdir(target); } catch (error) {
		if (errorCode(error) !== "ENOENT" && errorCode(error) !== "ENOTEMPTY") throw error;
	}
}

async function pathExists(target: string): Promise<boolean> {
	try { await fs.lstat(target); return true; } catch (error) {
		if (errorCode(error) === "ENOENT") return false;
		throw error;
	}
}

async function fingerprint(target: string): Promise<string> {
	const hash = createHash("sha256");
	const walk = async (current: string, rel = ""): Promise<void> => {
		let entries: import("fs").Dirent[];
		try {
			entries = await fs.readdir(current, { withFileTypes: true });
		} catch (error) {
			if (errorCode(error) === "ENOENT") return;
			throw error;
		}
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const abs = path.join(current, entry.name);
			const child = path.join(rel, entry.name);
			if (entry.isDirectory()) { hash.update(`d:${child}\n`); await walk(abs, child); }
			else if (entry.isSymbolicLink()) hash.update(`l:${child}:${await fs.readlink(abs)}\n`);
			else hash.update(`f:${child}:${await fs.readFile(abs, "base64")}\n`);
		}
	};
	try {
		if ((await fs.lstat(target)).isDirectory()) await walk(target);
		else hash.update(await fs.readFile(target, "base64"));
	} catch (error) {
		if (errorCode(error) !== "ENOENT") throw error;
		hash.update("<absent>");
	}
	return hash.digest("hex");
}

export class DeployTransaction implements DeployMutationHooks {
	private constructor(
		private readonly entries: DeployTransactionEntry[],
		private readonly deployRoot: string,
		private readonly snapshotRoot: string,
	) {}

	static async begin(
		deployRoot: string,
		dryRun: boolean,
		ownedPaths: DeployOwnedPath[] = [],
	): Promise<DeployTransaction | null> {
		if (dryRun) return null;
		const root = path.resolve(deployRoot);
		const omtDir = path.join(root, ".omt");
		const transactionsDir = path.join(omtDir, "transactions");
		const omtExisted = await fs.lstat(omtDir).then(() => true).catch((error) => {
			if (errorCode(error) === "ENOENT") return false;
			throw error;
		});
		const transactionsExisted = await fs.lstat(transactionsDir).then(() => true).catch((error) => {
			if (errorCode(error) === "ENOENT") return false;
			throw error;
		});
		const entryOwners = new Map<string, string[]>();
		const names = [...DEFAULT_PATHS];
		for (const owned of ownedPaths) {
			const rawPath = typeof owned === "string" ? owned : owned.path;
			const live = path.resolve(root, rawPath);
			if (!isWithin(root, live) || live === root) throw new Error(`Deploy transaction path escapes deploy root: ${rawPath}`);
			const normalized = path.relative(root, live);
			names.push(normalized);
			if (typeof owned !== "string" && owned.owner) {
				const owner = path.resolve(root, owned.owner);
				if (!isWithin(root, owner) || owner === root) throw new Error(`Deploy transaction owner escapes deploy root: ${owned.owner}`);
				const owners = entryOwners.get(normalized) ?? [];
				if (!owners.includes(owner)) owners.push(owner);
				entryOwners.set(normalized, owners);
			}
		}
		const entries: DeployTransactionEntry[] = [];
		let snapshotRoot: string | undefined;
		try {
			await fs.mkdir(transactionsDir, { recursive: true });
			snapshotRoot = await fs.mkdtemp(path.join(transactionsDir, "txn-"));
			let index = 0;
			for (const name of [...new Set(names.map((value) => path.normalize(value)))]) {
				const live = path.join(root, name);
				const before = path.join(snapshotRoot, String(index++));
				try {
					await fs.cp(live, before, { recursive: true, force: true, dereference: false });
				} catch (error) {
					if (errorCode(error) !== "ENOENT") throw error;
				}
				entries.push({ live, before, expected: await fingerprint(live), owners: entryOwners.get(name) });
			}
		} catch (error) {
			if (snapshotRoot) await fs.rm(snapshotRoot, { recursive: true, force: true }).catch(() => undefined);
			if (!transactionsExisted) await removeEmptyDirectory(transactionsDir).catch(() => undefined);
			if (!omtExisted) await removeEmptyDirectory(omtDir).catch(() => undefined);
			throw error;
		}
		if (!snapshotRoot) throw new Error("Deploy transaction snapshot was not created");
		return new DeployTransaction(entries, root, snapshotRoot);
	}

	private entryFor(targetPath: string): DeployTransactionEntry {
		const normalized = path.normalize(path.resolve(this.deployRoot, targetPath));
		const entry = this.entries.find((candidate) => path.normalize(candidate.live) === normalized);
		if (!entry) throw new Error(`Deploy transaction target was not inventoried: ${targetPath}`);
		return entry;
	}

	async mutate(targetPath: string, operation: () => Promise<void>): Promise<void> {
		const entry = this.entryFor(targetPath);
		if (await fingerprint(entry.live) !== entry.expected) {
			throw new Error(`Deploy transaction conflict: ${targetPath}`);
		}
		try {
			await operation();
		} catch (error) {
			try { entry.expected = await fingerprint(entry.live); } catch { /* preserve operation error */ }
			throw error;
		}
		entry.expected = await fingerprint(entry.live);
	}

	async checkpoint(livePaths: readonly string[]): Promise<void> {
		for (const livePath of livePaths) {
			const entry = this.entries.find((candidate) => path.normalize(candidate.live) === path.normalize(path.resolve(this.deployRoot, livePath)));
			if (!entry) continue;
			entry.expected = await fingerprint(entry.live);
			for (const dependency of this.entries.filter((candidate) => candidate.owners?.includes(entry.live))) {
				dependency.expected = await fingerprint(dependency.live);
			}
		}
	}

	async finish(): Promise<void> {
		await fs.rm(this.snapshotRoot, { recursive: true, force: true }).catch(() => undefined);
		await removeEmptyDirectory(path.dirname(this.snapshotRoot)).catch(() => undefined);
		await removeEmptyDirectory(path.dirname(path.dirname(this.snapshotRoot))).catch(() => undefined);
	}

	async rollback(): Promise<void> {
		for (const entry of this.entries) {
			if (await fingerprint(entry.live) !== entry.expected) continue;
			const hasBaseline = await pathExists(entry.before);
			if (!hasBaseline) {
				await fs.rm(entry.live, { recursive: true, force: true });
				continue;
			}
			await fs.rm(entry.live, { recursive: true, force: true }).catch(async (error) => {
				if (await pathExists(entry.live)) throw error;
			});
			await fs.mkdir(path.dirname(entry.live), { recursive: true });
			await fs.rename(entry.before, entry.live);
		}
	}
}

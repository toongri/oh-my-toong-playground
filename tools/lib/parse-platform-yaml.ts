import { promises as fs } from "fs";
import path from "path";
import { deepMergeOverlay } from "./deep-merge-overlay.ts";
import type { PlatformYaml } from "./types.ts";

type YamlReadResult =
	{ kind: "missing" } | { kind: "empty" } | { kind: "object"; value: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function readYamlResult(filePath: string): Promise<YamlReadResult> {
	let text: string;
	try {
		text = await fs.readFile(filePath, "utf8");
	} catch {
		return { kind: "missing" };
	}
	const parsed = Bun.YAML.parse(text);
	if (!isRecord(parsed)) return { kind: "empty" };
	return { kind: "object", value: parsed };
}

export async function parseAndMergePlatformYaml(
	dir: string,
	platform: string,
): Promise<PlatformYaml | null> {
	const basePath = path.join(dir, `${platform}.yaml`);
	const localPath = path.join(dir, `${platform}.local.yaml`);

	const baseResult = await readYamlResult(basePath);
	const localResult = await readYamlResult(localPath);

	const baseObj = baseResult.kind === "object" ? baseResult.value : undefined;
	const localObj = localResult.kind === "object" ? localResult.value : undefined;

	if (baseObj === undefined && localObj === undefined) return null;

	const merged = deepMergeOverlay(baseObj ?? {}, localObj ?? {});

	// Merged YAML content is trusted to match PlatformYaml's shape; no runtime
	// schema validation exists for the merged config tree.
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- untyped YAML → domain type boundary, no runtime validator available
	return merged as PlatformYaml;
}

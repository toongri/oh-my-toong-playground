import { promises as fs } from "fs";
import path from "path";
import { expandTilde } from "./path-utils.ts";
import { deepMergeOverlay } from "./deep-merge-overlay.ts";
import type { SyncYaml } from "./types.ts";

type YamlReadResult =
  | { kind: "missing" }
  | { kind: "empty" }
  | { kind: "object"; value: Record<string, unknown> };

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

export async function readAndExpandSyncYaml(
  syncYamlPath: string,
): Promise<SyncYaml | null> {
  const dir = path.dirname(syncYamlPath);
  const localPath = path.join(dir, "sync.local.yaml");

  const baseResult = await readYamlResult(syncYamlPath);
  const localResult = await readYamlResult(localPath);

  if (baseResult.kind === "missing" && localResult.kind === "missing") {
    await fs.readFile(syncYamlPath, "utf8");
    return null;
  }

  const baseObj = baseResult.kind === "object" ? baseResult.value : undefined;
  const localObj = localResult.kind === "object" ? localResult.value : undefined;

  if (baseObj === undefined && localObj === undefined) return null;

  const merged = deepMergeOverlay(baseObj ?? {}, localObj ?? {});

  // Merged YAML content is trusted to match SyncYaml's shape; no runtime
  // schema validation exists for the merged config tree.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- untyped YAML → domain type boundary, no runtime validator available
  const result = merged as SyncYaml;

  if (result.path) result.path = expandTilde(result.path);
  return result;
}

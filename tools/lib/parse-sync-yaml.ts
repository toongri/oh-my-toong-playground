import { promises as fs } from "fs";
import path from "path";
import { expandTilde } from "./path-utils.ts";
import { deepMergeOverlay } from "./deep-merge-overlay.ts";
import type { SyncYaml } from "./types.ts";

type YamlReadResult =
  | { kind: "missing" }
  | { kind: "empty" }
  | { kind: "object"; value: Record<string, unknown> };

async function readYamlResult(filePath: string): Promise<YamlReadResult> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    return { kind: "missing" };
  }
  const parsed = Bun.YAML.parse(text);
  if (parsed == null || typeof parsed !== "object") return { kind: "empty" };
  return { kind: "object", value: parsed as Record<string, unknown> };
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

  const merged = deepMergeOverlay(
    baseObj as Record<string, unknown>,
    localObj as Record<string, unknown>,
  ) as SyncYaml;

  if (merged.path) merged.path = expandTilde(merged.path);
  return merged;
}

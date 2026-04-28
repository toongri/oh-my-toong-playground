import { promises as fs } from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { deepMergeOverlay } from "./deep-merge-overlay.ts";
import type { PlatformYaml } from "./types.ts";

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
  const parsed = parseYaml(text);
  if (parsed == null || typeof parsed !== "object") return { kind: "empty" };
  return { kind: "object", value: parsed as Record<string, unknown> };
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

  const merged = deepMergeOverlay(
    baseObj as Record<string, unknown>,
    localObj as Record<string, unknown>,
  ) as PlatformYaml;

  return merged;
}

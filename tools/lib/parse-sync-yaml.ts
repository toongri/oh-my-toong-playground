import { promises as fs } from "fs";
import { parse as parseYaml } from "yaml";
import { expandTilde } from "./path-utils.ts";
import type { SyncYaml } from "./types.ts";

/**
 * Read sync.yaml from disk, parse, and expand `~` in `path`.
 *
 * @returns parsed SyncYaml with path expanded, or `null` if the file
 *          is empty or not a YAML object (template state).
 * @throws  any fs read or YAML parse error — callers decide log/recover.
 */
export async function readAndExpandSyncYaml(
  syncYamlPath: string,
): Promise<SyncYaml | null> {
  const text = await fs.readFile(syncYamlPath, "utf8");
  const parsed = parseYaml(text);
  if (parsed == null || typeof parsed !== "object") return null;
  const syncYaml = parsed as SyncYaml;
  if (syncYaml.path) syncYaml.path = expandTilde(syncYaml.path);
  return syncYaml;
}

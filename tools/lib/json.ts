import fs from "fs/promises";
import path from "path";
import { logError } from "./logger.ts";

/** Read JSON file or return {} if missing. */
export async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    logError(`JSON 파싱 실패: ${filePath}: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

/** Write JSON to file, creating parent directories as needed. */
export async function writeJsonFile(filePath: string, data: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

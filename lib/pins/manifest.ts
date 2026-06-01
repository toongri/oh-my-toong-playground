import { promises as fs } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { resolveOmtDir } from '../omt-dir.ts';

export interface PinsManifest {
  location: string;
  scope: string;
}

export type ManifestResult =
  | { kind: 'absent' }
  | { kind: 'resolved'; manifest: PinsManifest };

interface ResolveOptions {
  projectRoot?: string;
  userRoot?: string;
}

async function readManifestAt(dir: string): Promise<PinsManifest | null> {
  const filePath = join(dir, 'pins.yaml');
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseYaml(text);
  if (parsed == null || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.location !== 'string' || typeof obj.scope !== 'string') return null;
  return { location: obj.location, scope: obj.scope };
}

/**
 * Resolves pins.yaml with project-root-first, user-root-fallback precedence.
 *
 * Search order:
 *   1. {projectRoot}/pins.yaml  (defaults to cwd)
 *   2. {userRoot}/pins.yaml     (defaults to resolveOmtDir())
 *
 * Returns { kind: "resolved", manifest } when found, { kind: "absent" } otherwise.
 * Never throws when neither manifest exists. Never creates a file.
 */
export async function resolveManifest(
  options: ResolveOptions = {},
): Promise<ManifestResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const userRoot = options.userRoot ?? resolveOmtDir();

  const fromProject = await readManifestAt(projectRoot);
  if (fromProject !== null) {
    return { kind: 'resolved', manifest: fromProject };
  }

  const fromUser = await readManifestAt(userRoot);
  if (fromUser !== null) {
    return { kind: 'resolved', manifest: fromUser };
  }

  return { kind: 'absent' };
}

import { promises as fs } from 'fs';
import { join } from 'path';
import { resolveOmtDir, resolvePinsHome, resolveProjectRoot } from '../omt-dir.ts';

export interface PinsManifest {
  location: string;
  scope: string;
  /** Whether this pins corpus is git-managed (default false; independent of location). */
  git?: boolean;
}

export type ManifestResult =
  | { kind: 'absent' }
  | { kind: 'resolved'; manifest: PinsManifest };

interface ResolveOptions {
  projectRoot?: string;
  pinsHome?: string;
  userRoot?: string;
}

async function readManifestAt(dir: string): Promise<PinsManifest | null> {
  const filePath = join(dir, 'pins.yaml');
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
  const parsed = Bun.YAML.parse(text);
  if (parsed == null || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.location !== 'string' || typeof obj.scope !== 'string') return null;
  const git = typeof obj.git === 'boolean' ? obj.git : false;
  return { location: obj.location, scope: obj.scope, git };
}

/**
 * Resolves pins.yaml with project-root-first, user-root-fallback precedence.
 *
 * Search order:
 *   1. {projectRoot}/pins.yaml  (defaults to the git project root of cwd)
 *   2. {pinsHome}/pins.yaml     (defaults to resolvePinsHome(projectRoot))
 *   3. {userRoot}/pins.yaml     (defaults to resolveOmtDir())
 *
 * Returns { kind: "resolved", manifest } when found, { kind: "absent" } otherwise.
 * Never throws when neither manifest exists. Never creates a file.
 *
 * The optional `git` field records whether the pins corpus is git-managed
 * (default false; independent of location).
 */
export async function resolveManifest(
  options: ResolveOptions = {},
): Promise<ManifestResult> {
  const projectRoot = options.projectRoot ?? resolveProjectRoot();
  const pinsHome = options.pinsHome ?? resolvePinsHome(projectRoot);
  const userRoot = options.userRoot ?? resolveOmtDir();

  const fromProject = await readManifestAt(projectRoot);
  if (fromProject !== null) {
    return { kind: 'resolved', manifest: fromProject };
  }

  const fromPinsHome = await readManifestAt(pinsHome);
  if (fromPinsHome !== null) {
    return { kind: 'resolved', manifest: fromPinsHome };
  }

  const fromUser = await readManifestAt(userRoot);
  if (fromUser !== null) {
    return { kind: 'resolved', manifest: fromUser };
  }

  return { kind: 'absent' };
}

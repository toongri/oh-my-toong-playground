import { writeFileSync, appendFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { validate } from './validator.ts';
import { serialize, parse } from './entity.ts';
import type { Entity } from './types.ts';
import type { ValidationResult } from './validator.ts';

export interface RecordTarget {
  location: string;
}

/**
 * Record a canonical entity to its manifest-resolved location.
 *
 * - Validates first. If INVALID → appends to <location>/.escape.jsonl
 *   (entry includes ts, id, raw, reason, message) and returns.
 * - If VALID:
 *   - Fresh write: sets status='active', updated_at=created_at (defaults).
 *     Uses O_EXCL (wx) for atomicity on new files.
 *   - Update (id already exists on EEXIST): preserves existing created_at,
 *     bumps updated_at, then overwrites the file in place.
 *
 * Does NOT depend on index correctness.
 * Does NOT hard-code any path — uses manifest.location exclusively.
 */
export async function record(
  entity: Entity,
  target: RecordTarget,
): Promise<void> {
  const result = await validate(entity);

  if (!result.valid) {
    appendEscapeEntry(target.location, entity, result);
    return;
  }

  const fm = entity.frontmatter;
  const existingPath = join(target.location, `${fm.id}.md`);

  // Resolve timestamps
  let createdAt = fm.created_at;
  if (existsSync(existingPath)) {
    // Update path: preserve the original created_at from the file on disk
    try {
      const existing = parse(readFileSync(existingPath, 'utf8'));
      createdAt = existing.frontmatter.created_at;
    } catch {
      // If we can't read/parse the existing file, fall through to fresh defaults
    }
  }

  // Apply defaults for fresh writes (status and updated_at may be missing)
  const status = fm.status ?? 'active';
  const updatedAt = fm.updated_at ?? createdAt;

  const finalEntity: Entity = {
    frontmatter: {
      ...fm,
      created_at: createdAt,
      status,
      updated_at: updatedAt,
    },
    body: entity.body,
  };

  const content = serialize(finalEntity);
  writePinAtomically(target.location, fm.id, content);
}

// ── Atomic write ──────────────────────────────────────────────────────────────

/**
 * Write a pin file in `targetDir`.
 *
 * - New file: uses O_EXCL (wx flag) for atomic create.
 * - EEXIST (file already exists — update path): overwrites in place with 'w'.
 *   The caller has already read and preserved created_at before this point.
 *
 * Any other fs error is re-thrown.
 */
function writePinAtomically(
  targetDir: string,
  id: string,
  content: string,
): void {
  mkdirSync(targetDir, { recursive: true });
  const basePath = join(targetDir, `${id}.md`);

  // Attempt atomic create; if the file already exists we overwrite (update path)
  try {
    writeFileSync(basePath, content, { flag: 'wx', encoding: 'utf-8' });
    return;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  // File exists: this is an update — overwrite in place
  writeFileSync(basePath, content, { encoding: 'utf-8' });
}

// ── Escape log ────────────────────────────────────────────────────────────────

const ESCAPE_FILE = '.escape.jsonl';
const RAW_MAX_BYTES = 1500;

function truncateRaw(raw: string): string {
  const buf = Buffer.from(raw, 'utf-8');
  if (buf.length <= RAW_MAX_BYTES) return raw;
  const suffix = '...';
  const keep = RAW_MAX_BYTES - Buffer.byteLength(suffix);
  return buf.slice(0, keep).toString('utf-8') + suffix;
}

function appendEscapeEntry(
  location: string,
  entity: Entity,
  result: Extract<ValidationResult, { valid: false }>,
): void {
  try {
    const escapePath = join(location, ESCAPE_FILE);
    mkdirSync(dirname(escapePath), { recursive: true });

    const entry = {
      ts: new Date().toISOString(),
      id: entity.frontmatter.id,
      reason: result.reason,
      message: result.message,
      raw: truncateRaw(JSON.stringify(entity.frontmatter)),
    };
    appendFileSync(escapePath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Escape log is best-effort — silent fail
  }
}

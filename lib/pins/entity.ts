import type { Entity, Frontmatter } from './types';
import { parseYamlStrict } from './yaml';

/**
 * Serializes an Entity to a .md file body:
 * YAML frontmatter block (---...---) followed by the 4-section markdown body.
 *
 * Field ordering is deterministic: canonical fields (id, type, source, status,
 * updated_at, checked_at, created_at) plus typed relations[] array extend the
 * legacy flat-pin frontmatter shape.
 *
 * Frontmatter field order is deterministic and must not change — it is part
 * of the 3-way coupling: schema ↔ serializer ↔ record skill.
 */
export function serialize(entity: Entity): string {
  const fm = entity.frontmatter;

  // Build a plain object with explicit field ordering.
  // Optional discovery_context is omitted when undefined.
  const ordered: Record<string, unknown> = {
    id: fm.id,
    type: fm.type,
    source: fm.source,
    authority: fm.authority,
    source_url: fm.source_url,
    tier: fm.tier,
    tags: fm.tags,
    sensitivity: fm.sensitivity,
    status: fm.status,
    updated_at: fm.updated_at,
    checked_at: fm.checked_at,
    created_at: fm.created_at,
  };

  if (fm.discovery_context !== undefined) {
    ordered.discovery_context = fm.discovery_context;
  }

  // relations[] serialized as an array of {target, type} objects.
  ordered.relations = fm.relations;

  const yamlBlock = Bun.YAML.stringify(ordered, null, 2);
  // Bun.YAML.stringify emits no trailing newline; guarantee exactly one so the
  // closing fence sits on its own line and the parse regex (`\n---\n\n`) matches.
  const block = yamlBlock.endsWith('\n') ? yamlBlock : yamlBlock + '\n';
  return `---\n${block}---\n\n${entity.body}\n`;
}

/**
 * Parses a .md string produced by serialize() back into an Entity.
 * Round-trip is lossless: parse(serialize(e)) deep-equals e.
 */
export function parse(md: string): Entity {
  // Split on the closing `---` fence.
  // Format is: `---\n<yaml>\n---\n\n<body>\n`
  const match = md.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*?)\n?$/);
  if (!match) {
    throw new Error('Invalid entity .md format: missing YAML frontmatter fences');
  }

  const [, yamlContent, body] = match;
  // Opaque parse boundary: parseYamlStrict returns unknown YAML content, and
  // the shape (correct fields/types) is validated downstream by validator.ts
  // against tbox.yaml, not here. One assertion at this single boundary stands
  // in for per-field trust instead of asserting each field individually.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque YAML→Frontmatter boundary; shape is validated downstream by validator.ts, not here by design
  const raw = parseYamlStrict(yamlContent) as Frontmatter;

  const frontmatter: Frontmatter = {
    id: raw.id,
    type: raw.type,
    source: raw.source,
    authority: raw.authority,
    source_url: raw.source_url,
    tier: raw.tier,
    tags: raw.tags,
    sensitivity: raw.sensitivity,
    status: raw.status,
    updated_at: raw.updated_at,
    checked_at: raw.checked_at,
    created_at: raw.created_at,
    relations: raw.relations ?? [],
  };

  if (raw.discovery_context !== undefined) {
    frontmatter.discovery_context = raw.discovery_context;
  }

  return { frontmatter, body };
}

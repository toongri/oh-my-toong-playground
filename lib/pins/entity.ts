import type { Entity, Frontmatter } from './types';

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
  const raw = Bun.YAML.parse(yamlContent) as Record<string, unknown>;

  const frontmatter: Frontmatter = {
    id: raw.id as string,
    type: raw.type as Frontmatter['type'],
    source: raw.source as Frontmatter['source'],
    authority: raw.authority as string,
    source_url: raw.source_url as string,
    tier: raw.tier as Frontmatter['tier'],
    tags: raw.tags as string,
    sensitivity: raw.sensitivity as Frontmatter['sensitivity'],
    status: raw.status as Frontmatter['status'],
    updated_at: raw.updated_at as string,
    checked_at: raw.checked_at as string,
    created_at: raw.created_at as string,
    relations: (raw.relations as Array<{ target: string; type: string }>) ?? [],
  };

  if (raw.discovery_context !== undefined) {
    frontmatter.discovery_context = raw.discovery_context as string;
  }

  return { frontmatter, body };
}

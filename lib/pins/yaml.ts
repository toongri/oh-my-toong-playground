/**
 * Strict YAML parser that restores the fail-fast contract lost when the
 * codebase migrated from yaml@2.8.2 (which threw on multi-doc and duplicate
 * keys) to Bun.YAML (which silently keeps last-wins on both cases).
 *
 * lazy: flow-style inline duplicates {a: 1, a: 2} — Bun.YAML already
 *   merges them before we see the result; would require a full YAML lexer
 *   to detect. Add when a flow-style duplicate incident is observed.
 */

/**
 * Parses a single-document YAML string strictly.
 *
 * Throws if:
 *   - The input is multi-document (Bun.YAML returns an array).
 *   - Any mapping (at any nesting level) contains a duplicate key (block-style).
 *   - The YAML is genuinely malformed (Bun.YAML throws; we let it propagate).
 */
export function parseYamlStrict(text: string): unknown {
  checkDuplicateKeys(text);
  const result = Bun.YAML.parse(text);
  if (Array.isArray(result)) {
    throw new Error(
      'parseYamlStrict: multi-document YAML is not allowed (single document expected)',
    );
  }
  return result;
}

/**
 * Scans block-style YAML text line by line for duplicate keys within the
 * same mapping block at any nesting level.
 *
 * Strategy: maintain a stack of Sets keyed by indentation depth.
 * Each Set tracks the keys seen at that indent level. When indentation
 * decreases, deeper levels are popped (their key-sets are discarded).
 * When a key is added and already exists at the current level, throw.
 *
 * A "key line" matches /^(\s*)([\w.-]+)\s*:/.
 *   - Leading spaces determine indentation depth.
 *   - The captured name is the key.
 *   - Lines that are comments (#), block scalars (|, >), or list items (-)
 *     that are not also key-value pairs are ignored.
 *
 * lazy: merge keys (<<: *anchor) — treated as regular keys named "<<".
 *   Rare in this codebase (pins YAML has no anchors); upgrade if needed.
 */
function checkDuplicateKeys(text: string): void {
  // Stack: index = indent depth, value = Set of keys seen at that depth.
  const stack: Map<number, Set<string>> = new Map();

  for (const rawLine of text.split('\n')) {
    // Skip blank lines, comments, document markers
    const trimmed = rawLine.trimEnd();
    if (trimmed === '' || trimmed.trimStart().startsWith('#') || trimmed === '---' || trimmed === '...') {
      continue;
    }

    // Match a block mapping key: optional leading spaces, then a YAML key
    // (word chars, hyphens, dots, slashes, @), followed by a colon.
    // Must not be a list item (`- `) that isn't a key.
    const match = trimmed.match(/^(\s*)([^:\s#][^:]*?)\s*:/);
    if (!match) continue;

    const indent = match[1].length;
    const keyRaw = match[2].trim();

    // Detect whether this line is a list item ("  - key: value" form).
    // keyRaw is the raw text between leading whitespace and the colon,
    // so `- key` means this is a list item introducing a new mapping.
    const isListItem = keyRaw.startsWith('- ') || keyRaw === '-';

    // Strip the leading "- " to get the actual mapping key name.
    const keyCandidate = keyRaw.replace(/^-\s+/, '');

    // If after stripping "- " the candidate is empty or just a bare dash,
    // it is a list bullet with no inline key — skip it.
    if (keyCandidate === '' || keyCandidate === '-') continue;

    // For "- key: value" lines, YAML nests the key under a new list-item
    // mapping, so the effective indent for key-uniqueness is indent + 2.
    // Plain mapping keys use the raw indent directly.
    const effectiveIndent = isListItem ? indent + 2 : indent;

    // Pop deeper levels from the stack when we step out.
    for (const depth of [...stack.keys()]) {
      if (depth > effectiveIndent) {
        stack.delete(depth);
      }
    }

    // A new list item (isListItem) always starts a fresh mapping context at
    // effectiveIndent — reset the key-set so sibling list items don't
    // falsely trigger a duplicate-key error for shared field names like
    // `target` appearing in every element of a sequence.
    if (isListItem) {
      stack.delete(effectiveIndent);
    }

    let keysAtLevel = stack.get(effectiveIndent);
    if (!keysAtLevel) {
      keysAtLevel = new Set<string>();
      stack.set(effectiveIndent, keysAtLevel);
    }

    if (keysAtLevel.has(keyCandidate)) {
      throw new Error(
        `parseYamlStrict: duplicate mapping key "${keyCandidate}" at indent ${effectiveIndent}`,
      );
    }
    keysAtLevel.add(keyCandidate);
  }
}

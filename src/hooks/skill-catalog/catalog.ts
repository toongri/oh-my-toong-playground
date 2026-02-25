import { HashmapSkillEntry, CatalogEntry } from './types.ts';

// Internal hashmap of known skills with rich metadata
export const SKILL_HASHMAP: Map<string, HashmapSkillEntry> = new Map([
  [
    'superpowers:test-driven-development',
    {
      description: 'Test-Driven Development methodology — write failing tests first, then implement to pass',
      criteria: 'Implementation task that produces testable code',
      alwaysAvailable: true,
      examples: [
        'Add rate limiting middleware → TDD: write limit-exceeded test first',
        'Create user service CRUD → TDD: write each operation\'s test before implementation',
        'Fix authentication bug → TDD: write regression test reproducing the bug first',
      ],
    },
  ],
]);

// Build catalog entries from hashmap + discovered skill names
export function buildCatalog(discoveredSkillNames: string[]): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();

  // 1. Add all hashmap skills that are alwaysAvailable (regardless of scan)
  for (const [name, entry] of SKILL_HASHMAP) {
    if (entry.alwaysAvailable) {
      entries.push({
        name,
        description: entry.description,
        criteria: entry.criteria,
        examples: entry.examples,
        discoveredOnly: false,
      });
      seen.add(name);
    }
  }

  // 2. Process discovered skills
  for (const skillName of discoveredSkillNames) {
    if (seen.has(skillName)) {
      continue; // Already added from hashmap
    }

    const hashmapEntry = SKILL_HASHMAP.get(skillName);
    if (hashmapEntry) {
      // Discovered + in hashmap → full entry
      entries.push({
        name: skillName,
        description: hashmapEntry.description,
        criteria: hashmapEntry.criteria,
        examples: hashmapEntry.examples,
        discoveredOnly: false,
      });
    } else {
      // Discovered-only → name-only entry
      entries.push({
        name: skillName,
        discoveredOnly: true,
      });
    }
    seen.add(skillName);
  }

  return entries;
}

// Format catalog entries into the additionalContext string
export function formatCatalog(entries: CatalogEntry[]): string {
  const lines: string[] = [
    '<skill-catalog>',
    '## Available Skills for Delegation',
    '',
  ];

  for (const entry of entries) {
    if (entry.discoveredOnly) {
      lines.push(`- ${entry.name}: Available (invoke Skill(skill: "${entry.name}") to load — no selection criteria defined, evaluate by name)`);
    } else {
      lines.push(`- ${entry.name}: ${entry.description}`);
      lines.push(`  - Criteria: ${entry.criteria}`);
      if (entry.examples && entry.examples.length > 0) {
        lines.push('  - Examples:');
        for (const example of entry.examples) {
          lines.push(`    - ${example}`);
        }
      }
    }
  }

  lines.push('');
  lines.push('When delegating to sisyphus-junior, evaluate the above skills against the task.');
  lines.push('Include relevant skills in ## 7. MANDATORY SKILLS section.');
  lines.push('</skill-catalog>');

  return lines.join('\n');
}

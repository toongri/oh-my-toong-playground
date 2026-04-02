import { HashmapSkillEntry, CatalogEntry, Situation } from './types.ts';

// Situations — atomic task-level activities delegated to sisyphus-junior.
// NOT orchestration-level concepts like "new feature" (that's sisyphus's job to decompose).
export const SITUATIONS: Situation[] = [
  {
    id: 'bugfix',
    label: 'Bug fix',
    reasoning: 'Defect reproduction → fix → pass cycle required. Involves both test writing and implementation.',
  },
  {
    id: 'implementation',
    label: 'Implementation',
    reasoning: 'Define expected behavior → implement → verify cycle. Atomic task-level coding that requires both tests and implementation.',
  },
  {
    id: 'refactoring',
    label: 'Refactoring',
    reasoning: 'Structure change without spec change. Existing tests verify behavior preservation, so testing skill is unnecessary.',
  },
  {
    id: 'design',
    label: 'Design',
    reasoning: 'User interface and experience design. Establish design patterns and UX principles before implementation.',
  },
  {
    id: 'analytics',
    label: 'Data analytics',
    reasoning: 'Data-driven decision making. Product analysis and metric definition required.',
  },
];

// Internal hashmap of known skills with rich metadata
export const SKILL_HASHMAP: Map<string, HashmapSkillEntry> = new Map([
  [
    'superpowers:test-driven-development',
    {
      description: 'Test-Driven Development methodology — write failing tests first, then implement to pass',
      pluginId: 'superpowers@claude-plugins-official',
      situationIds: ['bugfix', 'implementation', 'refactoring'],
    },
  ],
  [
    'testing',
    {
      description: 'Testing skill — write and maintain automated tests',
      situationIds: ['bugfix', 'implementation'],
    },
  ],
  [
    'implement',
    {
      description: 'Implementation skill — focused code implementation following a spec',
      situationIds: ['bugfix', 'implementation', 'refactoring'],
    },
  ],
  [
    'frontend-design',
    {
      description: 'Frontend design skill — UI component design and visual implementation',
      situationIds: ['design'],
    },
  ],
  [
    'ux-design',
    {
      description: 'UX design skill — user experience flows, interaction patterns, and usability',
      situationIds: ['design'],
    },
  ],
  [
    'pm-data-analytics',
    {
      description: 'Product analytics skill — data-driven product decisions and metric definition',
      situationIds: ['analytics'],
    },
  ],
]);

// Build catalog entries from hashmap + discovered skill names
export function buildCatalog(discoveredSkillNames: string[], enabledPluginIds: Set<string>): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();

  // 1. Add hashmap skills whose plugin is enabled (regardless of scan)
  // Design intent: Skills without a pluginId (e.g. testing, implement, frontend-design) are
  // intentionally excluded here. They must be physically installed in the project
  // (.claude/skills/ or ~/.claude/skills/) to appear in the catalog — discovered via scan
  // in Phase 2, where SKILL_HASHMAP metadata (description, situationIds) is applied as
  // enrichment. Only skills with a pluginId are auto-registered based on plugin activation.
  for (const [name, entry] of SKILL_HASHMAP) {
    if (entry.pluginId && enabledPluginIds.has(entry.pluginId)) {
      entries.push({
        name,
        description: entry.description,
        discoveredOnly: false,
        situationIds: entry.situationIds,
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
      // Discovered + in hashmap: skip if plugin-gated and plugin not enabled
      if (hashmapEntry.pluginId && !enabledPluginIds.has(hashmapEntry.pluginId)) {
        continue;
      }
      // Discovered + in hashmap → full entry
      entries.push({
        name: skillName,
        description: hashmapEntry.description,
        discoveredOnly: false,
        situationIds: hashmapEntry.situationIds,
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
  const discoveredOnlyEntries = entries.filter((e) => e.discoveredOnly);

  // Collect situation rows: for each situation, find entries with that situationId
  type SituationRow = { situation: Situation; skillNames: string[] };
  const situationRows: SituationRow[] = [];

  for (const situation of SITUATIONS) {
    const matchingSkills: string[] = [];
    for (const entry of entries) {
      if (!entry.discoveredOnly && entry.situationIds?.includes(situation.id)) {
        matchingSkills.push(entry.name);
      }
    }
    if (matchingSkills.length > 0) {
      situationRows.push({ situation, skillNames: matchingSkills });
    }
  }

  // If nothing to show, return minimal output
  if (situationRows.length === 0 && discoveredOnlyEntries.length === 0) {
    return '<skill-catalog>\nNo skills available for delegation.\n</skill-catalog>';
  }

  const lines: string[] = [
    '<skill-catalog>',
    '## Load Skills',
    '',
    'Based on the task situation, load the relevant skills listed below before delegating to sisyphus-junior.',
    '',
  ];

  // Situation-based table
  if (situationRows.length > 0) {
    lines.push('| Situation | Skills |');
    lines.push('|-----------|--------|');
    for (const row of situationRows) {
      lines.push(`| ${row.situation.label} | ${row.skillNames.join(', ')} |`);
    }
    lines.push('');

    // How to evaluate section
    lines.push('### How to evaluate');
    lines.push('');
    for (const row of situationRows) {
      lines.push(`**${row.situation.label}:** ${row.situation.reasoning}`);
      lines.push(`Load: ${row.skillNames.join(', ')}`);
      lines.push('');
    }
  }

  // Discovered-only entries
  if (discoveredOnlyEntries.length > 0) {
    lines.push('### Additional discovered skills');
    lines.push('');
    for (const entry of discoveredOnlyEntries) {
      lines.push(`- ${entry.name}: Available (invoke Skill(skill: "${entry.name}") to load — no selection criteria defined, evaluate by name)`);
    }
    lines.push('');
  }

  lines.push('</skill-catalog>');

  return lines.join('\n');
}

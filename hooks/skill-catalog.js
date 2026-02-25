// src/catalog.ts
var SKILL_HASHMAP = /* @__PURE__ */ new Map([
  [
    "superpowers:test-driven-development",
    {
      description: "Test-Driven Development methodology \u2014 write failing tests first, then implement to pass",
      criteria: "Implementation task that produces testable code",
      alwaysAvailable: true,
      examples: [
        "Add rate limiting middleware \u2192 TDD: write limit-exceeded test first",
        "Create user service CRUD \u2192 TDD: write each operation's test before implementation",
        "Fix authentication bug \u2192 TDD: write regression test reproducing the bug first"
      ]
    }
  ]
]);
function buildCatalog(discoveredSkillNames) {
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [name, entry] of SKILL_HASHMAP) {
    if (entry.alwaysAvailable) {
      entries.push({
        name,
        description: entry.description,
        criteria: entry.criteria,
        examples: entry.examples,
        discoveredOnly: false
      });
      seen.add(name);
    }
  }
  for (const skillName of discoveredSkillNames) {
    if (seen.has(skillName)) {
      continue;
    }
    const hashmapEntry = SKILL_HASHMAP.get(skillName);
    if (hashmapEntry) {
      entries.push({
        name: skillName,
        description: hashmapEntry.description,
        criteria: hashmapEntry.criteria,
        examples: hashmapEntry.examples,
        discoveredOnly: false
      });
    } else {
      entries.push({
        name: skillName,
        discoveredOnly: true
      });
    }
    seen.add(skillName);
  }
  return entries;
}
function formatCatalog(entries) {
  const lines = [
    "<skill-catalog>",
    "## Available Skills for Delegation",
    ""
  ];
  for (const entry of entries) {
    if (entry.discoveredOnly) {
      lines.push(`- ${entry.name}: Available (invoke Skill(skill: "${entry.name}") to load \u2014 no selection criteria defined, evaluate by name)`);
    } else {
      lines.push(`- ${entry.name}: ${entry.description}`);
      lines.push(`  - Criteria: ${entry.criteria}`);
      if (entry.examples && entry.examples.length > 0) {
        lines.push("  - Examples:");
        for (const example of entry.examples) {
          lines.push(`    - ${example}`);
        }
      }
    }
  }
  lines.push("");
  lines.push("When delegating to sisyphus-junior, evaluate the above skills against the task.");
  lines.push("Include relevant skills in ## 7. MANDATORY SKILLS section.");
  lines.push("</skill-catalog>");
  return lines.join("\n");
}

// src/scanner.ts
import { readdir } from "fs/promises";
import { join } from "path";
async function scanDirectory(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
async function scanSkillDirectories(cwd) {
  const homeDir = process.env.HOME || "/tmp";
  const projectSkillsDir = join(cwd, ".claude", "skills");
  const userSkillsDir = join(homeDir, ".claude", "skills");
  const [projectSkills, userSkills] = await Promise.all([
    scanDirectory(projectSkillsDir),
    scanDirectory(userSkillsDir)
  ]);
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const name of [...projectSkills, ...userSkills]) {
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

// src/index.ts
async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", (err) => reject(err));
  });
}
function parseInput(raw) {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
  }
  const sessionId = input.sessionId || input.session_id || "default";
  const cwd = input.cwd || process.cwd();
  return { sessionId, cwd };
}
async function main() {
  try {
    const rawInput = await readStdin();
    const input = parseInput(rawInput);
    const discoveredSkills = await scanSkillDirectories(input.cwd);
    const entries = buildCatalog(discoveredSkills);
    const additionalContext = formatCatalog(entries);
    const output = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext
      }
    };
    console.log(JSON.stringify(output));
  } catch {
    console.log('{"continue": true}');
  }
}
main();
export {
  main,
  parseInput,
  readStdin
};

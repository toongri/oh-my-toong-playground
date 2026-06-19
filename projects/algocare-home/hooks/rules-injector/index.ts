/**
 * Rules Injector Hook
 *
 * Automatically injects relevant rule files when a tool accesses files.
 * Supports project-level (.claude/rules, .github/instructions) and
 * user-level rules under [$CLAUDE_CONFIG_DIR|~/.claude].
 *
 * Ported from oh-my-opencode's rules-injector hook.
 *
 * This is the CORE module: the createRulesInjectorHook factory and the
 * cache-backed, on-disk-deduplicating gate-free entry processFilePathForRules.
 * The codex hook entry (import.meta.main / stdin parsing / path extractor) is
 * a separate concern and lives elsewhere.
 */

import { readFileSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import { findProjectRoot, findRuleFiles } from './finder.js';
import {
  createContentHash,
  isDuplicateByContentHash,
  isDuplicateByRealPath,
  shouldApplyRule,
} from './matcher.js';
import { parseRuleFrontmatter } from './parser.js';
import {
  clearInjectedRules,
  loadInjectedRules,
  saveInjectedRules,
} from './storage.js';
import { TRACKED_TOOLS } from './constants.js';
import type { RuleToInject } from './types.js';

// Re-export all submodules
export * from './types.js';
export * from './constants.js';
export * from './finder.js';
export * from './parser.js';
export * from './matcher.js';
export * from './storage.js';

/**
 * Session cache for injected rules.
 */
interface SessionCache {
  contentHashes: Set<string>;
  realPaths: Set<string>;
}

/**
 * Create a rules injector hook.
 *
 * @param workingDirectory - The working directory for resolving paths
 * @returns Hook handlers, including the gate-free dedup entry
 *          processFilePathForRules
 */
export function createRulesInjectorHook(workingDirectory: string) {
  const sessionCaches = new Map<string, SessionCache>();

  function getSessionCache(sessionId: string): SessionCache {
    if (!sessionCaches.has(sessionId)) {
      sessionCaches.set(sessionId, loadInjectedRules(sessionId));
    }
    return sessionCaches.get(sessionId)!;
  }

  function resolveFilePath(filePath: string): string | null {
    if (!filePath) return null;
    if (isAbsolute(filePath)) return filePath;
    return resolve(workingDirectory, filePath);
  }

  /**
   * Process a file path and return rules to inject.
   *
   * Gate-free: takes (filePath, sessionId) directly with no tool-name gate,
   * applies the session cache + on-disk dedup, and persists state only when
   * something new is injected.
   */
  function processFilePathForRules(
    filePath: string,
    sessionId: string
  ): RuleToInject[] {
    const resolved = resolveFilePath(filePath);
    if (!resolved) return [];

    const projectRoot = findProjectRoot(resolved);
    const cache = getSessionCache(sessionId);

    const ruleFileCandidates = findRuleFiles(projectRoot, resolved);
    const toInject: RuleToInject[] = [];

    for (const candidate of ruleFileCandidates) {
      if (isDuplicateByRealPath(candidate.realPath, cache.realPaths)) continue;

      try {
        const rawContent = readFileSync(candidate.path, 'utf-8');
        const { metadata, body } = parseRuleFrontmatter(rawContent);

        let matchReason: string;
        if (candidate.isSingleFile) {
          matchReason = 'copilot-instructions (always apply)';
        } else {
          const matchResult = shouldApplyRule(metadata, resolved, projectRoot);
          if (!matchResult.applies) continue;
          matchReason = matchResult.reason ?? 'matched';
        }

        const contentHash = createContentHash(body);
        if (isDuplicateByContentHash(contentHash, cache.contentHashes)) continue;

        const relativePath = projectRoot
          ? relative(projectRoot, candidate.path)
          : candidate.path;

        toInject.push({
          relativePath,
          matchReason,
          content: body,
          distance: candidate.distance,
        });

        cache.realPaths.add(candidate.realPath);
        cache.contentHashes.add(contentHash);
      } catch {
        // Skip files that can't be read
      }
    }

    if (toInject.length > 0) {
      // Sort by distance (closest first)
      toInject.sort((a, b) => a.distance - b.distance);
      saveInjectedRules(sessionId, cache);
    }

    return toInject;
  }

  /**
   * Format rules for injection into output.
   */
  function formatRulesForInjection(rules: RuleToInject[]): string {
    if (rules.length === 0) return '';

    let output = '';
    for (const rule of rules) {
      output += `\n\n[Rule: ${rule.relativePath}]\n[Match: ${rule.matchReason}]\n${rule.content}`;
    }
    return output;
  }

  return {
    /**
     * Gate-free dedup entry: return rules to inject for (filePath, sessionId),
     * persisting per-session dedup to disk. This is the entry the codex hook
     * calls — it does NOT gate on Claude tool names.
     */
    processFilePathForRules,

    /**
     * Process a tool execution and inject rules if relevant.
     */
    processToolExecution: (
      toolName: string,
      filePath: string,
      sessionId: string
    ): string => {
      if (!TRACKED_TOOLS.includes(toolName.toLowerCase())) {
        return '';
      }

      const rules = processFilePathForRules(filePath, sessionId);
      return formatRulesForInjection(rules);
    },

    /**
     * Get rules for a specific file without marking as injected.
     */
    getRulesForFile: (filePath: string): RuleToInject[] => {
      const resolved = resolveFilePath(filePath);
      if (!resolved) return [];

      const projectRoot = findProjectRoot(resolved);

      const ruleFileCandidates = findRuleFiles(projectRoot, resolved);
      const rules: RuleToInject[] = [];

      for (const candidate of ruleFileCandidates) {
        try {
          const rawContent = readFileSync(candidate.path, 'utf-8');
          const { metadata, body } = parseRuleFrontmatter(rawContent);

          let matchReason: string;
          if (candidate.isSingleFile) {
            matchReason = 'copilot-instructions (always apply)';
          } else {
            const matchResult = shouldApplyRule(metadata, resolved, projectRoot);
            if (!matchResult.applies) continue;
            matchReason = matchResult.reason ?? 'matched';
          }

          const relativePath = projectRoot
            ? relative(projectRoot, candidate.path)
            : candidate.path;

          rules.push({
            relativePath,
            matchReason,
            content: body,
            distance: candidate.distance,
          });
        } catch {
          // Skip files that can't be read
        }
      }

      return rules.sort((a, b) => a.distance - b.distance);
    },

    /**
     * Clear session cache when session ends.
     */
    clearSession: (sessionId: string): void => {
      sessionCaches.delete(sessionId);
      clearInjectedRules(sessionId);
    },

    /**
     * Check if a tool triggers rule injection.
     */
    isTrackedTool: (toolName: string): boolean => {
      return TRACKED_TOOLS.includes(toolName.toLowerCase());
    },
  };
}

/**
 * Get rules for a file path (simple utility function).
 */
export function getRulesForPath(filePath: string, workingDirectory?: string): RuleToInject[] {
  const cwd = workingDirectory || process.cwd();
  const hook = createRulesInjectorHook(cwd);
  return hook.getRulesForFile(filePath);
}

// ---------------------------------------------------------------------------
// Codex PostToolUse hook entry
// ---------------------------------------------------------------------------

import { extractCommandPaths } from './extract.js';

/**
 * Render matched rules into the additionalContext string. Mirrors the core's
 * private formatRulesForInjection block layout so codex and Claude inject the
 * same shape.
 */
function formatRules(rules: RuleToInject[]): string {
  let output = '';
  for (const rule of rules) {
    output += `\n\n[Rule: ${rule.relativePath}]\n[Match: ${rule.matchReason}]\n${rule.content}`;
  }
  return output.trim();
}

/**
 * Core of the codex PostToolUse hook: run the D-5 extraction pipeline over
 * `tool_input.command`, build the dedup entry ONCE, and collect matched rules.
 * Returns the additionalContext string ('' when nothing matched).
 *
 * `hookSpecificOutput` always carries `hookEventName`; `additionalContext` is
 * present only when at least one rule matched. Any failure surfaces as ''
 * (a valid no-op) — the caller never throws or blocks.
 */
function runCodexPostToolUse(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const input = payload as Record<string, unknown>;

  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const sessionId =
    typeof input.session_id === 'string' ? input.session_id : '';
  if (!sessionId) return '';

  const toolInput =
    typeof input.tool_input === 'object' && input.tool_input !== null
      ? (input.tool_input as Record<string, unknown>)
      : {};
  const command = toolInput.command;
  if (typeof command !== 'string' && !Array.isArray(command)) return '';

  const paths = extractCommandPaths(command as string | string[]);
  if (paths.length === 0) return '';

  // Build the dedup entry ONCE for this invocation, then call it per path.
  const hook = createRulesInjectorHook(cwd);
  const matched: RuleToInject[] = [];
  for (const filePath of paths) {
    matched.push(...hook.processFilePathForRules(filePath, sessionId));
  }
  if (matched.length === 0) return '';

  return formatRules(matched);
}

function readStdin(): Promise<string> {
  return new Promise((resolveStdin) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.once('end', () => resolveStdin(data));
    process.stdin.once('error', () => resolveStdin(data));
  });
}

if (import.meta.main) {
  // The codex PostToolUse hook contract: emit hookSpecificOutput on stdout and
  // exit 0 unconditionally. additionalContext is present only when rules
  // matched; on no-match OR any error we emit a valid no-op and NEVER block.
  const emit = (additionalContext: string): void => {
    const hookSpecificOutput: {
      hookEventName: string;
      additionalContext?: string;
    } = { hookEventName: 'PostToolUse' };
    if (additionalContext.length > 0) {
      hookSpecificOutput.additionalContext = additionalContext;
    }
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput })}\n`);
  };

  readStdin()
    .then((raw) => {
      let additionalContext = '';
      try {
        additionalContext = runCodexPostToolUse(JSON.parse(raw));
      } catch {
        additionalContext = '';
      }
      emit(additionalContext);
      process.exit(0);
    })
    .catch(() => {
      emit('');
      process.exit(0);
    });
}

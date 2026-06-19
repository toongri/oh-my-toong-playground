/**
 * D-5 command path-extraction pipeline.
 *
 * Extracts path-shaped tokens from a codex PostToolUse `tool_input.command`,
 * which may arrive as a raw string, an argv array, or a shell-wrapper-wrapped
 * command (sh -c / bash -c / zsh -lc ...). The rule glob is the real filter;
 * this stage only proposes candidate paths and never gates on file existence.
 *
 * Explicitly DEFERRED (not implemented here): grep-pattern-position skip,
 * redirect-bare-name extraction, hard per-command injection cap.
 */

/** File extensions that mark a bare token (no slash) as path-shaped. */
const KNOWN_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.md',
  '.mdc',
  '.mdx',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.txt',
  '.sh',
  '.bash',
  '.zsh',
  '.css',
  '.scss',
  '.html',
  '.xml',
  '.sql',
  '.vue',
  '.svelte',
];

/** Operators that split a command line into separate sub-commands. */
const OPERATOR_TOKENS = new Set(['&&', '||', '|', ';']);

/** Shell metacharacters that mark a token as unexpanded / not a literal path. */
const METACHAR_RE = /[$~*?`(]/;

/**
 * Extract the deduped set of path-shaped tokens from a codex command,
 * robust to all three D-5 command shapes.
 */
export function extractCommandPaths(command: string | string[]): string[] {
  // Step 1: normalize argv array -> joined string.
  const raw = Array.isArray(command) ? command.join(' ') : command;
  if (typeof raw !== 'string' || raw.length === 0) return [];

  // Step 2: conditional shell-wrapper unwrap.
  const unwrapped = unwrapShellWrapper(raw);

  // Step 3: quote-aware tokenize (operators surface as their own tokens).
  const tokens = tokenize(unwrapped);

  // Step 4: keep path-shaped tokens, honoring flags + operator splits.
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Operator-split: operators never contribute a path and just reset state.
    if (OPERATOR_TOKENS.has(token)) continue;

    // Flag token: drop the flag but KEEP its following value (-o out.ts).
    if (token.startsWith('-')) continue;

    if (!isPathShaped(token)) continue;
    if (METACHAR_RE.test(token)) continue;

    paths.push(token);
  }

  // Step 6: dedupe (preserve first-seen order). No existence gate (step 5).
  return [...new Set(paths)];
}

/**
 * If the command begins with a shell wrapper invocation
 * (e.g. `/bin/zsh -lc "<inner>"`, `bash -c '<inner>'`), return the INNER
 * quoted command. Otherwise return the command unchanged.
 */
function unwrapShellWrapper(command: string): string {
  const tokens = tokenize(command.trim());
  if (tokens.length < 3) return command;

  const shellName = basename(tokens[0]);
  const shellRe = /^(sh|bash|zsh|dash|ksh|ash|fish)$/;
  if (!shellRe.test(shellName)) return command;

  // The flag carrying the inline command always ends in 'c' (-c, -lc, -ic).
  const flag = tokens[1];
  if (!flag.startsWith('-') || !flag.endsWith('c')) return command;

  // tokenize() already stripped the surrounding quotes from the inner command,
  // so the third token is the inner command verbatim.
  return tokens[2];
}

/**
 * Quote-aware tokenizer. Splits on unquoted whitespace, treats
 * `'…'` / `"…"` as single tokens (quotes stripped, spaces preserved), and
 * surfaces operator runs (&& || | ; newline) as standalone tokens.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let hasCurrent = false;
  let quote: "'" | '"' | null = null;

  const flush = (): void => {
    if (hasCurrent) {
      tokens.push(current);
      current = '';
      hasCurrent = false;
    }
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
        hasCurrent = true;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      hasCurrent = true; // an empty "" still produces a (empty) token
      continue;
    }

    // Operators: &&, ||, |, ;, and newline.
    if (ch === '&' && input[i + 1] === '&') {
      flush();
      tokens.push('&&');
      i++;
      continue;
    }
    if (ch === '|' && input[i + 1] === '|') {
      flush();
      tokens.push('||');
      i++;
      continue;
    }
    if (ch === '|') {
      flush();
      tokens.push('|');
      continue;
    }
    if (ch === ';') {
      flush();
      tokens.push(';');
      continue;
    }
    if (ch === '\n') {
      flush();
      tokens.push(';');
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flush();
      continue;
    }

    current += ch;
    hasCurrent = true;
  }

  flush();
  return tokens;
}

/** A token is path-shaped if it contains a slash OR ends in a known extension. */
function isPathShaped(token: string): boolean {
  if (token.includes('/')) return true;
  const lower = token.toLowerCase();
  return KNOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** POSIX-style basename for shell-wrapper detection. */
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

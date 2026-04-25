# slugify — URL/Filename Safe Slug Conversion

## Overview

`slugify` is a utility used in the job description collection workflow to convert **company** and **role_title** values into filesystem- and URL-safe slug strings.

Directory structure example:

```
jd/
└── toss-bank/
    └── 백엔드-엔지니어.md
```

Slugs prevent filename collisions, remain human-readable, and eliminate shell/URL escaping issues caused by special characters.

---

## Step-by-Step Algorithm (7 Steps)

| # | Operation | Input Example | Output Example |
|---|------|---------|---------|
| 1 | **NFKD** → strip combining diacritics (`[̀-ͯ]`) → **NFC**. Hangul is restored to syllables by NFC recomposition. Latin precomposed characters are decomposed by NFKD then the diacritic marks are stripped, leaving only the base character. | `"Café"` | `"Cafe"` |
| 2 | Lowercase Latin characters | `"AX Backend"` | `"ax backend"` |
| 3 | Space → hyphen | `"ax backend"` | `"ax-backend"` |
| 4 | Remove characters outside allowed set `[^a-z0-9가-힣-]` | `"ax-(backend)"` | `"ax-backend"` |
| 5 | Collapse consecutive hyphens (`-+` → `-`) | `"ax--backend"` | `"ax-backend"` |
| 6 | Trim leading/trailing hyphens | `"-ax-backend-"` | `"ax-backend"` |
| 7 | Truncate if length exceeds 64 (re-trim trailing `-`) | `"a".repeat(80)` | `"a".repeat(64)` |

---

## Hangul Policy

### 1. Avoid Library Dependencies

Do not use Hangul romanization libraries (e.g., `hangul-romanize`).

- Must operate without adding external dependencies.
- Romanization causes information loss (`서버` → `seobeo` is worse for search).

### 2. Preserve Searchability

Preserving Hangul syllables as-is ensures:

- `grep` and `find` can search for Korean text in filenames.
- Directory names remain immediately recognizable when browsing.
- Spaces are replaced with hyphens but syllables are left untouched.

### 3. NFKD → Strip Diacritics → NFC Pipeline

A three-step pipeline is used to process Latin precomposed characters (e.g., `é`, `ü`, `ñ`) while preserving Hangul syllables:

| Step | Operation | Hangul Result | Latin Result |
|------|------|-------------|------------|
| NFKD | Syllable → jamo decomposition, precomposed → base+mark decomposition | Jamo separated | `é` → `e` + combining acute |
| Strip `[̀-ͯ]` | Remove combining diacritic marks | Jamo unchanged | Combining marks removed, base only |
| NFC | Recompose jamo → syllables | Original syllables restored | Base character unchanged |

```
"토스".normalize('NFKD')  → jamo decomposition
  → .replace(/[̀-ͯ]/g, '') → jamo unaffected (no combining marks)
  → .normalize('NFC')      → "토스" recomposed (preserved)

"Café".normalize('NFKD')  → "Café" (combining acute accent)
  → .replace(/[̀-ͯ]/g, '') → "Cafe"
  → .normalize('NFC')      → "Cafe"
```

---

## Fixture Table

| Input | Expected Output | Notes |
|------|-----------|------|
| `'토스'` | `'토스'` | Hangul syllables preserved |
| `'AX Backend Engineer'` | `'ax-backend-engineer'` | Latin lowercase + space → hyphen |
| `'백엔드 / 서버'` | `'백엔드-서버'` | Hangul + special character removal |
| `'Toss Bank (Korea)'` | `'toss-bank-korea'` | Parentheses removed |
| `'   spaces   '` | `'spaces'` | Leading/trailing space trim |
| `'a'.repeat(80)` | length ≤ 64 | 64-char truncation |
| `'카카오 Frontend Dev'` | `'카카오-frontend-dev'` | Mixed Hangul + Latin |
| `'hello---world'` | `'hello-world'` | Consecutive hyphen collapse |
| `'-trim-'` | `'trim'` | Leading/trailing hyphen trim |
| `'a'.repeat(63) + '-extra'` | no trailing `-`, length ≤ 64 | Re-trim trailing hyphen after truncation |
| `'Café'` | `'cafe'` | Latin precomposed diacritic removed (French) |
| `'Zürich Tech'` | `'zurich-tech'` | German umlaut removed |
| `'Björn & Co'` | `'bjorn-co'` | Scandinavian diacritic removed |

---

## Implementation Files

- **TypeScript implementation**: [`scripts/slugify.ts`](../scripts/slugify.ts)
- **Tests**: [`scripts/slugify.test.ts`](../scripts/slugify.test.ts)

---

## How to Run

```bash
# Run tests only
bun test skills/collect-jd/scripts/slugify.test.ts

# Run all tests
bun test
```

---

## Allowed Character Set

```
[a-z0-9가-힣-]
```

- `a-z`: Lowercase Latin (combining characters stripped after NFKD decomposition)
- `0-9`: ASCII digits
- `가-힣`: Unicode Hangul Syllables block (U+AC00–U+D7A3)
- `-`: Hyphen (word separator)

All other characters (uppercase, special symbols, emoji, combining diacritics, etc.) are removed.

#!/bin/bash
# =============================================================================
# Invented-Label Detection — Shared PCRE Pattern Library
#
# Single source of truth for detecting "invented" plan/tracking labels
# (Step N, AC codes, Phase/Round/Iteration N, priority codes, D-N refs)
# inside arbitrary text (commit messages, edit content, etc). Absorbs the
# 5 regexes from skills/git-master/SKILL.md:302-306 VERBATIM (lookaheads
# preserved), plus one new hyphenated D-N pattern.
#
# Two tiers:
#   - HARD (label_match_hard): clean-economics set — zero known legitimate
#     collisions. Hyphenated D-N + the two (?! \w)-guarded git-master
#     patterns (bare letter-code, bare P0-3 priority).
#   - FULL (label_match_full): HARD + the three UNGUARDED git-master
#     patterns (Step N / AC / Phase-Round-Iteration N), which can
#     false-positive on legitimate prose like "Phase 2 rollout" or
#     "AC M1 Mac" — acceptable at this tier, not at HARD.
#
# Engine: perl -ne (native PCRE — BSD grep has no -P), fed the text via
# stdin. Both helpers are set -e-safe: they always return an explicit 0
# (match) or 1 (no match) status via the `if … ; then return 0; fi;
# return 1` guard shape and never let perl's non-match exit code abort
# the caller under set -euo pipefail (see pre-tool-enforcer.sh:49 for the
# same guard idiom).
#
# Sourcing this file has no side effects (functions only) — safe under
# set -euo pipefail.
# =============================================================================

# HARD tier: hyphenated D-N label + the two (?! \w)-guarded git-master
# patterns (skills/git-master/SKILL.md:304,306).
_LABEL_PATTERN_HARD='\bD-\d+\b|\b[HMLBCDJ]\d+\b(?! \w)|\bP[0-3]\b(?! \w)'

# FULL tier: HARD + the three unguarded git-master patterns
# (skills/git-master/SKILL.md:302,303,305).
_LABEL_PATTERN_FULL="$_LABEL_PATTERN_HARD"'|\(?Step \d+(\.\d+)?\)?|AC [A-Z]\d+\b|Phase \d+|Round \d+|Iteration \d+'

# label_match_hard <text>
# Returns 0 iff <text> contains a clean-economics invented label (hard tier).
label_match_hard() {
    if printf '%s\n' "$1" | LABEL_RE="$_LABEL_PATTERN_HARD" perl -ne 'BEGIN { $m = 0 } if (/$ENV{LABEL_RE}/) { $m = 1; exit 0 } END { exit 1 unless $m }'; then
        return 0
    fi
    return 1
}

# label_match_full <text>
# Returns 0 iff <text> contains any invented label (full tier: hard + broader).
label_match_full() {
    if printf '%s\n' "$1" | LABEL_RE="$_LABEL_PATTERN_FULL" perl -ne 'BEGIN { $m = 0 } if (/$ENV{LABEL_RE}/) { $m = 1; exit 0 } END { exit 1 unless $m }'; then
        return 0
    fi
    return 1
}

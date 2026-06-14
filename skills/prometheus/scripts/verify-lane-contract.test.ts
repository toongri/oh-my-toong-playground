import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Verify-lane contract tokens (plan D-6): verbatim literals that MUST be
// present/absent in SKILL.md + interview.md after the verify-lane rewrite
// (TODO 1-4). Mirrors the adr-log-contract.test.ts both-halves pattern:
// every REPLACED token gets BOTH the new substring PRESENT and the old
// distinctive substring ABSENT, so a presence-only FALSE-GREEN (old text
// surviving beside the new) cannot pass. Purely-additive tokens get
// presence-only — that is correct for them. The change set is prose, so token
// presence/absence IS the verification surface (no runtime behavior to test).
// Each expect() is a discrete per-token assertion.
// ---------------------------------------------------------------------------

const skillPath = join(import.meta.dir, '..', 'SKILL.md');
const skillContent = readFileSync(skillPath, 'utf8');

const interviewPath = join(import.meta.dir, '..', 'interview.md');
const interviewContent = readFileSync(interviewPath, 'utf8');

// ---------------------------------------------------------------------------
// SKILL.md PRESENCE — new verify-lane vocabulary that MUST appear.
// Additive tokens (fan-out, falsifying verifier, the 4 keys, evidence-anchored
// question) are presence-only by design; verify lane / librarian default lane /
// purely mechanical refactor pair with their absence-halves below.
// ---------------------------------------------------------------------------

describe('SKILL.md presence — verify-lane tokens', () => {
  it('P1: multi-aspect fan-out (additive)', () => {
    expect(skillContent).toContain('multi-aspect fan-out');
  });

  it('P2: falsifying verifier (additive)', () => {
    expect(skillContent).toContain('falsifying verifier');
  });

  it('P3: verify lane: Evidence-block line (replaces success-output checklist)', () => {
    expect(skillContent).toContain('verify lane:');
  });

  it('P4: stale_state key (additive)', () => {
    expect(skillContent).toContain('stale_state');
  });

  it('P5: prompt_injection key (additive)', () => {
    expect(skillContent).toContain('prompt_injection');
  });

  it('P6: nonexistent_path key (additive)', () => {
    expect(skillContent).toContain('nonexistent_path');
  });

  it('P7: version_drift key (additive)', () => {
    expect(skillContent).toContain('version_drift');
  });

  it('P8: librarian default lane (replaces the conditional-dispatch text)', () => {
    expect(skillContent).toContain('librarian default lane');
  });

  it('P9: purely mechanical refactor (default-lane carve-out)', () => {
    expect(skillContent).toContain('purely mechanical refactor');
  });

  it('P10: evidence-anchored question (additive)', () => {
    expect(skillContent).toContain('evidence-anchored question');
  });
});

// ---------------------------------------------------------------------------
// SKILL.md ABSENCE — the absence-halves for the REPLACED tokens above. Each
// old distinctive substring MUST be gone so the new text cannot pass with the
// stale text surviving beside it (FALSE-GREEN guard).
// ---------------------------------------------------------------------------

describe('SKILL.md absence — replaced verify-lane tokens', () => {
  it('A1: old misleading_success_output key is gone', () => {
    expect(skillContent).not.toContain('misleading_success_output');
  });

  it('A2: old dirty_worktree key is gone', () => {
    expect(skillContent).not.toContain('dirty_worktree');
  });

  it('A3: old librarian trigger enumeration is gone', () => {
    expect(skillContent).not.toContain(
      'New library introduction, major version upgrade, security-related technology choice',
    );
  });

  it('A4: old conditional-librarian dispatch line is gone', () => {
    expect(skillContent).not.toContain(
      'librarian dispatched THIS session (Architecture only)',
    );
  });
});

// ---------------------------------------------------------------------------
// SKILL.md SURVIVAL — distinctive substrings of untouched sections that MUST
// remain. Guards that the verify-lane rewrite did not collaterally delete the
// Decomposition Self-Check, the structural-enumeration tier, or the Review
// Pipeline contract.
// ---------------------------------------------------------------------------

describe('SKILL.md survival — untouched-section tokens', () => {
  it('S1: Decomposition Self-Check Output survives', () => {
    expect(skillContent).toContain('Decomposition Self-Check Output');
  });

  it('S2: Structural enumeration (Complex and Architecture only) survives', () => {
    expect(skillContent).toContain(
      'Structural enumeration (Complex and Architecture only)',
    );
  });

  it('S3: Review Pipeline contract heading survives', () => {
    expect(skillContent).toContain('## Review Pipeline (Mandatory Contract)');
  });
});

// ---------------------------------------------------------------------------
// interview.md — the Interview-contract templates pick up the verify-lane
// vocabulary (presence, additive) but MUST NOT carry the SKILL.md-only
// `evidence-anchored question` token (absence — boundary guard).
// ---------------------------------------------------------------------------

describe('interview.md presence — verify-lane templates', () => {
  it('I1: multi-aspect fan-out (additive)', () => {
    expect(interviewContent).toContain('multi-aspect fan-out');
  });

  it('I2: falsifying verifier (additive)', () => {
    expect(interviewContent).toContain('falsifying verifier');
  });
});

describe('interview.md absence — SKILL.md-only token', () => {
  it('I3: evidence-anchored question does not leak into interview.md', () => {
    expect(interviewContent).not.toContain('evidence-anchored question');
  });
});

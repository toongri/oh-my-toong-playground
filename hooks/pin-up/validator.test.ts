/**
 * Tests for pin validator (AC-6, AC-7, AC-18, AC-19).
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  validateSlug,
  validateRequiredFields,
  validateBodySections,
  validateRelatedSlugs,
  validatePin,
} from './validator.ts';
import type { PinExtracted } from './types.ts';

const VALID_BODY = `## 한 줄 요지
verifyToken이 auth 권위

## SSOT 위치
auth/jwt.ts:142

## 전후 컨텍스트
OAuth 리팩토링 중 발견

## 관련 cross-link
없음`;

const VALID_PIN: PinExtracted = {
  slug: 'code-auth-jwt',
  source_url: 'auth/jwt.ts:142',
  authority: 'code',
  tier: 'L1',
  tags: 'auth,jwt',
  sensitivity: 'private',
  body: VALID_BODY,
};

// ─── validateSlug ─────────────────────────────────────────────────────────────

describe('validateSlug', () => {
  it('accepts valid slug code-auth-jwt', () => {
    expect(validateSlug('code-auth-jwt').valid).toBe(true);
  });

  it('accepts valid slug with timestamp suffix', () => {
    expect(validateSlug('code-auth-jwt-143015').valid).toBe(true);
  });

  it('rejects slug with uppercase letters', () => {
    const r = validateSlug('Code-Auth-Jwt');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('slug_violation');
  });

  it('rejects slug with spaces', () => {
    expect(validateSlug('code auth jwt').valid).toBe(false);
  });

  it('rejects slug with invalid kind', () => {
    const r = validateSlug('badkind-auth-token');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('slug_violation');
  });

  it('rejects slug with only two segments', () => {
    // Need at least 3 segments: kind-topic-descriptor
    expect(validateSlug('code-only').valid).toBe(false);
  });

  it('accepts all valid kind values', () => {
    const kinds = ['jira', 'linear', 'slack', 'notion', 'code', 'person', 'decision', 'finding', 'gotcha', 'unknown'];
    for (const kind of kinds) {
      expect(validateSlug(`${kind}-topic-desc`).valid).toBe(true);
    }
  });
});

// ─── validateRequiredFields ───────────────────────────────────────────────────

describe('validateRequiredFields', () => {
  it('passes for all fields present', () => {
    expect(validateRequiredFields(VALID_PIN).valid).toBe(true);
  });

  it('fails when slug is empty string', () => {
    const r = validateRequiredFields({ ...VALID_PIN, slug: '' });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('frontmatter_invalid');
  });

  it('fails when source_url is missing', () => {
    const pin = { ...VALID_PIN, source_url: '' };
    expect(validateRequiredFields(pin).valid).toBe(false);
  });

  it('fails when tags is whitespace only', () => {
    const pin = { ...VALID_PIN, tags: '   ' };
    expect(validateRequiredFields(pin).valid).toBe(false);
  });
});

// ─── validateBodySections ─────────────────────────────────────────────────────

describe('validateBodySections', () => {
  it('passes when all 4 sections present', () => {
    expect(validateBodySections(VALID_BODY).valid).toBe(true);
  });

  it('fails when 한 줄 요지 section is missing', () => {
    const body = VALID_BODY.replace('한 줄 요지', 'REMOVED');
    const r = validateBodySections(body);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('frontmatter_invalid');
  });

  it('fails when SSOT 위치 section is missing', () => {
    const body = VALID_BODY.replace('SSOT 위치', 'REMOVED');
    expect(validateBodySections(body).valid).toBe(false);
  });

  it('fails when 전후 컨텍스트 section is missing', () => {
    const body = VALID_BODY.replace('전후 컨텍스트', 'REMOVED');
    expect(validateBodySections(body).valid).toBe(false);
  });

  it('fails when 관련 cross-link section is missing', () => {
    const body = VALID_BODY.replace('관련 cross-link', 'REMOVED');
    expect(validateBodySections(body).valid).toBe(false);
  });
});

// ─── validateRelatedSlugs ─────────────────────────────────────────────────────

describe('validateRelatedSlugs', () => {
  const testDir = join(tmpdir(), 'pin-up-validator-test-' + Date.now());
  const omtDir = join(testDir, 'omt');

  beforeAll(async () => {
    await mkdir(join(omtDir, 'pins'), { recursive: true });
    // Create one existing pin file
    await writeFile(join(omtDir, 'pins', 'code-existing-pin.md'), '---\nslug: code-existing-pin\n---\nbody', 'utf-8');
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('passes when related is undefined', () => {
    const r = validateRelatedSlugs(omtDir, undefined);
    expect(r.valid).toBe(true);
    expect(r.missingSlugs).toHaveLength(0);
  });

  it('passes when related slug file exists', () => {
    const r = validateRelatedSlugs(omtDir, 'code-existing-pin');
    expect(r.valid).toBe(true);
  });

  it('fails when related slug file does not exist (AC-19)', () => {
    const r = validateRelatedSlugs(omtDir, 'code-nonexistent-pin');
    expect(r.valid).toBe(false);
    expect(r.missingSlugs).toContain('code-nonexistent-pin');
  });

  it('reports missing slugs in comma-separated list', () => {
    const r = validateRelatedSlugs(omtDir, 'code-existing-pin,code-missing-one');
    expect(r.valid).toBe(false);
    expect(r.missingSlugs).toContain('code-missing-one');
    expect(r.missingSlugs).not.toContain('code-existing-pin');
  });
});

// ─── validatePin (composite) ──────────────────────────────────────────────────

describe('validatePin', () => {
  const testDir = join(tmpdir(), 'pin-up-validatepin-test-' + Date.now());
  const omtDir = join(testDir, 'omt');

  beforeAll(async () => {
    await mkdir(join(omtDir, 'pins'), { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('passes for a fully valid pin', () => {
    expect(validatePin(VALID_PIN, omtDir).valid).toBe(true);
  });

  it('fails fast on required field violation (frontmatter_invalid)', () => {
    const r = validatePin({ ...VALID_PIN, slug: '' }, omtDir);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('frontmatter_invalid');
  });

  it('fails on invalid slug format (slug_violation)', () => {
    const r = validatePin({ ...VALID_PIN, slug: 'INVALID SLUG' }, omtDir);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('slug_violation');
  });

  it('fails when body 4-section header is missing (AC-18)', () => {
    const r = validatePin({ ...VALID_PIN, body: '## 한 줄 요지\nonly one section' }, omtDir);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('frontmatter_invalid');
  });
});

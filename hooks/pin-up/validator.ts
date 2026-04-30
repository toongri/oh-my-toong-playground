/**
 * Pin frontmatter and body validator (AC-6, AC-7, AC-18, AC-19).
 *
 * Validates:
 * - 7 required frontmatter fields
 * - Slug regex (AC-7, principles ①~⑤)
 * - Body 4-section headers (AC-18)
 * - Related slug existence (AC-19)
 */

import { existsSync } from 'fs';
import { join } from 'path';
import type { PinExtracted, EscapeReason } from './types.ts';

// AC-7: slug regex — {kind}-{topic}-{descriptor}[-HHMMSS]
// ①~⑤ auto-verified: format + no spaces + lowercase + kebab
export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+){2,}(-\d{6})?$/;

// AC-7: valid kind values
export const VALID_KINDS = new Set([
  'jira', 'linear', 'slack', 'github', 'notion', 'code', 'person',
  'decision', 'finding', 'gotcha', 'unknown',
]);

// AC-18: body 4-section headers (Korean)
const BODY_SECTIONS = [
  '한 줄 요지',
  'SSOT 위치',
  '전후 컨텍스트',
  '관련 cross-link',
];

export interface ValidationResult {
  valid: boolean;
  reason?: EscapeReason;
  message?: string;
}

/**
 * Validate that the pin slug matches the required format.
 * AC-7 principles ①~⑤ (auto-verifiable portion).
 */
export function validateSlug(slug: string): ValidationResult {
  if (!SLUG_REGEX.test(slug)) {
    return {
      valid: false,
      reason: 'slug_violation',
      message: `slug "${slug}" does not match pattern ^[a-z0-9]+(-[a-z0-9]+){2,}(-\\d{6})?$`,
    };
  }

  // Extract kind (first segment)
  const kind = slug.split('-')[0];
  if (!VALID_KINDS.has(kind)) {
    return {
      valid: false,
      reason: 'slug_violation',
      message: `slug kind "${kind}" not in allowed set: ${[...VALID_KINDS].join('|')}`,
    };
  }

  return { valid: true };
}

/**
 * Validate the 7 required fields are present and non-empty.
 */
export function validateRequiredFields(pin: PinExtracted): ValidationResult {
  const required: Array<keyof PinExtracted> = [
    'slug', 'source_url', 'authority', 'tier', 'tags', 'sensitivity',
  ];

  for (const field of required) {
    const value = pin[field];
    if (!value || String(value).trim() === '') {
      return {
        valid: false,
        reason: 'frontmatter_invalid',
        message: `required field "${field}" is missing or empty`,
      };
    }
  }

  if (pin.sensitivity !== 'private' && pin.sensitivity !== 'shared') {
    return {
      valid: false,
      reason: 'frontmatter_invalid',
      message: `sensitivity "${pin.sensitivity}" must be 'private' or 'shared'`,
    };
  }

  return { valid: true };
}

/**
 * Validate body contains all 4 required section headers (AC-18).
 */
export function validateBodySections(body: string): ValidationResult {
  for (const section of BODY_SECTIONS) {
    if (!body.includes(section)) {
      return {
        valid: false,
        reason: 'frontmatter_invalid',
        message: `body missing required section: "${section}"`,
      };
    }
  }
  return { valid: true };
}

/**
 * Validate that related slugs exist as files in $OMT_DIR/pins/ (AC-19).
 * Returns array of missing slugs.
 */
export function validateRelatedSlugs(
  omtDir: string,
  related: string | undefined,
  batchSlugs?: Set<string>,
): { valid: boolean; missingSlugs: string[] } {
  if (!related || related.trim() === '') {
    return { valid: true, missingSlugs: [] };
  }

  const slugs = related.split(',').map((s) => s.trim()).filter(Boolean);
  const missingSlugs = slugs.filter((slug) => {
    if (batchSlugs?.has(slug)) return false;
    return !existsSync(join(omtDir, 'pins', `${slug}.md`));
  });

  return {
    valid: missingSlugs.length === 0,
    missingSlugs,
  };
}

/**
 * Full validation of a pin (required fields + slug + body + related).
 * Returns the first failing validation, or { valid: true } if all pass.
 */
export function validatePin(
  pin: PinExtracted,
  omtDir: string,
  batchSlugs?: Set<string>,
): ValidationResult {
  // 1. Required fields
  const fieldsResult = validateRequiredFields(pin);
  if (!fieldsResult.valid) return fieldsResult;

  // 2. Slug format
  const slugResult = validateSlug(pin.slug);
  if (!slugResult.valid) return slugResult;

  // 3. Body 4 sections
  const bodyResult = validateBodySections(pin.body);
  if (!bodyResult.valid) return bodyResult;

  // 4. Related slug existence
  const relatedResult = validateRelatedSlugs(omtDir, pin.related, batchSlugs);
  if (!relatedResult.valid) {
    return {
      valid: false,
      reason: 'frontmatter_invalid',
      message: `related slugs not found: ${relatedResult.missingSlugs.join(', ')}`,
    };
  }

  return { valid: true };
}

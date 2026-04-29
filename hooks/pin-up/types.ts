// Stop event hook input (AC-3c: transcript_path + sessionId required, cwd optional)
export interface HookInput {
  transcript_path: string;
  sessionId?: string;
  session_id?: string;
  cwd?: string;
}

// .cursor.json schema (AC-3b)
export interface CursorState {
  transcripts: Record<
    string,
    {
      byte_offset: number;
      last_uuid: string;
      updated_at: string; // ISO8601
    }
  >;
}

// Extracted <pin> block from transcript (AC-5)
export interface PinExtracted {
  // Required attrs
  slug: string;
  source_url: string;
  authority: string;
  tier: string; // TODO: narrow to 'L1'|'L2'|'L3' once plan enumerates values
  tags: string;
  sensitivity: Sensitivity;
  // Optional attrs
  related?: string;
  supersedes?: string;
  discovery_context?: string;
  // Pin body text
  body: string;
}

// .escape.jsonl entry schema (AC-14)
export interface EscapeEntry {
  ts: string; // ISO8601
  session_id: string;
  reason: EscapeReason;
  pin_slug: string | null;
  raw: string; // truncated to ≤1500 bytes
}

export type EscapeReason =
  | 'frontmatter_invalid'
  | 'slug_violation'
  | 'parse_error'
  | 'unknown';

export type Sensitivity = 'private' | 'shared';

// Frontmatter schema for a written pin file (AC-6)
export interface FrontmatterSchema {
  // 7 mandatory fields
  slug: string;
  source_url: string;
  authority: string;
  tier: string; // TODO: narrow to 'L1'|'L2'|'L3' once plan enumerates values
  tags: string[];
  sensitivity: Sensitivity;
  created_at: string; // ISO8601
  // 3 optional fields
  related?: string[];
  supersedes?: string;
  discovery_context?: string;
}

// Stop event hook output (minimal)
export interface HookOutput {
  continue?: boolean;
}

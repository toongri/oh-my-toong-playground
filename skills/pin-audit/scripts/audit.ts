#!/usr/bin/env bun
import { audit } from '@lib/pins/audit';
import { requireManifest, failEngine } from '@lib/pin-cli/io';

if (import.meta.main) {
  const manifest = await requireManifest();

  let result;
  try {
    result = await audit(manifest.location, { now: new Date() });
  } catch (err) {
    failEngine(err instanceof Error ? err.message : String(err));
  }

  console.log(JSON.stringify(result.findings, null, 2));
}

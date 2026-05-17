import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

describe('orchestrate-review sentinel drift detection', () => {
  test('deliverable_sentinel regex matches checked-in sample fixture', () => {
    const yamlPath = path.resolve(import.meta.dirname, 'orchestrate-review.config.yaml');
    const config: any = yaml.parse(fs.readFileSync(yamlPath, 'utf8'));
    const sentinel = config['chunk-review']?.multi_turn?.deliverable_sentinel;
    expect(typeof sentinel).toBe('string');

    const samplePath = path.resolve(
      import.meta.dirname,
      '../../lib/agent-drivers/__fixtures__/sentinel/orchestrate-review-sample.txt',
    );
    const sample = fs.readFileSync(samplePath, 'utf8');

    expect(new RegExp(sentinel).test(sample)).toBe(true);
  });
});

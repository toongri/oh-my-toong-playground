import { describe, test, expect } from 'bun:test';
import { parseYamlStrict } from './yaml';

describe('parseYamlStrict', () => {
  describe('top-level duplicate key → throws', () => {
    test('duplicate top-level key throws naming the key', () => {
      const input = 'a: 1\na: 2\n';
      expect(() => parseYamlStrict(input)).toThrow('a');
    });

    test('duplicate id key throws', () => {
      const input = 'id: abc\ntype: code\nid: xyz\n';
      expect(() => parseYamlStrict(input)).toThrow('id');
    });
  });

  describe('nested duplicate key → throws', () => {
    test('duplicate key inside a nested mapping throws naming the key', () => {
      const input = [
        'relation_types:',
        '  documents: {}',
        '  documents: {}',
      ].join('\n');
      expect(() => parseYamlStrict(input)).toThrow('documents');
    });

    test('duplicate key in deeply nested mapping throws', () => {
      const input = [
        'outer:',
        '  inner:',
        '    key: 1',
        '    key: 2',
      ].join('\n');
      expect(() => parseYamlStrict(input)).toThrow('key');
    });
  });

  describe('multi-document input → throws', () => {
    test('two-document YAML separated by --- throws', () => {
      const input = '---\na: 1\n---\nb: 2\n';
      expect(() => parseYamlStrict(input)).toThrow('multi-document');
    });
  });

  describe('valid input → returns parsed value', () => {
    test('valid single-doc with nested mappings returns parsed object', () => {
      const input = [
        'id: proj-abc',
        'type: code',
        'relation_types:',
        '  documents:',
        '    domain: [code]',
        '  derived_from:',
        '    domain: [decision]',
      ].join('\n');
      const result = parseYamlStrict(input);
      expect(result).toMatchObject({
        id: 'proj-abc',
        type: 'code',
        relation_types: {
          documents: { domain: ['code'] },
          derived_from: { domain: ['decision'] },
        },
      });
    });

    test('flat mapping with no duplicates returns parsed value', () => {
      const input = 'location: /home/pins\nscope: project\n';
      const result = parseYamlStrict(input);
      expect(result).toEqual({ location: '/home/pins', scope: 'project' });
    });
  });

  describe('genuinely malformed YAML → still throws', () => {
    test('invalid YAML token still throws', () => {
      const input = 'key: [unclosed bracket\n';
      expect(() => parseYamlStrict(input)).toThrow();
    });
  });

  describe('block scalar body is not treated as duplicate keys', () => {
    test('literal block scalar (|) with colon-containing body does not throw', () => {
      // "decision:" appears twice inside the block scalar body — these are
      // prose lines, NOT mapping keys. The scanner must skip them.
      const input = [
        'discovery_context: |',
        '  decision: keep the old API',
        '  decision: also note the migration',
        'id: proj-abc',
      ].join('\n');
      expect(() => parseYamlStrict(input)).not.toThrow();
    });

    test('folded block scalar (>) with colon-containing body does not throw', () => {
      const input = [
        'summary: >',
        '  note: first line',
        '  note: second line',
        'id: proj-xyz',
      ].join('\n');
      expect(() => parseYamlStrict(input)).not.toThrow();
    });

    test('real duplicate mapping keys (NOT under a scalar) still throw', () => {
      // These "decision:" lines are at the SAME level as a sibling key,
      // not under a block scalar — they must still be caught.
      const input = [
        'decision: keep the old API',
        'decision: also note the migration',
      ].join('\n');
      expect(() => parseYamlStrict(input)).toThrow('decision');
    });
  });
});

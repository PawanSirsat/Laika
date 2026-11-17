/**
 * Pre-rendered diagram keys (LAI-1131, T5).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { diagramKey, mermaidSources } from '../../../src/components/documents/diagram-key.ts';

void describe('diagramKey', () => {
  void test('eight hex characters, stable', () => {
    assert.match(diagramKey('flowchart LR\n  A --> B'), /^[0-9a-f]{8}$/);
    assert.equal(diagramKey('flowchart LR\n  A --> B'), diagramKey('flowchart LR\n  A --> B'));
  });

  void test('line endings and surrounding blank space do not matter; content does', () => {
    assert.equal(diagramKey('a\r\nb\n'), diagramKey('\na\nb'));
    assert.notEqual(diagramKey('A --> B'), diagramKey('A --> C'));
  });
});

void describe('mermaidSources', () => {
  void test('only mermaid fences, in order', () => {
    const md =
      '```mermaid\nflowchart LR\n  A-->B\n```\n\n```ts\nconst x = 1;\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n';
    assert.deepEqual(mermaidSources(md), [
      'flowchart LR\n  A-->B\n',
      'sequenceDiagram\n  A->>B: hi\n',
    ]);
  });
});

/**
 * Code highlighting (LAI-1131, T4): lowlight to class names, no styles, and
 * no guessing at unknown languages.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  highlight,
  isHighlighted,
  type CodeNode,
} from '../../../src/components/documents/highlight.ts';

function text(nodes: readonly CodeNode[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.value : text(n.children))).join('');
}

function classes(nodes: readonly CodeNode[]): string[] {
  return nodes.flatMap((n) => (n.type === 'text' ? [] : [...n.className, ...classes(n.children)]));
}

void describe('highlight', () => {
  for (const [lang, code, expected] of [
    ['ts', 'export const x: number = 1;', 'hljs-keyword'],
    ['sql', 'SELECT id FROM outbox WHERE seq > 1;', 'hljs-keyword'],
    ['bash', 'for h in a b; do echo "$h"; done', 'hljs-keyword'],
    ['json', '{"a": 1, "b": "two"}', 'hljs-attr'],
  ] as const) {
    void test(`${lang}: classes, and the text unchanged`, () => {
      const tree = highlight(code, lang);
      assert.ok(tree !== null, `${lang} not registered`);
      assert.equal(text(tree), code);
      assert.ok(classes(tree).includes(expected), `${lang}: ${classes(tree).join(' ')}`);
      assert.ok(classes(tree).every((c) => c.startsWith('hljs-') || c.endsWith('_')));
    });
  }

  void test('aliases resolve', () => {
    for (const alias of ['typescript', 'shell', 'sh', 'yml', 'js'])
      assert.ok(isHighlighted(alias), alias);
  });

  void test('an unknown language is null — the block shows plain, never guessed', () => {
    assert.equal(highlight('whatever', 'cobol'), null);
    assert.equal(isHighlighted('mermaid'), false);
  });
});

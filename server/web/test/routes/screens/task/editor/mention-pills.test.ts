/**
 * The editor's `@name` pills (LAI-868): a decoration over a parsed document.
 *
 * Run in Node against the bridge's own parse, so the document is the one the
 * editor opens. The browser test in `task-panel-editing.test.ts` shows them
 * drawn; this pins which ranges they cover.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EditorState } from '@tiptap/pm/state';
import type { MentionCandidate } from '../../../../../src/routes/screens/task/LazyRichEditor.tsx';
import { MARKDOWN_EXTENSIONS } from '../../../../../src/routes/screens/task/editor/extensions.ts';
import {
  createBridge,
  parseMarkdown,
} from '../../../../../src/routes/screens/task/editor/markdown-bridge.ts';
import {
  mentionDecorations,
  mentionPillsKey,
  redrawMentions,
} from '../../../../../src/routes/screens/task/editor/mention-pills.ts';

const bridge = createBridge(MARKDOWN_EXTENSIONS);

const people: MentionCandidate[] = [
  { id: 'u1', name: 'Ada Lovelace', handle: 'ada' },
  { id: 'u2', name: 'Grace Hopper', handle: 'grace' },
  { id: 'u3', name: 'Sam One', handle: 'sam' },
  { id: 'u4', name: 'Sam Two', handle: 'sam' },
];

/** Each pill as `text:kind`, in document order. */
function pillsIn(markdown: string, meId?: string): string[] {
  const doc = parseMarkdown(bridge, markdown, bridge.schema);
  assert.ok(doc !== null, `did not parse: ${markdown}`);
  return mentionDecorations(doc, { people, meId })
    .find()
    .sort((a, b) => a.from - b.from)
    .map(
      (d) => `${doc.textBetween(d.from, d.to)}:${String((d.spec as { mention?: string }).mention)}`,
    );
}

void describe('a pill covers the mention and nothing else', () => {
  void test('in plain text, in brackets and in bold', () => {
    assert.deepEqual(pillsIn('ask @ada, then (@ada) and **@grace**.'), [
      '@ada:person',
      '@ada:person',
      '@grace:person',
    ]);
  });

  void test('the reader’s own handle is the reader’s pill', () => {
    assert.deepEqual(pillsIn('for @ada and @grace', 'u1'), ['@ada:me', '@grace:person']);
  });

  void test('the machines, when nobody holds their handle', () => {
    assert.deepEqual(pillsIn('handed to @strelka and @belka'), [
      '@strelka:machine',
      '@belka:machine',
    ]);
  });

  void test('an address, a shared handle and a stranger stay plain text', () => {
    assert.deepEqual(pillsIn('mail ada@example.com, ask @sam or @nobody'), []);
  });

  void test('not in inline code, a code block or a link’s words', () => {
    assert.deepEqual(pillsIn('see `@ada` here'), []);
    assert.deepEqual(pillsIn('```\n@ada\n```'), []);
    assert.deepEqual(pillsIn('see [@ada](https://example.com/a)'), []);
    // Positive control: the same paragraph with a real mention beside them.
    assert.deepEqual(pillsIn('see `@ada` and [@ada](https://example.com/a), @grace'), [
      '@grace:person',
    ]);
  });

  void test('in a list item, a heading and a table cell', () => {
    assert.deepEqual(pillsIn('- for @ada\n\n## @grace\n\n| who |\n|---|\n| @ada |'), [
      '@ada:person',
      '@grace:person',
      '@ada:person',
    ]);
  });
});

void describe('a pill is not in the document', () => {
  /*
   * The decoration's whole point: the bridge's schema, and so a save, has no
   * idea a mention is special. The byte-for-byte case in
   * `markdown-bridge.test.ts` catches a mention mark that loses characters on
   * the way out; this catches one that writes them back exactly, which that
   * case cannot see.
   */
  void test('the bridge parses a mention as plain text, with only the marks around it', () => {
    const doc = parseMarkdown(bridge, 'Ask @ada, then **@grace**.', bridge.schema);
    assert.ok(doc !== null);
    const runs: string[] = [];
    doc.descendants((node) => {
      if (node.isText)
        runs.push(`${node.text ?? ''}|${node.marks.map((m) => m.type.name).join('+')}`);
      return true;
    });
    assert.deepEqual(runs, ['Ask @ada, then |', '@grace|bold', '.|']);
  });
});

void describe('a redraw changes nothing in the document', () => {
  void test('it is marked for the plugin, kept out of undo, and has no steps', () => {
    const doc = parseMarkdown(bridge, 'for @ada', bridge.schema);
    assert.ok(doc !== null);
    const tr = redrawMentions(EditorState.create({ doc }).tr);
    assert.equal(tr.getMeta(mentionPillsKey), true);
    assert.equal(tr.getMeta('addToHistory'), false);
    assert.equal(tr.docChanged, false);
    assert.equal(tr.steps.length, 0);
  });
});

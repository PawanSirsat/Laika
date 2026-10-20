/**
 * The editor's extension set (LAI-827): what it can hold, and the one link
 * rule it adds.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getSchema } from '@tiptap/core';
import {
  isBareAutolink,
  MARKDOWN_EXTENSIONS,
} from '../../../../../src/routes/screens/task/editor/extensions.ts';

void describe('the schema holds what markdown stores, and nothing it would lose', () => {
  const schema = getSchema([...MARKDOWN_EXTENSIONS]);

  void test('lists, checklists, tables, code, quotes, headings and links are in', () => {
    for (const node of [
      'paragraph',
      'heading',
      'bulletList',
      'orderedList',
      'taskList',
      'taskItem',
      'table',
      'tableRow',
      'tableHeader',
      'tableCell',
      'codeBlock',
      'blockquote',
      'horizontalRule',
      'hardBreak',
    ]) {
      assert.ok(schema.nodes[node], `no ${node}`);
    }
    for (const mark of ['bold', 'italic', 'strike', 'code', 'link']) {
      assert.ok(schema.marks[mark], `no ${mark}`);
    }
  });

  void test('no image, no underline, no colour', () => {
    assert.equal(schema.nodes.image, undefined);
    assert.equal(schema.marks.underline, undefined);
    assert.equal(schema.marks.textStyle, undefined);
  });
});

void describe('a link GFM would make by itself is written bare', () => {
  void test('a URL, a www. address and an email address whose text is the address', () => {
    assert.equal(isBareAutolink('https://x.dev/a_b', 'https://x.dev/a_b'), true);
    assert.equal(isBareAutolink('www.x.dev', 'http://www.x.dev'), true);
    assert.equal(isBareAutolink('ada@x.dev', 'mailto:ada@x.dev'), true);
  });

  void test('not a link whose words are not its address', () => {
    assert.equal(isBareAutolink('the repo', 'https://x.dev'), false);
    assert.equal(isBareAutolink('https://x.dev', 'https://y.dev'), false);
    assert.equal(isBareAutolink('/board?task=t1', '/board?task=t1'), false);
    assert.equal(isBareAutolink('www.x.dev', 'https://www.x.dev'), false);
  });
});

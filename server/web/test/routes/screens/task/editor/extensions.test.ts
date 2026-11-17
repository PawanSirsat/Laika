/**
 * The editor's extension set (LAI-827): what it can hold, the one link rule
 * it adds, and the one image it holds — Laika's own attachment (D-150).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getSchema, type JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
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

  void test('no underline, no colour', () => {
    assert.equal(schema.marks.underline, undefined);
    assert.equal(schema.marks.textStyle, undefined);
  });

  void test('an image is inline, for an attachment in the sentence it illustrates (D-150)', () => {
    assert.ok(schema.nodes.image, 'no image');
    assert.equal(schema.nodes.image.isInline, true);
    // A paragraph may hold one, so a screenshot on a line of its own is a paragraph.
    assert.ok(schema.nodes.paragraph?.contentMatch.matchType(schema.nodes.image));
  });
});

void describe('the image is Laika’s attachment and nothing else (D-150)', () => {
  const manager = new MarkdownManager({ extensions: [...MARKDOWN_EXTENSIONS] });
  const ID = '01JCZ8Y3V4QK9M2N7P5R6S8T0W';
  const URL = `/api/v1/attachments/${ID}/content`;
  const inlineOf = (markdown: string): JSONContent[] =>
    manager.parse(markdown).content?.[0]?.content ?? [];

  void test('an attachment’s markdown is an image node, its alt and address kept', () => {
    assert.deepEqual(
      inlineOf(`See ![shot.png](${URL}) here`).map((node) => node.type),
      ['text', 'image', 'text'],
    );
    const [image] = inlineOf(`![shot \\] 1.png](${URL})`);
    assert.equal(image?.type, 'image');
    assert.equal(image?.attrs?.src, URL);
    assert.equal(image?.attrs?.alt, 'shot ] 1.png');
  });

  void test('a paragraph of only an image stays a paragraph', () => {
    const doc = manager.parse(`![shot.png](${URL})`);
    assert.equal(doc.content?.[0]?.type, 'paragraph');
    assert.equal(doc.content?.[0]?.content?.[0]?.type, 'image');
  });

  void test('any other image parses to nothing — no node that would load it', () => {
    for (const src of [
      'https://example.com/pixel.png',
      `https://evil.example${URL}`,
      `${URL}?track=1`,
      'data:image/png;base64,AAAA',
    ]) {
      const found = JSON.stringify(manager.parse(`a ![x](${src}) b`));
      assert.doesNotMatch(found, /"image"/, src);
    }
  });

  void test('its alt text is written escaped, so a bracket cannot end it early', () => {
    const written = manager.serialize({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'image', attrs: { src: URL, alt: 'v2] [draft].png', title: null } }],
        },
      ],
    });
    assert.equal(written.trim(), `![v2\\] \\[draft\\].png](${URL})`);
  });

  void test('typing `![…](…)` makes no image: the input rule is gone', () => {
    const image = MARKDOWN_EXTENSIONS.find((extension) => extension.name === 'image');
    assert.ok(image, 'no image extension');
    // Called bare: the override needs no editor, and the library's rule would.
    const addInputRules = image.config.addInputRules as (() => unknown) | undefined;
    const rules = addInputRules?.call({});
    assert.deepEqual(rules, []);
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

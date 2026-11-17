/**
 * The document outline and heading anchors (LAI-1131, T2/T3).
 *
 * The last suite is the one that matters most: the outline is read from the
 * Markdown source and the ids are stamped on the rendered tree by a different
 * path, so it renders every trial fixture with the real renderer pipeline and
 * asserts the two produce the same ids in the same order.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  extractOutline,
  headingIds,
  outlineTree,
  plainHeadingText,
  slugify,
  Slugger,
} from '../../../src/components/documents/outline.ts';

const FIXTURES = fileURLToPath(
  new URL('../../../src/components/documents/trial/fixtures/', import.meta.url),
);

void describe('slugify', () => {
  void test('lower-case words joined by hyphens', () => {
    assert.equal(slugify('4.4 The sync service'), '4-4-the-sync-service');
    assert.equal(slugify('  What — the reader? '), 'what-the-reader');
    assert.equal(slugify('Café déjà vu'), 'cafe-deja-vu');
  });

  void test('never empty', () => {
    assert.equal(slugify('—'), 'section');
    assert.equal(slugify(''), 'section');
  });
});

void describe('Slugger: unique ids', () => {
  void test('repeats get -2, -3', () => {
    const s = new Slugger();
    assert.deepEqual(
      ['Set-up', 'Result', 'Set-up', 'Set-up'].map((t) => s.slug(t)),
      ['set-up', 'result', 'set-up-2', 'set-up-3'],
    );
  });

  void test('a heading literally named "x 2" does not collide with a generated one', () => {
    const s = new Slugger();
    const got = ['Set-up', 'Set-up 2', 'Set-up'].map((t) => s.slug(t));
    assert.deepEqual(got, ['set-up', 'set-up-2', 'set-up-3']);
    assert.equal(new Set(got).size, got.length);
  });
});

void describe('extractOutline', () => {
  void test('reads ATX headings with depth, words and h- ids', () => {
    const outline = extractOutline(
      '# Title\n\nText\n\n## 1. **Bold** `code`\n\n### [Link](https://x.test) here\n',
    );
    assert.deepEqual(outline, [
      { depth: 1, text: 'Title', id: 'h-title' },
      { depth: 2, text: '1. Bold code', id: 'h-1-bold-code' },
      { depth: 3, text: 'Link here', id: 'h-link-here' },
    ]);
  });

  void test('ignores # inside fenced code, including longer and tilde fences', () => {
    const md = [
      '# Real',
      '```bash',
      '# a shell comment',
      '```',
      '~~~~',
      '## not a heading',
      '~~~~',
      '## Also real',
    ].join('\n');
    assert.deepEqual(
      extractOutline(md).map((e) => e.text),
      ['Real', 'Also real'],
    );
  });

  void test('duplicate headings get unique ids', () => {
    const ids = extractOutline('## Set-up\n## Set-up\n## Result\n## Set-up').map((e) => e.id);
    assert.deepEqual(ids, ['h-set-up', 'h-set-up-2', 'h-result', 'h-set-up-3']);
  });

  void test('plainHeadingText strips emphasis, code, links and closing hashes', () => {
    assert.equal(plainHeadingText('*Why* the `relay` **stops** ##'), 'Why the relay stops');
  });
});

void describe('outlineTree', () => {
  void test('nests deeper entries under the heading before them, to maxDepth', () => {
    const tree = outlineTree(extractOutline('# A\n## B\n### C\n#### D\n## E'));
    assert.equal(tree.length, 1);
    assert.deepEqual(
      tree[0]?.children.map((c) => [c.text, c.children.map((g) => g.text)]),
      [
        ['B', ['C']],
        ['E', []],
      ],
    );
  });
});

function renderedIds(markdown: string): string[] {
  const html = renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm], rehypePlugins: [headingIds] }, markdown),
  );
  return [...html.matchAll(/<h[1-6] id="(h-[^"]+)"/g)].map((m) => m[1] ?? '');
}

void describe('the rendered ids are the outline ids', () => {
  const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.md'));

  void test('there are fixtures to check', () => {
    assert.ok(fixtures.length >= 4, `only ${String(fixtures.length)} fixtures found`);
  });

  for (const name of fixtures) {
    void test(name, () => {
      const source = readFileSync(join(FIXTURES, name), 'utf8');
      const outline = extractOutline(source).map((e) => e.id);
      assert.ok(outline.length > 5, 'fixture has no outline');
      assert.deepEqual(renderedIds(source), outline);
      assert.equal(new Set(outline).size, outline.length, 'duplicate ids');
    });
  }

  void test('the footnote label keeps its own id and stays out of the outline', () => {
    const md = '# T\n\nA claim.[^1]\n\n[^1]: Source.';
    const html = renderToStaticMarkup(
      createElement(Markdown, { remarkPlugins: [remarkGfm], rehypePlugins: [headingIds] }, md),
    );
    assert.match(html, /<h2[^>]*id="footnote-label"/);
    assert.deepEqual(renderedIds(md), ['h-t']);
  });
});

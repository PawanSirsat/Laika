/**
 * The document renderer's tree steps (LAI-1131): callouts and table captions,
 * run through the real react-markdown pipeline.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { callouts, tableCaptions } from '../../../src/components/documents/doc-plugins.ts';

function render(md: string): string {
  return renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: [remarkGfm], rehypePlugins: [callouts, tableCaptions] },
      md,
    ),
  );
}

void describe('callouts', () => {
  void test('> [!WARNING] marks the blockquote and drops the marker', () => {
    const html = render('> [!WARNING]\n> Depth alone is not the signal.');
    assert.match(html, /<blockquote data-callout="warning">/);
    assert.ok(!html.includes('[!WARNING]'));
    assert.match(html, /Depth alone is not the signal\./);
  });

  void test('every kind, case-insensitive', () => {
    for (const kind of ['note', 'tip', 'important', 'warning', 'caution']) {
      assert.match(render(`> [!${kind}]\n> x`), new RegExp(`data-callout="${kind}"`));
    }
  });

  void test('a plain blockquote is untouched', () => {
    const html = render('> Just a quote [!NOTE] in the middle.');
    assert.ok(!html.includes('data-callout'));
    assert.match(html, /\[!NOTE\]/);
  });

  void test('raw HTML in a callout stays text', () => {
    const html = render('> [!NOTE]\n> <script>alert(1)</script>');
    assert.ok(!html.includes('<script>'));
  });
});

void describe('tableCaptions', () => {
  const md =
    '## 2. Results\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n## 3. Wide\n\n' +
    `| ${Array.from({ length: 12 }, (_, i) => `c${String(i)}`).join(' | ')} |\n` +
    `|${' - |'.repeat(12)}\n` +
    `| ${Array.from({ length: 12 }, () => 'x').join(' | ')} |\n`;

  void test('numbered captions under the heading they follow', () => {
    const html = render(md);
    assert.match(html, /<caption>Table 1 · 2\. Results<\/caption>/);
    assert.match(html, /<caption>Table 2 · 3\. Wide<\/caption>/);
  });

  void test('the column count, for the sticky first column', () => {
    const html = render(md);
    assert.match(html, /<table data-columns="2">/);
    assert.match(html, /<table data-columns="12">/);
  });
});

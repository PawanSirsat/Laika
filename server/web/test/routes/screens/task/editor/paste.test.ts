/**
 * What a paste keeps (LAI-827): the rules, in Node.
 *
 * Node has no `DOMParser`, so the walk itself — HTML in, reduced HTML out, no
 * image fetched, no script run — is proved in a real browser by
 * `test/browser/task-panel-editing.test.ts`. These pin the two decisions it
 * makes: what each tag becomes, and which link addresses survive.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { safeHref, tagPolicy } from '../../../../../src/routes/screens/task/editor/paste.ts';

void describe('what each pasted element becomes', () => {
  void test('text, lists, links and tables are kept', () => {
    for (const tag of ['p', 'br', 'ul', 'ol', 'li', 'a', 'table', 'tr', 'th', 'td', 'TBODY']) {
      assert.equal(tagPolicy(tag), 'keep', tag);
    }
  });

  void test('anything that runs, loads or is not text is dropped with its contents', () => {
    for (const tag of ['script', 'style', 'img', 'iframe', 'svg', 'object', 'video', 'meta']) {
      assert.equal(tagPolicy(tag), 'drop', tag);
    }
  });

  void test('headings, quotes and code become plain paragraphs; inline styling gives up its words', () => {
    for (const tag of ['h1', 'h3', 'blockquote', 'pre', 'div']) {
      assert.equal(tagPolicy(tag), 'block', tag);
    }
    for (const tag of ['b', 'strong', 'em', 'span', 'code', 'font', 'u', 'mark']) {
      assert.equal(tagPolicy(tag), 'unwrap', tag);
    }
  });
});

void describe('which pasted links stay links', () => {
  void test('absolute web and mail addresses', () => {
    assert.equal(safeHref('https://example.com/a'), 'https://example.com/a');
    assert.equal(safeHref(' http://example.com '), 'http://example.com');
    assert.equal(safeHref('mailto:ada@example.com'), 'mailto:ada@example.com');
  });

  void test('not a script, a data URL, or a path that meant another site', () => {
    for (const href of [
      'javascript:alert(1)',
      ' JavaScript:x',
      'data:text/html,x',
      '/browse/KAN-10',
      '#top',
      null,
    ]) {
      assert.equal(safeHref(href), null, String(href));
    }
  });
});

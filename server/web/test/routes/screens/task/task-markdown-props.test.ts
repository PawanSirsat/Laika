/**
 * `TaskMarkdown` takes no tree transform from its caller (LAI-734).
 *
 * A rehype plugin runs before react-markdown escapes raw HTML and before the
 * components map, so a caller-supplied one could turn raw HTML back into
 * elements or retag an `img` past the alt-text rule. The review of LAI-734
 * showed both with a plugin prop that existed for one comment-only transform.
 * That transform now lives inside `TaskMarkdown` behind a boolean; this keeps
 * an open-ended plugin prop from coming back.
 *
 * Source-level because `node --test` cannot import a `.tsx`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../../../../src/routes/screens/task/TaskMarkdown.tsx', import.meta.url)),
  'utf8',
);

/** The body of `interface TaskMarkdownProps { … }`. */
function propsBlock(): string {
  const match = /export interface TaskMarkdownProps \{([\s\S]*?)\n\}/.exec(SOURCE);
  assert.ok(match?.[1], 'TaskMarkdownProps not found — the test cannot see the props');
  return match[1];
}

/** The destructured parameter list of `function TaskMarkdown(…)`. */
function signature(): string {
  const match = /export function TaskMarkdown\(([\s\S]*?)\)\s*\{/.exec(SOURCE);
  assert.ok(match?.[1], 'TaskMarkdown not found — the test cannot see its signature');
  return match[1];
}

void describe('TaskMarkdown props', () => {
  void test('the props are found, so the checks below can fail', () => {
    assert.match(propsBlock(), /readonly source: string;/);
    assert.match(signature(), /\bsource\b/);
  });

  void test('no rehypePlugins or remarkPlugins prop', () => {
    for (const name of ['rehypePlugins', 'remarkPlugins']) {
      assert.doesNotMatch(propsBlock(), new RegExp(`\\b${name}\\b`), `${name} is a prop again`);
      assert.doesNotMatch(signature(), new RegExp(`\\b${name}\\b`), `${name} is read from props`);
    }
  });

  void test('the plugins passed to the renderer are module constants', () => {
    assert.match(SOURCE, /remarkPlugins=\{\[remarkGfm\]\}/);
    // Two booleans choose among the lists (LAI-1352 added the image row), and
    // `pluginsFor` returns nothing but those constants.
    assert.match(SOURCE, /rehypePlugins=\{pluginsFor\(singleHardBreaks, imageRow\)\}/);
    const body = /function pluginsFor\([^)]*\) \{([\s\S]*?)\n\}/.exec(SOURCE)?.[1];
    assert.ok(body !== undefined, 'pluginsFor not found — the test cannot see what it returns');
    const returned = [...body.matchAll(/\b[A-Z][A-Z_]+\b/g)].map((m) => m[0]);
    // LAI-868: the mention step is always on, so the off case is `MENTIONS`.
    assert.deepEqual([...new Set(returned)].sort(), [
      'IMAGE_ROW',
      'IMAGE_ROW_AND_SINGLE_HARD_BREAKS',
      'MENTIONS',
      'MENTIONS_AND_SINGLE_HARD_BREAKS',
    ]);
    assert.doesNotMatch(body, /props|\bplugins\b|=>/, 'it returns a list it was given');
  });
});

/**
 * D-150: the reading view loads one kind of image, Laika's own attachment.
 * An `<img>` is built in exactly one place, and the `img` renderer reaches it
 * only past `isAttachmentUrl`; anything else is still the alt text.
 */
void describe('TaskMarkdown loads no image but an attachment (D-150)', () => {
  void test('one <img> element in the file, inside AttachmentImage', () => {
    const images = [...SOURCE.matchAll(/<img\b/g)];
    assert.equal(images.length, 1, 'an <img> is built somewhere else too');
    const body = /function AttachmentImage\([\s\S]*?\n\}/.exec(SOURCE)?.[0] ?? '';
    assert.match(body, /<img\b/, 'AttachmentImage not found — the check cannot see it');
    assert.match(body, /loading="lazy"/);
  });

  void test('the img renderer asks isAttachmentUrl first, and otherwise draws the alt text', () => {
    const start = SOURCE.indexOf('  img: ({ src, alt }) =>');
    const end = SOURCE.indexOf('  table: ', start);
    const text = start === -1 || end === -1 ? '' : SOURCE.slice(start, end);
    assert.ok(text !== '', 'the img renderer was not found — the check cannot see it');
    assert.match(
      text,
      /=>\s*typeof src === 'string' && isAttachmentUrl\(src, boardOrigin\(\)\) \?/,
    );
    assert.match(text, /<AttachmentImage /);
    assert.match(text, /md-img-alt/);
  });
});

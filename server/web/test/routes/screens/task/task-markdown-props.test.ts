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
    assert.match(SOURCE, /rehypePlugins=\{singleHardBreaks \? SINGLE_HARD_BREAKS : undefined\}/);
  });
});

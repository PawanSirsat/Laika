/**
 * The markdown bridge (LAI-827): what opens in the rich view, what opens as
 * Markdown, and what a save writes.
 *
 * These run in Node against the real `@tiptap/markdown` — the parser and the
 * writer the editor uses — so a version bump that changes how a document
 * round-trips fails here, in milliseconds, before a browser test has to find
 * it. What Node cannot do is parse HTML (the library treats it as text without
 * a DOM), so raw HTML in a document is the browser test's to prove.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MARKDOWN_EXTENSIONS } from '../../../../../src/routes/screens/task/editor/extensions.ts';
import {
  createBridge,
  escapeFaithfully,
  hookPresent,
  normaliseMarkdown,
  openDocument,
  parseMarkdown,
  toMarkdown,
} from '../../../../../src/routes/screens/task/editor/markdown-bridge.ts';

const bridge = createBridge(MARKDOWN_EXTENSIONS);

/** Opens rich, and an untouched save writes it back exactly. */
function roundTrips(markdown: string): string {
  const opening = openDocument(bridge, markdown);
  assert.equal(opening.kind, 'rich', `did not open rich: ${JSON.stringify(markdown)}`);
  return opening.kind === 'rich' ? opening.markdown : '';
}

void describe('the private hook the faithful writer needs', () => {
  void test('is still there in the pinned @tiptap/markdown', () => {
    // If this fails, the bridge has silently fallen back to the library's
    // escaping: correct, and every document with `next_cursor` opens as source.
    assert.equal(hookPresent(bridge), true);
  });
});

void describe('what an agent writes opens in the rich view and comes back as written', () => {
  const exact = [
    'Plain words.',
    'One\n\nTwo',
    'a **b** c and *d* and ~~e~~ and `f`',
    '## Heading\n\nText',
    '- one\n- two',
    '1. one\n2. two',
    '- [ ] open\n- [x] done',
    '- one\n  - inner\n- two',
    '> quoted',
    '```ts\nconst a = 1;\n```',
    // Blank lines inside code are code, and are kept.
    '```\nfirst\n\n\nafter two blank lines\n```',
    'see [the repo](https://example.com/repo)',
    'see [LC-3](/board?project=laika-core&task=t3)',
    'a\n\n---\n\nb',
    // What the library's own escaping rewrote (LAI-827, measured on 3.32.0).
    'set next_cursor and trip_id',
    'A -> B -> C and p95 < 1 s',
    'R&D and Q&A',
    '2 * 3 = 6',
    'waits ~9 s on a cold cache, ~2 s warm',
    'status [WIP] here',
    'C:\\Users\\ada',
    'use Map<string, number> here',
    'issue #42 is open, costs $5, a | b',
    // Bare addresses stay bare.
    'see https://example.com/a_b/c for more',
    'go to www.example.com now',
    'mail ada@example.com please',
    'thanks @ada and LAI-123',
  ];
  for (const markdown of exact) {
    void test(JSON.stringify(markdown), () => {
      assert.equal(roundTrips(markdown), markdown);
    });
  }

  void test('a table opens rich in either style, and is written padded', () => {
    const compact = '| A | B |\n|---|---|\n| 1 | 2 |';
    const padded = '| A   | B   |\n| --- | --- |\n| 1   | 2   |';
    assert.equal(roundTrips(compact), padded);
    assert.equal(roundTrips(padded), padded);
    assert.equal(roundTrips('| A | B |\n|:--|--:|\n| 1 | 2 |').split('\n')[1], '| :--- | ---: |');
    // One blank line before it, where the library writes two.
    assert.equal(roundTrips(`Before.\n\n${padded}`), `Before.\n\n${padded}`);
  });

  void test('a long agent document like ONR-516', () => {
    const onr = [
      '## Context',
      '',
      'The console loads **every trip of the day** before it draws, so a depot waits ~9 s.',
      '',
      '| Surface | Endpoint | p50 |',
      '|---|---|---|',
      '| Trip list | `GET /v2/trips` | 2.4 s |',
      '',
      '1. Add `cursor` and `limit`, ordered by `(scheduled_at, id)`',
      '2. Keep the map on the socket',
      '',
      '```ts',
      'const page = await trips.list({ date, cursor, limit: 200 });',
      '```',
      '',
      '> Agreed with the depot leads: a filter change resets to the first page.',
      '',
      '- [x] measure the cold-cache load',
      '- [ ] cursor pages behind a flag',
    ].join('\n');
    assert.equal(normaliseMarkdown(roundTrips(onr)), normaliseMarkdown(onr));
  });

  void test('an empty document opens rich and writes nothing', () => {
    assert.equal(roundTrips(''), '');
  });
});

void describe('what the editor would rewrite opens as Markdown, and says why', () => {
  const rewritten: readonly [string, RegExp][] = [
    ['* one\n* two', /line 1/],
    ['+ one\n+ two', /line 1/],
    ['a _b_ c', /line 1/],
    ['__bold__', /line 1/],
    ['- one\n\n- two', /line/],
    ['Title\n=====', /line 1/],
    ['1) one\n2) two', /line 1/],
    ['see <https://example.com/x>', /line 1/],
    ['a \\* b', /line 1/],
    ['a &amp; b', /line 1/],
    ['![a diagram](https://example.com/pixel.png)', /image/],
  ];
  for (const [markdown, why] of rewritten) {
    void test(JSON.stringify(markdown), () => {
      const opening = openDocument(bridge, markdown);
      assert.equal(opening.kind, 'source');
      assert.match(opening.kind === 'source' ? opening.reason : '', why);
    });
  }
});

void describe('the stated normalisation forgives layout and nothing else', () => {
  void test('line endings, trailing spaces, blank-line runs, table padding', () => {
    assert.equal(normaliseMarkdown('a\r\nb  \n\n\n\nc\n\n'), 'a\nb\n\nc');
    assert.equal(
      normaliseMarkdown('| A   | B |\n| :---- | --: |'),
      normaliseMarkdown('|A|B|\n|:--|-:|'),
    );
  });

  void test('not a different bullet, emphasis or list shape', () => {
    assert.notEqual(normaliseMarkdown('* a'), normaliseMarkdown('- a'));
    assert.notEqual(normaliseMarkdown('_a_'), normaliseMarkdown('*a*'));
    assert.notEqual(normaliseMarkdown('- a\n\n- b'), normaliseMarkdown('- a\n- b'));
  });
});

void describe('the faithful escaper', () => {
  void test('leaves what cannot be read as markdown alone', () => {
    for (const text of ['next_cursor', '2 * 3', '~9 s', '[WIP]', 'p95 < 1 s', 'R&D', 'C:\\x']) {
      assert.equal(escapeFaithfully(text), text);
    }
  });

  void test('escapes what could be', () => {
    assert.equal(escapeFaithfully('*not bold*'), '\\*not bold\\*');
    assert.equal(escapeFaithfully('_not italic_'), '\\_not italic\\_');
    assert.equal(escapeFaithfully('~~not struck~~'), '\\~\\~not struck\\~\\~');
    assert.equal(escapeFaithfully('a `tick'), 'a \\`tick');
    assert.equal(escapeFaithfully('[a](b)'), '\\[a\\](b)');
    assert.equal(escapeFaithfully('* item'), '\\* item');
    assert.equal(escapeFaithfully('end\\'), 'end\\\\');
  });

  void test('text typed to look like markdown is written so it reads back as text', () => {
    for (const text of [
      '**not bold**',
      '[a](b)',
      '`code`',
      '~~x~~',
      '* not a list',
      // Block markers at a line's start: written as typed they would come back
      // as a heading, a list, a quote or a rule.
      '# not a heading',
      '- not a list',
      '+ not a list',
      '1. not a list',
      '2) not a list',
      '> not a quote',
      'first line\n- second line',
      'first line\n---',
      'first line\n===',
    ]) {
      const doc = bridge.schema.nodeFromJSON({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      });
      const written = toMarkdown(bridge, doc);
      assert.ok(parseMarkdown(bridge, written, bridge.schema)?.eq(doc), `${text} → ${written}`);
    }
  });

  void test('an empty paragraph at the end does not cost the faithful form', () => {
    const doc = bridge.schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'set next_cursor' }] },
        { type: 'paragraph' },
      ],
    });
    assert.equal(toMarkdown(bridge, doc), 'set next_cursor');
  });
});

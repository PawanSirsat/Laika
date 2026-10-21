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
import type { JSONContent } from '@tiptap/core';
import { MARKDOWN_EXTENSIONS } from '../../../../../src/routes/screens/task/editor/extensions.ts';
import {
  createBridge,
  escapeFaithfully,
  hookPresent,
  normaliseMarkdown,
  openDocument,
  parseMarkdown,
  readsBackAs,
  sameMarkdown,
  toMarkdown,
  UnwritableMarkdown,
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

/*
 * Review round 1 (LAI-827): a save from the rich view must leave every block
 * nobody touched byte-identical to its source, whatever is typed elsewhere.
 * The reviewer measured the opposite: one paragraph the faithful form could not
 * write sent the whole document through the library's escaping, rewriting
 * `next_cursor`, `p95 < 1 s` and `A -> B` — and `\# literal hash` came back a
 * heading.
 */
const BASE = [
  'Set next_cursor; see https://example.com/a_b.',
  '',
  'p95 < 1 s, A -> B.',
  '',
  '\\# literal hash',
].join('\n');

const text = (value: string, marks?: { type: string }[]) =>
  marks === undefined ? { type: 'text', text: value } : { type: 'text', text: value, marks };

/** Open `source`, add `added` paragraphs after it, and save. */
function saveWith(source: string, ...added: JSONContent[][]): string {
  const opening = openDocument(bridge, source);
  assert.equal(opening.kind, 'rich', 'positive control: the document opens rich');
  if (opening.kind !== 'rich') return '';
  const doc = bridge.schema.nodeFromJSON({
    type: 'doc',
    content: [
      ...(opening.content.content ?? []),
      ...added.map((inline) => ({ type: 'paragraph', content: inline })),
    ],
  });
  const written = toMarkdown(bridge, doc, opening);
  // Whatever was written reads back as the document in the editor.
  assert.ok(readsBackAs(bridge, written, doc), `does not read back: ${written}`);
  return written;
}

void describe('untouched blocks are written byte-identical (review round 1)', () => {
  const typed: readonly [string, JSONContent[], string][] = [
    ['an HTML tag', [text('the <br> tag')], 'the \\<br> tag'],
    ['a void element', [text('an <input> field')], 'an \\<input> field'],
    ['an element name', [text('use <details> here')], 'use \\<details> here'],
    ['a comment', [text('note <!-- this -->')], 'note \\<!-- this -->'],
    ['an entity', [text('use &amp; here')], 'use \\&amp; here'],
    ['a reference definition', [text('[a]: https://x')], '\\[a]: https\\://x'],
    [
      'a star beside a bold word',
      [text('a *'), text('bold', [{ type: 'bold' }]), text(' word')],
      'a \\***bold** word',
    ],
  ];
  for (const [what, inline, expected] of typed) {
    void test(`${what}: the new paragraph is escaped, and the rest is as it was`, () => {
      assert.equal(saveWith(BASE, inline), `${BASE}\n\n${expected}`);
    });
  }

  void test('a block keeps its own layout: a compact table is not re-padded', () => {
    const compact = 'Before.\n\n|a|b|\n|-|-|\n|1|2|';
    assert.equal(saveWith(compact, [text('After.')]), `${compact}\n\nAfter.`);
  });

  void test('removing a block leaves its neighbours as they were', () => {
    const opening = openDocument(bridge, BASE);
    assert.equal(opening.kind, 'rich');
    if (opening.kind !== 'rich') return;
    const [first, , third] = opening.content.content ?? [];
    const doc = bridge.schema.nodeFromJSON({ type: 'doc', content: [first, third] });
    assert.equal(
      toMarkdown(bridge, doc, opening),
      'Set next_cursor; see https://example.com/a_b.\n\n\\# literal hash',
    );
  });

  void test('a block neither form can write back is not saved: the reason, and a draft that keeps the rest', () => {
    const opening = openDocument(bridge, BASE);
    assert.equal(opening.kind, 'rich');
    if (opening.kind !== 'rich') return;
    // Four leading spaces read back as a code block, written either way.
    const doc = bridge.schema.nodeFromJSON({
      type: 'doc',
      content: [
        ...(opening.content.content ?? []),
        { type: 'paragraph', content: [text('    indented')] },
      ],
    });
    assert.throws(
      () => toMarkdown(bridge, doc, opening),
      (error: unknown) =>
        error instanceof UnwritableMarkdown &&
        error.message.includes('indented') &&
        error.draft.startsWith(`${BASE}\n\n`),
    );
  });
});

void describe('a fence inside code is code (review round 1)', () => {
  void test('a ```js line inside a ``` block is not its close, and blank lines in code stay', () => {
    const source = '```\na\n```js\n\n\nb\n```';
    assert.equal(roundTrips(source), source);
  });

  void test('blank lines and trailing spaces inside code are not forgiven by the normalisation', () => {
    assert.notEqual(normaliseMarkdown('```\na\n\n\nb\n```'), normaliseMarkdown('```\na\n\nb\n```'));
    assert.notEqual(normaliseMarkdown('```\na  \n```'), normaliseMarkdown('```\na\n```'));
  });
});

void describe('what markdown cannot hold does not count as a change (review round 1)', () => {
  void test('a trailing space — a mention leaves one — is no reason to refuse, and no edit', () => {
    assert.equal(
      saveWith(BASE, [text('Ask @Mallory <b>Root</b> ')]),
      `${BASE}\n\nAsk @Mallory \\<b>Root\\</b>`,
    );
  });

  void test('a paragraph of spaces is empty, as Enter twice is', () => {
    assert.equal(saveWith(BASE, [text('   ')]), BASE);
  });
});

/*
 * LAI-849: an agent-written description that rendered correctly opened as
 * Markdown, saying the editor "would rewrite line 7: '- …' as ''". Line 7 was
 * the first item of a list written directly under a paragraph — legal
 * CommonMark — and the editor writes a blank line before every block. The
 * check compared the texts line by line by position, so that one added blank
 * line shifted every line after it. The text below is made up (the repo is
 * public); its shape is the owner's: lines of `Key: value`, then a paragraph
 * opening in bold, with code in it, and a list right under its last line.
 */
const AGENT = [
  'Owner: Ada Lovelace',
  'Source: a question at the desk on Monday: "can a late book skip the queue?"',
  'Decision: "Shelve on return + scan".',
  '',
  '**Found (desk log):** the loan closes at `checkout.close` when the reader leaves, and `returns.scan` never runs.',
  'What should happen:',
  '- A book handed in after hours waits on the returns trolley.',
  '- The morning scan shelves it and closes the loan.',
].join('\n');

void describe('a list directly under a paragraph opens in the rich view (LAI-849)', () => {
  void test('the shape the owner hit opens rich, and an untouched save is the text as stored', () => {
    const opening = openDocument(bridge, AGENT);
    assert.equal(
      opening.kind,
      'rich',
      `opened as Markdown: ${opening.kind === 'source' ? opening.reason : ''}`,
    );
    if (opening.kind !== 'rich') return;
    const doc = bridge.schema.nodeFromJSON(opening.content);
    // Untouched, every block is copied from the source: byte for byte, no
    // blank line added above the list.
    assert.equal(toMarkdown(bridge, doc, opening), AGENT);
  });

  void test('an edit elsewhere leaves the paragraph and its list as they were', () => {
    const opening = openDocument(bridge, AGENT);
    assert.equal(opening.kind, 'rich', 'positive control: the document opens rich');
    if (opening.kind !== 'rich') return;
    const [, ...rest] = opening.content.content ?? [];
    const doc = bridge.schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [text('Owner: Grace Hopper')] }, ...rest],
    });
    const [, ...after] = AGENT.split('\n\n');
    assert.equal(toMarkdown(bridge, doc, opening), ['Owner: Grace Hopper', ...after].join('\n\n'));
  });

  // Blocks written directly under a paragraph, or a paragraph under a
  // heading: each opens rich.
  const underParagraph = [
    'Steps:\n- one\n- two',
    'Steps:\n1. one\n2. two',
    'Steps:\n- [ ] one\n- [x] two',
    'Said:\n> a quote',
    'Then:\n## A heading',
    'Run:\n```sh\npnpm test\n```',
    'Numbers:\n| A | B |\n| --- | --- |\n| 1 | 2 |',
    '## A heading\nText right under it.',
    '> a quote\n- then a list',
  ];
  for (const markdown of underParagraph) {
    void test(`only a blank line between blocks differs: ${JSON.stringify(markdown)}`, () => {
      const opening = openDocument(bridge, markdown);
      assert.equal(
        opening.kind,
        'rich',
        `opened as Markdown: ${opening.kind === 'source' ? opening.reason : ''}`,
      );
    });
  }
});

void describe('a change to any non-blank text is still refused (LAI-849)', () => {
  // The same shape, each with one thing the editor would rewrite.
  const refused: readonly [string, string][] = [
    [
      'a star bullet',
      AGENT.replace('- A book', '* A book').replace('- The morning', '* The morning'),
    ],
    ['an underscore emphasis', `${AGENT}\n\nThe _old_ way.`],
    ['a setext heading', `${AGENT}\n\nTitle\n=====`],
    ['a loose list made tight', AGENT.replace('\n- The morning', '\n\n- The morning')],
  ];
  for (const [what, markdown] of refused) {
    void test(what, () => {
      assert.equal(openDocument(bridge, markdown).kind, 'source');
    });
  }

  /*
   * Review round 1: a line of U+00A0 or U+3000 alone is no blank line in
   * CommonMark, which counts only spaces and tabs, and the reading view
   * (micromark) shows it as text. Between two paragraphs it is a paragraph of
   * its own, which an edit to `A` dropped; under a list item it continues the
   * item lazily, as `B` does, and an edit to the item moved the untouched `B`
   * out of the list. Master refuses both. The same text with a space instead
   * opens rich, so the white space is what each test is about.
   */
  for (const [name, ws] of [
    ['U+00A0', ' '],
    ['U+3000', '　'],
  ] as const) {
    void test(`a ${name} line between two paragraphs`, () => {
      assert.equal(openDocument(bridge, 'A\n\n \n\nB').kind, 'rich', 'positive control');
      assert.equal(openDocument(bridge, `A\n\n${ws}\n\nB`).kind, 'source');
    });

    void test(`a ${name} line in a list item under a paragraph`, () => {
      assert.equal(openDocument(bridge, 'Intro:\n- a\n \nB').kind, 'rich', 'positive control');
      assert.equal(openDocument(bridge, `Intro:\n- a\n${ws}\nB`).kind, 'source');
    });
  }
});

void describe('the reason names the real difference, not a shifted line (LAI-849)', () => {
  const reason = (markdown: string): string => {
    const opening = openDocument(bridge, markdown);
    assert.equal(opening.kind, 'source', 'positive control: the document opens as Markdown');
    return opening.kind === 'source' ? opening.reason : '';
  };

  void test('a forgiven blank line above a list is not the line named', () => {
    assert.equal(
      reason(`${AGENT}\n\nThe _old_ way.`),
      'The rich editor would rewrite line 10: “The _old_ way.” as “The *old* way.”.',
    );
  });

  void test('a blank line it would remove is named as that, with the line after it', () => {
    assert.equal(
      reason('- one\n\n- two'),
      'The rich editor would remove the blank line before line 3: “- two”.',
    );
  });

  void test('line numbers are the source’s, as the Markdown view shows it', () => {
    // Three blank lines, which the normalisation counts as one.
    assert.match(reason('Intro.\n\n\n\n* one\n* two'), /^The rich editor would rewrite line 5: /);
  });

  void test('text that would be lost is named as lost', () => {
    assert.equal(
      reason('Text.\n\n[a]: https://example.com'),
      'The rich editor would drop line 3: “[a]: https://example.com”.',
    );
  });

  void test('a line it would add is named, with where', () => {
    assert.equal(reason('> para\n> - x'), 'The rich editor would add “>” before line 2: “> - x”.');
  });

  /*
   * Review round 1: when a block is lost the texts split into different
   * numbers of blocks, and the notice diffs the whole text. A blank line
   * matched as well as a line of words there, so the blank line the editor
   * adds above a list was kept and the list item named as dropped. Each of
   * these keeps line 2 and loses line 4.
   */
  void test('a lost definition is named, not the list item above it', () => {
    assert.equal(
      reason('Steps:\n1. a\n\n[ref]: /x\n\nMore.'),
      'The rich editor would drop line 4: “[ref]: /x”.',
    );
  });

  void test('a lost &nbsp; paragraph between a list and a paragraph is named', () => {
    assert.equal(
      reason('Intro:\n- a\n\n&nbsp;\n\nB'),
      'The rich editor would drop line 4: “&nbsp;”.',
    );
  });

  void test('a lost &nbsp; paragraph at the end is named', () => {
    assert.equal(reason('A\n- b\n\n&nbsp;'), 'The rich editor would drop line 4: “&nbsp;”.');
  });

  void test('a long line is shown where it changes, not cut off where it agrees', () => {
    const long =
      '- A book returned after closing stays on the trolley, its card reading &lt;branch&gt; until scanned.';
    assert.equal(
      reason(`Steps:\n${long}`),
      'The rich editor would rewrite line 2: “…trolley, its card reading &lt;branch&gt; until scanned.” as “…trolley, its card reading \\<branch> until scanned.”.',
    );
  });
});

/*
 * LAI-854: two layouts whose notice was "The rich editor would not write it
 * back exactly", naming no line.
 *
 * Two blank lines between list items: the parser read them as an empty
 * paragraph inside the first item, which nothing can write, and the draft it
 * fell back to equalled the source once blank lines were collapsed.
 *
 * A list item under a paragraph, then a line of U+00A0 or U+3000 and a
 * paragraph: CommonMark, and so the reading view, continues the item lazily
 * through `B`; the lexer ends the list at that line, so the editor would write
 * `B` as a paragraph of its own. The blocks it diffs differ only by blank lines.
 */
void describe('a notice that named nothing names the line (LAI-854)', () => {
  const reason = (markdown: string): string => {
    const opening = openDocument(bridge, markdown);
    assert.equal(opening.kind, 'source', `opened rich: ${JSON.stringify(markdown)}`);
    return opening.kind === 'source' ? opening.reason : '';
  };

  void test('two blank lines between list items are read as no paragraph at all', () => {
    const doc = parseMarkdown(bridge, '- a\n\n\n- b', bridge.schema);
    const json = doc?.toJSON() as JSONContent | undefined;
    assert.deepEqual(json?.content?.[0]?.content?.[0]?.content, [
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
    ]);
  });

  void test('two blank lines between list items: the notice names them and the item after', () => {
    assert.equal(
      reason('- a\n\n\n- b'),
      'The rich editor would remove the 2 blank lines before line 4: “- b”.',
    );
    assert.equal(
      reason('- a\n\n\n- b\n- c'),
      'The rich editor would remove the 2 blank lines before line 4: “- b”.',
    );
  });

  for (const [name, ws] of [
    ['U+00A0', ' '],
    ['U+3000', '　'],
  ] as const) {
    void test(`a ${name} line under a list item: the notice says what happens to “B”`, () => {
      assert.equal(openDocument(bridge, 'Intro:\n- a\n \nB').kind, 'rich', 'positive control');
      assert.equal(
        reason(`Intro:\n- a\n${ws}\nB`),
        'The rich editor would make line 4, “B”, a paragraph of its own instead of part of the list item above it.',
      );
    });

    void test(`after a blank line, a ${name} line does not continue the item, and is not said to`, () => {
      // CommonMark ends the item at the blank line: `B` is a paragraph already.
      assert.doesNotMatch(reason(`Intro:\n- a\n\n${ws}\nB`), /instead of part of/);
    });
  }
});

/*
 * The owner's whole description, in shape: after the blank line above its
 * list, the list's first and last items spell `<` and `>` as `&lt;` and
 * `&gt;`, the first past its 57th character. The editor writes `\<…>` there — the same text read, a different
 * text stored — which LAI-827 refuses (`a &amp; b`). On master the notice named
 * the shifted blank line; clipped at 57 characters, the real change was out of
 * sight either way.
 */
const ENTITIES = [
  'Owner: Ada Lovelace',
  'Source: a question at the desk on Monday: "can a late book skip the queue?"',
  '',
  '**Found (desk log):** the loan closes at `checkout.close` when the reader leaves, and `returns.scan` never runs.',
  '',
  'What should happen:',
  '- A book returned after closing stays on the trolley overnight, its card reading "Shelve at &lt;branch&gt;" until a `scan` clears it.',
  '- The morning scan shelves it and closes the loan.',
  '- A reader who asks for it that night is told it is on the trolley.',
  '- The desk log records who scanned it.',
  '- Nothing is fined while it waits.',
  '- A book still on the trolley at noon is flagged at &lt;branch&gt;.',
].join('\n');

void describe('what the editor cannot keep is still refused, and named (LAI-849)', () => {
  void test('an entity in a list under a paragraph: refused, and the notice shows the entity', () => {
    const opening = openDocument(bridge, ENTITIES);
    assert.equal(opening.kind, 'source');
    assert.equal(
      opening.kind === 'source' ? opening.reason : '',
      'The rich editor would rewrite line 7: “…reading "Shelve at &lt;branch&gt;" until a `scan` clears…” as “…reading "Shelve at \\<branch>" until a `scan` clears…”.',
    );
  });
});

void describe('the round-trip check forgives blank lines between blocks and nothing else (LAI-849)', () => {
  const same = (a: string, b: string): boolean => sameMarkdown(bridge, a, b);

  void test('a blank line between two blocks, added or taken away', () => {
    assert.equal(same('Steps:\n- one', 'Steps:\n\n- one'), true);
    assert.equal(same('Steps:\n\n- one', 'Steps:\n- one'), true);
    assert.equal(same(AGENT, AGENT.replace('happen:\n-', 'happen:\n\n-')), true);
  });

  void test('a word changed, a line dropped, a marker changed, two blocks swapped', () => {
    assert.equal(same('Steps:\n- one', 'Steps:\n\n- two'), false);
    assert.equal(same('Steps:\n- one\n- two', 'Steps:\n\n- one'), false);
    assert.equal(same('Steps:\n- one', 'Steps:\n\n* one'), false);
    assert.equal(same('First.\n\nSecond.', 'Second.\n\nFirst.'), false);
  });

  void test('a blank line inside a block still counts', () => {
    // A loose list against a tight one, code, and one paragraph against two.
    assert.equal(same('- one\n\n- two', '- one\n- two'), false);
    assert.equal(same('```\na\n\nb\n```', '```\na\nb\n```'), false);
    assert.equal(same('a\nb', 'a\n\nb'), false);
  });
});

void describe('the whole is checked, not only each block (review round 1)', () => {
  void test('two lists side by side read back as one: refused, not saved', () => {
    const opening = openDocument(bridge, '- one\n- two');
    assert.equal(opening.kind, 'rich');
    if (opening.kind !== 'rich') return;
    const item = (words: string) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [text(words)] }],
    });
    // Each list reads back alone; written one after the other they merge.
    const doc = bridge.schema.nodeFromJSON({
      type: 'doc',
      content: [
        ...(opening.content.content ?? []),
        { type: 'bulletList', content: [item('three')] },
      ],
    });
    assert.throws(
      () => toMarkdown(bridge, doc, opening),
      (error: unknown) =>
        error instanceof UnwritableMarkdown && error.draft.startsWith('- one\n- two\n\n'),
    );
  });
});

/*
 * LAI-853: a list item written over two lines, the second indented under the
 * first — how agents and this repo's task files hard-wrap — opened as
 * Markdown. The editor writes the continuation flush left, which CommonMark
 * reads as the same paragraph (a lazy continuation), and the round-trip check
 * forgave no white space inside a block. An ordered item also came back with
 * a space the reader never sees: the lexer left one of the three.
 */
void describe('a list item wrapped onto an indented second line opens rich (LAI-853)', () => {
  const wrapped = [
    '- a long item that\n  wraps onto a second line',
    '1. a step that\n   wraps',
    '- a\n- b that\n  wraps\n  twice\n- c',
    '10. a step that\n    wraps',
    'Steps:\n- a long item that\n  wraps onto a second line',
  ];
  for (const markdown of wrapped) {
    void test(`opens rich, and an untouched save is the text as stored: ${JSON.stringify(markdown)}`, () => {
      const opening = openDocument(bridge, markdown);
      assert.equal(
        opening.kind,
        'rich',
        `opened as Markdown: ${opening.kind === 'source' ? opening.reason : ''}`,
      );
      if (opening.kind !== 'rich') return;
      const doc = bridge.schema.nodeFromJSON(opening.content);
      assert.equal(toMarkdown(bridge, doc, opening), markdown);
    });
  }

  void test('the wrapped line is one paragraph, as the reader shows it: no stray space', () => {
    const opening = openDocument(bridge, '1. a step that\n   wraps');
    assert.equal(opening.kind, 'rich');
    if (opening.kind !== 'rich') return;
    const item = opening.content.content?.[0]?.content?.[0];
    assert.deepEqual(item?.content, [
      { type: 'paragraph', content: [{ type: 'text', text: 'a step that\nwraps' }] },
    ]);
  });

  for (const list of [
    '- a long item that\n  wraps onto a second line',
    '1. a step that\n   wraps',
  ]) {
    void test(`an edit to the paragraph above leaves the wrapped item as written: ${JSON.stringify(list)}`, () => {
      const opening = openDocument(bridge, `Steps:\n\n${list}`);
      assert.equal(opening.kind, 'rich', 'positive control: the document opens rich');
      if (opening.kind !== 'rich') return;
      const [, ...rest] = opening.content.content ?? [];
      const doc = bridge.schema.nodeFromJSON({
        type: 'doc',
        content: [{ type: 'paragraph', content: [text('Steps, edited:')] }, ...rest],
      });
      assert.equal(toMarkdown(bridge, doc, opening), `Steps, edited:\n\n${list}`);
    });
  }

  /*
   * TipTap's task-list tokenizer takes only an item's first line as its text
   * and reads the lines under it as blocks of their own: a code block at six
   * spaces, a second paragraph at two. CommonMark, and so the reading view,
   * reads one paragraph. The editor would show something the board does not,
   * so it stays Markdown (see LAI-853's Result).
   */
  void test('a wrapped task-list item stays Markdown', () => {
    for (const markdown of [
      '- [ ] a criterion that\n      wraps like a task file',
      '- [ ] a criterion that\n  wraps',
    ]) {
      assert.equal(openDocument(bridge, markdown).kind, 'source', JSON.stringify(markdown));
    }
  });
});

void describe('only a wrapped line’s indentation is forgiven (LAI-853)', () => {
  const same = (a: string, b: string): boolean => sameMarkdown(bridge, a, b);

  void test('positive control: the continuation’s indentation, and no more', () => {
    assert.equal(same('- a long item that\n  wraps', '- a long item that\nwraps'), true);
    assert.equal(same('1. a step that\n   wraps', '1. a step that\nwraps'), true);
  });

  void test('a changed character on the wrapped line is still a change', () => {
    assert.equal(same('- a long item that\n  wraps', '- a long item that\nwrapz'), false);
    assert.equal(same('- a long item that\n  wraps', '- a long item that\n\\  wraps'), false);
  });

  void test('a rewrite on the wrapped line still opens as Markdown, and names it', () => {
    const opening = openDocument(bridge, '- a long item that\n  wraps _here_');
    assert.equal(opening.kind, 'source');
    assert.match(opening.kind === 'source' ? opening.reason : '', /line 2/);
  });

  void test('a list marker’s indentation is structure, not a wrapped line', () => {
    // CommonMark: under `1. ` two spaces are too few to nest, so `- b` starts
    // a list of its own; TipTap nests it.
    assert.equal(same('1. a\n  - b', '1. a\n   - b'), false);
    assert.equal(openDocument(bridge, '1. a\n  - b').kind, 'source');
  });

  void test('after a blank line or a heading, indentation is not a wrapped line', () => {
    assert.equal(same('- a\n\n para', '- a\n\npara'), false);
    assert.equal(same('# Title\n  text', '# Title\ntext'), false);
  });
});

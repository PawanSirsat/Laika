/**
 * The whole task card opens the task (LAI-424).
 *
 * The owner's words were *"im not able to click on the task"*. Measured in a
 * browser before the fix: the only interactive element inside a card was
 * `button.card-key`, covering **545px² of the card's 15,062px² — 3.6%**. The
 * title did nothing. The card did nothing. A ~50px monospace key that reads as
 * a label was the entire hit area for the most-used interaction on the board.
 *
 * ## Why this checks CSS rather than clicking
 *
 * `node --test` cannot import a `.tsx`, so no test in this suite renders a
 * component, let alone clicks one. The honest automated guard is therefore the
 * **mechanism**: one control, stretched to cover the card, with the card
 * positioned so it has something to stretch against. The click itself is
 * verified in a real browser and recorded on the task — and a harness that
 * could click is filed as LAI-227 rather than left implied.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

const read = (rel: string): Promise<string> => readFile(new URL(rel, import.meta.url), 'utf8');

const CARD_TSX = '../../../../src/routes/screens/board/TaskCard.tsx';
const BOARD_CSS = '../../../../src/routes/screens/board/board.css';

/**
 * The **declarations** of one CSS rule, by selector — comments stripped.
 *
 * Stripping is not tidiness. The `.card` rule carries a comment explaining that
 * "the design file uses `cursor:pointer` 46 times", and without this the cursor
 * assertion matched *that sentence* and stayed green when the declaration was
 * mutated back to `grab`. A test satisfied by its own explanation is not a test;
 * this was caught by mutating and noticing the red never came.
 */
function ruleFor(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `no rule for \`${selector}\` — this test can no longer check anything`);
  return css.slice(at, css.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
}

void describe('the hit area is the card, not the key', () => {
  void test('the open control stretches over the whole card', () => {
    // The mechanism. Without this the control is whatever size its text is,
    // which is what 3.6% meant.
    return read(BOARD_CSS).then((css) => {
      const overlay = ruleFor(css, '.card-open::after');
      assert.match(overlay, /position:\s*absolute/, 'the overlay is not positioned');
      assert.match(overlay, /inset:\s*0/, 'the overlay does not cover the card');
      assert.match(overlay, /content:/, 'a pseudo-element without content never renders');
    });
  });

  void test('the card is positioned, or the overlay escapes it', () => {
    // `inset: 0` resolves against the nearest positioned ancestor. With the
    // card `static` — which it was — the overlay would size itself to the
    // column or the page instead, and swallow the whole board.
    return read(BOARD_CSS).then((css) => {
      assert.match(ruleFor(css, '.card'), /position:\s*relative/, '.card is not positioned');
    });
  });

  void test('the card looks interactive, in a cursor the design actually uses', () => {
    // The design file uses `cursor:pointer` 46 times and `grab` never; `grab`
    // was ours. A card that opens on click should say so.
    return read(BOARD_CSS).then((css) => {
      assert.match(
        ruleFor(css, '.card'),
        /cursor:\s*pointer/,
        'the card does not read as clickable',
      );
    });
  });

  void test('the key is not itself positioned, or the overlay shrinks to it', () => {
    // The mistake this caught: `.card-key { position: relative }` makes the key
    // the containing block for its own `::after`, so `inset: 0` sizes the
    // overlay to the key — restoring the 3.6% hit area while every rule this
    // file checks still passes. Geometry, not declarations.
    return read(BOARD_CSS).then((css) => {
      assert.ok(
        !/position:\s*(relative|absolute|fixed|sticky)/.test(ruleFor(css, '.card-key')),
        '.card-key is positioned, so the overlay resolves against it and not the card',
      );
    });
  });

  void test('there is a hover state, not only a cursor', () => {
    return read(BOARD_CSS).then((css) => {
      assert.ok(css.includes('.card:hover'), 'no hover affordance on the card');
    });
  });
});

void describe('it stays one control', () => {
  void test('exactly one element opens the task', async () => {
    // Not two. The failure mode of "make the card clickable" is a second
    // handler on the article, which gives assistive tech two ways in and
    // fires twice for anyone using both.
    const tsx = await read(CARD_TSX);
    const opens = tsx.match(/onOpen\(task\.id\)/g) ?? [];
    assert.equal(opens.length, 1, `onOpen is called from ${String(opens.length)} places`);
  });

  void test('no click handler is put on the article or a div', async () => {
    const tsx = await read(CARD_TSX);
    assert.ok(!/<article[^>]*onClick/s.test(tsx), 'a click handler was put on the article');
    assert.ok(!/<div[^>]*onClick/s.test(tsx), 'a click handler was put on a div');
  });

  void test('the accessible name survives', async () => {
    // `"LAI-16 — open details"`. The key alone is not a name that says what
    // activating it does.
    const tsx = await read(CARD_TSX);
    assert.ok(tsx.includes('open details'), 'the open control lost its accessible name');
  });

  void test('it is a real button, so Tab and Enter/Space work unaided', async () => {
    const tsx = await read(CARD_TSX);
    assert.match(
      tsx,
      /<button\s[^>]*className="card-key card-open"/s,
      'the open control is not a button',
    );
  });
});

void describe('the card’s tooltips are not swallowed by the overlay', () => {
  void test('elements carrying a title sit above it', async () => {
    // The avatar, the unassigned `+` and the blocker are not controls — they
    // are display with `title` tooltips. An overlay above them would block the
    // hover that shows the tooltip, quietly removing information.
    const css = await read(BOARD_CSS);
    assert.ok(css.includes('.card-above'), 'nothing lifts the titled elements above the overlay');
    assert.match(ruleFor(css, '.card-above'), /z-index:\s*1/, 'the lift has no stacking order');
    assert.match(ruleFor(css, '.card-above'), /position:\s*relative/, 'z-index needs a position');
  });
});

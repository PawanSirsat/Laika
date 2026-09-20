/**
 * The loading primitives (LAI-293).
 *
 * `Spinner` and the new `LoadingState` shapes are checked at source, because
 * what matters about them is structural — the shapes a skeleton draws, and that
 * the spinner is decorative unless it is told otherwise.
 *
 * `useDelayed` has its own file, per CONVENTIONS §4's one-mirror-per-module
 * rule — and it earns one: it is the piece most easily written to look right
 * and only half work.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from '../helpers/code.ts';

let spinner = '';
let loading = '';
let css = '';
let board = '';
let button = '';

before(async () => {
  const read = async (rel: string) =>
    await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  spinner = code(await read('../../src/components/Spinner.tsx'));
  loading = code(await read('../../src/components/LoadingState.tsx'));
  button = code(await read('../../src/components/forms/Button.tsx'));
  css = await read('../../src/components/states.css');
  board = await read('../../src/routes/screens/board/board.css');
});

void describe('the spinner', () => {
  void test('is decorative unless given a label', () => {
    // The control around it already carries `aria-busy`. A spinner that also
    // announces itself is read twice.
    assert.match(spinner, /aria-hidden=\{label === undefined \? 'true' : undefined\}/);
    assert.match(spinner, /role=\{label === undefined \? undefined : 'status'\}/);
  });

  void test('inherits its colour instead of taking a variant', () => {
    // One component on a primary, danger and plain button. A `variant` prop
    // would be a second list to keep in step with `ButtonVariant`.
    assert.match(css, /\.spinner \{[^}]*border: 2px solid currentColor/s);
  });

  /**
   * `.skeleton` already stops animating under `prefers-reduced-motion`. Once
   * skeletons are still, a spinner is the only moving thing on the page.
   */
  void test('stops spinning under reduced motion, without disappearing', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{\s*\.spinner \{([^}]*)\}/s.exec(
      css,
    );
    assert.ok(reduced, 'the spinner ignores prefers-reduced-motion');
    assert.match(reduced[1] ?? '', /animation: none/);
    // Still visible: removing it would take the feedback away, not the motion.
    assert.doesNotMatch(reduced[1] ?? '', /display:\s*none/);
    // A gapped ring that is not turning reads as broken, so the gap closes.
    assert.match(reduced[1] ?? '', /border-top-color: currentColor/);
  });
});

void describe('skeletons mirror what they replace', () => {
  void test('the board shape draws lanes, not a stack of cards', () => {
    // The rule `LoadingState` states about itself, which the board was the one
    // place not to follow: it rendered `shape="card"` — a vertical list — where
    // the board is a grid.
    assert.match(loading, /function BoardSkeleton/);
    assert.match(css, /\.skeleton-board \{[^}]*display: grid/s);
    /*
     * Same track floor and gap as `.kanban` — **read out of `.kanban`**, not
     * written down here. The previous version asserted `gap: 0.6875rem` as a
     * literal under a comment claiming it matched the board, and the board's
     * gap is `0.75rem`. It passed for a month and measured 11px against the
     * real board's 12px on the running instance, which is a whole lane-width
     * of drift by the fourth column.
     */
    const rule = (sheet: string, selector: string): string => {
      const body = new RegExp(`\\${selector} \\{([^}]*)\\}`, 's').exec(sheet)?.[1];
      assert.ok(body !== undefined, `${selector} not found — this comparison is aimed at nothing`);
      return body;
    };
    const lane = rule(board, '.kanban');
    const skel = rule(css, '.skeleton-board');
    const grab = (body: string, prop: string): string => {
      const value = new RegExp(`(?:^|;|\\n)\\s*${prop}:\\s*([^;]+);`).exec(body)?.[1];
      assert.ok(value !== undefined, `no ${prop} in that rule`);
      return value.trim();
    };
    assert.equal(grab(skel, 'gap'), grab(lane, 'gap'));
    assert.equal(grab(skel, 'grid-auto-columns'), grab(lane, 'grid-auto-columns'));
  });

  void test('the live region and the shapes are separate elements', () => {
    /*
     * The inner wrapper repeated `.skeleton-list` — a flex column nested in an
     * identical flex column, so its `gap` applied twice. It showed up in the
     * DOM of the running board as `.skeleton-list > .skeleton-list`, which is
     * how it was found; nothing in the source reads as wrong.
     *
     * The outer element carries `role="status"` and the label; the inner one
     * carries the layout and is `aria-hidden`.
     */
    assert.match(loading, /className="skeleton-list" role="status"/);
    assert.match(loading, /aria-hidden="true" className="skeleton-body"/);
    assert.equal(
      (loading.match(/className="skeleton-list"/g) ?? []).length,
      1,
      'the wrapper class is applied more than once — its gap will apply twice',
    );
    assert.match(css, /\.skeleton-body \{/);
  });

  void test('the board skeleton takes its column count from the caller', () => {
    // Board columns are configuration (LAI-266). A hard-coded four replaced by
    // five real lanes is the same reflow, just narrower.
    assert.match(loading, /readonly columns\?: number/);
    assert.match(loading, /<BoardSkeleton columns=\{columns\}/);
  });

  void test('table and drawer shapes exist and are reachable', () => {
    assert.match(loading, /'card' \| 'row' \| 'board' \| 'table' \| 'drawer'/);
    for (const shape of ['TableSkeleton', 'DrawerSkeleton']) {
      assert.match(loading, new RegExp(`function ${shape}`));
      assert.match(loading, new RegExp(`<${shape} `));
    }
  });
});

void describe('the button', () => {
  void test('shows a spinner and does not swap the label by default', () => {
    // It resized mid-click: "Create task" is 11 characters and "Creating…" is
    // 9, so the button moved under the cursor that had just pressed it.
    assert.match(button, /\{busy && <Spinner size="sm" \/>\}/);
    // The label is rendered unconditionally — there is no `busy ?` branch left
    // around it, and no `busyLabel` prop for one to come back through.
    assert.match(button, /\{busy && <Spinner size="sm" \/>\}\s*\n\s*\{children\}/);
    assert.doesNotMatch(button, /busyLabel/, 'the retired prop is still reachable');
  });

  void test('still blocks activation and still says why', () => {
    assert.match(button, /disabled=\{disabled \|\| busy\}/);
    assert.match(button, /aria-busy=\{busy \|\| undefined\}/);
  });
});

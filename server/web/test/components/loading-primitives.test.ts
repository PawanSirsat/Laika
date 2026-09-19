/**
 * The loading primitives (LAI-295).
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
let button = '';

before(async () => {
  const read = async (rel: string) =>
    await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  spinner = code(await read('../../src/components/Spinner.tsx'));
  loading = code(await read('../../src/components/LoadingState.tsx'));
  button = code(await read('../../src/components/forms/Button.tsx'));
  css = await read('../../src/components/states.css');
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
    // Same track floor and gap as `.kanban`, or the lanes land in a different
    // place than the ones replacing them.
    assert.match(css, /\.skeleton-board \{[^}]*minmax\(12\.875rem, 1fr\)/s);
    assert.match(css, /\.skeleton-board \{[^}]*gap: 0\.6875rem/s);
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

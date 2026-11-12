/**
 * Structural guards for the LAI-1207 state kit. The behaviour — delays,
 * Clear filters, Retry, the stale banner keeping its rows, computed colours —
 * is driven in a real browser by `test/browser/state-kit.test.ts`; these pin
 * the properties a source scan can see and a later edit could quietly lose.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, test } from 'node:test';
import { code } from '../helpers/code.ts';

const COMPONENTS = new URL('../../src/components/', import.meta.url);
const read = async (name: string) => readFile(new URL(name, COMPONENTS), 'utf8');

let empty: string;
let error: string;
let stale: string;
let skeleton: string;
let busy: string;
let css: string;

before(async () => {
  empty = code(await read('EmptyPanel.tsx'));
  error = code(await read('ErrorPanel.tsx'));
  stale = code(await read('StaleBanner.tsx'));
  skeleton = code(await read('Skeleton.tsx'));
  busy = code(await read('InlineBusy.tsx'));
  css = await read('state-kit.css');
  assert.ok(css.length > 1000, 'state-kit.css looks empty — the reader is wrong');
});

/** The declarations of every rule whose selector mentions `needle`. */
function rulesFor(needle: string): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => (selector ?? '').includes(needle))
    .map(([, , body]) => body ?? '')
    .join('\n');
}

void describe('an empty state is never an error', () => {
  void test('it does not announce itself', () => {
    assert.ok(!empty.includes('role='), 'EmptyPanel carries a role — an empty list is not news');
  });

  void test('none of its rules uses the error or warning palette', () => {
    const rules = rulesFor('.empty-panel');
    assert.ok(rules.length > 200, 'found no .empty-panel rules — the scan is wrong');
    for (const token of ['--overdue', '--blocked-bg', '--chip-orange']) {
      assert.ok(!rules.includes(token), `.empty-panel uses ${token}`);
    }
  });

  void test('the filtered variant’s action is always worded Clear filters', () => {
    assert.match(empty, /label: 'Clear filters', onClick: onClearFilters/);
  });
});

void describe('an error is one', () => {
  void test('ErrorPanel is an alert; StaleBanner is a status, because the rows still work', () => {
    assert.ok(error.includes('role="alert"'));
    assert.ok(stale.includes('role="status"'));
    assert.ok(!stale.includes('role="alert"'));
  });

  void test('Retry keeps focus while it works and never swaps its label', () => {
    for (const [name, src] of [
      ['ErrorPanel', error],
      ['StaleBanner', stale],
    ] as const) {
      assert.ok(src.includes('aria-disabled={retrying'), `${name} retry is not aria-disabled`);
      assert.ok(!/[^-]disabled=\{/.test(src), `${name} uses disabled, which drops focus`);
      assert.ok(
        src.includes('if (!retrying) onRetry()'),
        `${name} retries twice on a double press`,
      );
    }
  });
});

void describe('loading holds its space and waits', () => {
  void test('skeletons wait 300ms by default', () => {
    assert.match(skeleton, /export const SKELETON_DELAY_MS = 300;/);
    assert.match(skeleton, /delayMs = SKELETON_DELAY_MS/);
    assert.match(busy, /delayMs = 300/);
  });

  void test('the region is busy and polite, the bars hidden from assistive tech', () => {
    assert.ok(skeleton.includes('aria-busy="true"'));
    assert.ok(skeleton.includes('aria-live="polite"'));
    assert.ok(skeleton.includes('aria-hidden="true"'));
  });

  void test('until drawn, the body keeps its space with visibility, not display', () => {
    assert.match(rulesFor(".skeleton-region[data-shown='false']"), /visibility:\s*hidden/);
  });

  void test('reduced motion stops every animation and transition the kit adds', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.ok(reduced.length > 50, 'no reduced-motion block');
    assert.match(reduced, /animation:\s*none/);
    assert.match(reduced, /transition:\s*none/);
    assert.match(reduced, /transform:\s*none/);
  });
});

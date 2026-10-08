/**
 * The custom dropdown's pure decisions (LAI-726): search, highlight, keyboard
 * movement, type-ahead and placement. The browser tests drive the same rules
 * through the real control; these pin the edges a browser run would only
 * reach by luck.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  filterOptions,
  highlight,
  move,
  noMatches,
  place,
  placeWithin,
  typeahead,
  type ModelOption,
} from '../../src/components/dropdown-model.ts';

const LABELS: ModelOption[] = [
  { value: '', label: 'Any', pinned: true },
  { value: 'ai', label: 'ai' },
  { value: 'ai-p1', label: 'ai-p1' },
  { value: 'backend', label: 'backend' },
  { value: 'bug', label: 'bug' },
  { value: 'eta', label: 'eta' },
  { value: 'warehouse', label: 'Warehouse' },
];

void describe('dropdown search (LAI-726)', () => {
  void test('keeps matches case-insensitively, in order, and always keeps the pinned', () => {
    assert.deepEqual(
      filterOptions(LABELS, 'A').map((o) => o.value),
      ['', 'ai', 'ai-p1', 'backend', 'eta', 'warehouse'],
    );
    assert.deepEqual(
      filterOptions(LABELS, '  WARE ').map((o) => o.value),
      ['', 'warehouse'],
    );
    assert.equal(filterOptions(LABELS, '').length, LABELS.length);
  });

  void test('searches keywords as well as the label', () => {
    const sprints: ModelOption[] = [
      { value: 's1', label: 'Foundations', keywords: 'S1' },
      { value: 's2', label: 'Polish', keywords: 'S2' },
    ];
    assert.deepEqual(
      filterOptions(sprints, 's2').map((o) => o.value),
      ['s2'],
    );
  });

  void test('"No matches" is only the pinned left, and only while searching', () => {
    assert.equal(noMatches(filterOptions(LABELS, 'zzz'), 'zzz'), true);
    assert.equal(noMatches(filterOptions(LABELS, 'bug'), 'bug'), false);
    assert.equal(noMatches([{ value: '', label: 'Any', pinned: true }], ''), false);
  });

  void test('highlights every occurrence and keeps the label’s own case', () => {
    assert.deepEqual(highlight('Warehouse', 'ware'), [
      { text: 'Ware', match: true },
      { text: 'house', match: false },
    ]);
    assert.deepEqual(highlight('ai-p1 ai', 'AI'), [
      { text: 'ai', match: true },
      { text: '-p1 ', match: false },
      { text: 'ai', match: true },
    ]);
    assert.deepEqual(highlight('bug', ''), [{ text: 'bug', match: false }]);
    assert.deepEqual(highlight('bug', 'x'), [{ text: 'bug', match: false }]);
  });
});

void describe('dropdown keyboard movement (LAI-726)', () => {
  const opts: ModelOption[] = [
    { value: 'a', label: 'a' },
    { value: 'b', label: 'b', disabled: true },
    { value: 'c', label: 'c' },
    { value: 'd', label: 'd' },
  ];

  void test('steps over disabled options and stops at the ends', () => {
    assert.equal(move(opts, 0, 'next'), 2);
    assert.equal(move(opts, 2, 'previous'), 0);
    assert.equal(move(opts, 3, 'next'), 3, 'Down at the end wrapped');
    assert.equal(move(opts, 0, 'previous'), 0, 'Up at the start wrapped');
    assert.equal(move(opts, -1, 'next'), 0, 'Down with nothing active');
    assert.equal(move(opts, 2, 'first'), 0);
    assert.equal(move(opts, 0, 'last'), 3);
    assert.equal(move(opts, 0, 'page-down'), 3);
    assert.equal(move(opts, 3, 'page-up'), 0);
    assert.equal(move([], 0, 'next'), -1);
  });

  void test('type-ahead walks names with the same first letter, then refines', () => {
    const names: ModelOption[] = [
      { value: '1', label: 'ai' },
      { value: '2', label: 'ai-p1' },
      { value: '3', label: 'backend' },
      { value: '4', label: 'bug' },
    ];
    assert.equal(typeahead(names, -1, 'b'), 2);
    assert.equal(typeahead(names, 2, 'bb'), 3, 'a second "b" moves on to bug');
    assert.equal(typeahead(names, 3, 'bb'), 2, 'and wraps round to the first b');
    assert.equal(typeahead(names, 2, 'bu'), 3, 'a longer buffer refines');
    assert.equal(typeahead(names, 0, 'ai-'), 1);
    assert.equal(typeahead(names, 0, 'z'), -1);
  });
});

void describe('dropdown placement (LAI-726)', () => {
  const at = (top: number, left = 100, width = 200) => ({
    top,
    bottom: top + 32,
    left,
    right: left + width,
    width,
  });
  const vp = { width: 1366, height: 768 };
  const opts = { gap: 4, margin: 8, cap: 288, floor: 160 };

  void test('opens below when it fits', () => {
    const p = place(at(100), 400, vp, opts);
    assert.equal(p.side, 'below');
    assert.equal(p.top, 136);
    assert.equal(p.maxHeight, 288, 'the 18rem cap');
  });

  void test('flips above near the bottom of the viewport', () => {
    const p = place(at(680), 400, vp, opts);
    assert.equal(p.side, 'above');
    assert.equal(p.bottom, 768 - 680 + 4);
    assert.ok(p.maxHeight <= 680 - 12, 'taller than the room above');
  });

  void test('a short list near the bottom still opens below if it fits', () => {
    assert.equal(place(at(600), 100, vp, opts).side, 'below');
  });

  void test('below is capped by the room below when above has less', () => {
    const p = place(at(200), 1000, { width: 900, height: 450 }, opts);
    assert.equal(p.side, 'below');
    assert.equal(p.maxHeight, 450 - 232 - 12);
  });

  void test('never overhangs the right edge, and is at least the trigger’s width', () => {
    const p = place(at(100, 800, 90), 200, { width: 900, height: 768 }, opts);
    assert.equal(p.minWidth, 160, 'the floor');
    assert.ok(p.left + p.minWidth <= 900 - 8, `overhangs: ${String(p.left + p.minWidth)}`);
    const wide = place(at(100, 20, 300), 200, vp, opts);
    assert.equal(wide.minWidth, 300, 'narrower than its trigger');
    assert.ok(wide.left + wide.maxWidth <= 1366 - 8);
  });

  void test('a viewport narrower than the floor clamps the width to it', () => {
    const p = place(at(100, 0, 100), 200, { width: 150, height: 768 }, opts);
    assert.equal(p.minWidth, 134);
    assert.equal(p.left, 8);
  });
});

/*
 * **The visible area, not the layout viewport** (LAI-726 review, round 1). On
 * a phone the visual viewport is smaller than the layout one and can be
 * scrolled inside it — the on-screen keyboard, a pinch zoom — so a panel
 * placed against `innerHeight` lands under the keyboard. `placeWithin` places
 * against the area actually visible and hands back fixed-position values.
 */
void describe('dropdown placement inside the visual viewport (LAI-726 round 1)', () => {
  const opts = { gap: 4, margin: 8, cap: 288, floor: 160 };
  const trigger = (top: number, left = 20, width = 200) => ({
    top,
    bottom: top + 32,
    left,
    right: left + width,
    width,
  });

  void test('with no offset it is exactly `place`', () => {
    const t = trigger(100);
    const area = { left: 0, top: 0, width: 1366, height: 768 };
    assert.deepEqual(placeWithin(t, 400, area, 768, opts), place(t, 400, area, opts));
  });

  void test('flips against the visible area, and its fixed values still meet the trigger', () => {
    // The visible area starts 100px down the layout viewport and is 300 tall
    // (a keyboard took the rest); the trigger sits 250px into it.
    const area = { left: 0, top: 100, width: 400, height: 300 };
    const t = trigger(350);
    const p = placeWithin(t, 400, area, 800, opts);
    assert.equal(p.side, 'above', 'placed below, under the keyboard');
    // `bottom` is from the layout viewport's bottom: the panel's lower edge
    // lands `gap` above the trigger.
    assert.equal(800 - p.bottom!, t.top - 4);
    assert.ok(p.maxHeight <= 250 - 12, `taller than the visible room: ${String(p.maxHeight)}`);
  });

  void test('below, the top is in layout coordinates and the panel stays in the visible area', () => {
    const area = { left: 30, top: 50, width: 300, height: 600 };
    const t = trigger(80, 40, 100);
    const p = placeWithin(t, 200, area, 900, opts);
    assert.equal(p.side, 'below');
    assert.equal(p.top, t.bottom + 4);
    assert.ok(p.left >= area.left + 8, `left of the visible area: ${String(p.left)}`);
    assert.ok(
      p.left + p.minWidth <= area.left + area.width - 8,
      `past the visible area's right: ${String(p.left + p.minWidth)}`,
    );
  });
});

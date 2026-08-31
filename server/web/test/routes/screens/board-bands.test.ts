/**
 * The order of the board's bands (LAI-425).
 *
 * Style matched the design and **order did not**, and order is most of what
 * "feels like the design" means. Measured at 1600×1100 against
 * `docs/design/Laika Prototype.dc.html`, which is byte-identical to the design
 * project's copy:
 *
 * | | prototype | shipped, before |
 * | --- | --- | --- |
 * | first band | sprint strip (`All sprints`, y=10) | board header |
 * | second | board header (`LIVE · SSE`, y=134) | sprint strip |
 *
 * The strip was first in the design and second in ours, and that one inversion
 * changes what the screen announces itself to be about: *which sprint am I in*
 * versus *what am I filtering*.
 *
 * Source order is the honest guard here. `node --test` cannot render a `.tsx`,
 * so nothing in this suite can read a computed `y` — that gap is LAI-227. What
 * this can do is fail if the two are ever swapped back.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

const BOARD = '../../../src/routes/screens/BoardScreen.tsx';

void describe('the sprint strip comes before the board header', () => {
  void test('the strip is rendered first', async () => {
    const src = await readFile(new URL(BOARD, import.meta.url), 'utf8');

    const strip = src.indexOf('<SprintStrip');
    const header = src.indexOf('<ScreenHeader');
    assert.ok(strip > 0, 'the board no longer renders a SprintStrip');
    assert.ok(header > 0, 'the board no longer renders a ScreenHeader');
    assert.ok(
      strip < header,
      'the board header is rendered before the sprint strip — the LAI-425 inversion',
    );
  });

  void test('WORKING NOW still follows the header, and the lanes follow that', async () => {
    // The other two bands were already right; pinning them means a future
    // reorder cannot fix one pair by breaking another.
    const src = await readFile(new URL(BOARD, import.meta.url), 'utf8');
    const header = src.indexOf('<ScreenHeader');
    const presence = src.indexOf('<PresenceStrip');
    const lanes = src.indexOf('className="board-main"');

    assert.ok(header < presence, 'WORKING NOW rose above the board header');
    assert.ok(presence < lanes, 'the lanes rose above WORKING NOW');
  });
});

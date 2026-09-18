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
    // **`<SpaceSlot>` since LAI-251.** The board's header band became the
    // space bar's slot — same band, one level up — and the ordering this file
    // exists to protect is unchanged: the strip is rendered before it.
    const header = src.indexOf('<SpaceSlot');
    assert.ok(strip > 0, 'the board no longer renders a SprintStrip');
    assert.ok(header > 0, 'the board no longer renders its header band');
    assert.ok(
      strip < header,
      'the board header is rendered before the sprint strip — the LAI-425 inversion',
    );
  });

  void test('WORKING NOW still follows the bar, and the view follows that', async () => {
    /*
     * **The band order is the space layout's property since LAI-251.**
     * WORKING NOW is about the space rather than the board — every view of a
     * space shows it — so it moved out of `BoardScreen`, and pinning the order
     * against the board would now pass by finding neither band.
     */
    const file = await readFile(
      new URL('../../../src/components/space/SpaceLayout.tsx', import.meta.url),
      'utf8',
    );
    // Scoped to the frame that renders the bands. The outer component passes
    // `children` through before the frame draws anything, so scanning the
    // whole file finds that hand-off and reads it as the view's position.
    const at = file.indexOf('function SpaceFrame');
    assert.ok(at > 0, 'SpaceFrame is gone — this test is pointed at nothing');
    const src = file.slice(at);
    const bar = src.indexOf('<SpaceTopBar');
    const tabs = src.indexOf('<ViewTabs');
    const presence = src.indexOf('<PresenceStrip');
    const view = src.indexOf('{children}');

    assert.ok(bar > 0 && tabs > 0 && presence > 0 && view > 0, 'a band is missing entirely');
    assert.ok(bar < tabs, 'the tabs rose above the space bar');
    assert.ok(tabs < presence, 'WORKING NOW rose above the tabs');
    assert.ok(presence < view, 'the view rose above WORKING NOW');
  });
});

/**
 * The order of the board's bands (LAI-425, LAI-727).
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
 * This file guarded that the strip came first. **LAI-727 removed the strip
 * and WORKING NOW from the board** on the owner's word — *"remove this row
 * completely from the board, but I want that DONE, BLK and LEFT — add that
 * somewhere on top"* — so what it guards now is the shape that replaced
 * them: no strip, no presence band, and the figures in the toolbar row, just
 * before its icon buttons.
 *
 * Source order is the honest guard here. `node --test` cannot render a `.tsx`,
 * so nothing in this suite can read a computed `y` — that gap is LAI-227, and
 * `test/browser/board-sprint-stats.test.ts` measures the rendered page.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

const BOARD = '../../../src/routes/screens/BoardScreen.tsx';
const TOOLBAR = '../../../src/routes/screens/board/BoardToolbar.tsx';
const STATS = '../../../src/routes/screens/board/SprintStats.tsx';

void describe('the board has no sprint strip, and its figures are in the toolbar (LAI-727)', () => {
  void test('no strip, no band for one, and the stats rendered with the toolbar', async () => {
    const src = await read(BOARD);
    assert.equal(src.indexOf('<SprintStrip'), -1, 'the board renders the sprint strip again');
    assert.equal(src.indexOf('<SpaceBand'), -1, 'the board fills the band above the toolbar again');

    // Positive controls: the two things that replaced it are still there.
    const bar = src.indexOf('<div className="board-bar">');
    const toolbar = src.indexOf('<BoardToolbar');
    const stats = src.indexOf('<SprintStats');
    assert.ok(bar > 0 && toolbar > 0 && stats > 0, 'the toolbar row or its stats are gone');
    assert.ok(bar < toolbar && toolbar < stats, 'the stats are not rendered with the toolbar');
  });

  void test('the toolbar’s slot sits after its spacer and before its first icon button', async () => {
    const toolbar = await read(TOOLBAR);
    const stats = await read(STATS);

    const id = /BOARD_STATS_SLOT_ID = '([^']+)'/.exec(stats)?.[1];
    assert.ok(id !== undefined, 'SprintStats no longer names its slot');

    const spacer = toolbar.indexOf('className="bt-spacer"');
    const slot = toolbar.indexOf(`id="${id}"`);
    const icon = toolbar.indexOf('className="bt-icon"');
    assert.ok(spacer > 0 && icon > 0, 'the toolbar’s spacer or icons are gone');
    assert.ok(slot > 0, `the toolbar has no element with id="${id}" for the stats`);
    assert.ok(spacer < slot && slot < icon, 'the stats slot is not just before the icon buttons');
  });
});

void describe('the space frame draws no WORKING NOW (LAI-727)', () => {
  void test('the bar, then the tabs, then the view — and nothing for presence', async () => {
    /*
     * **The band order is the space layout's property since LAI-251.** It
     * read bar → tabs → WORKING NOW → view until the owner removed the
     * presence row; the three that remain keep their order.
     */
    const file = await read('../../../src/components/space/SpaceLayout.tsx');
    // Scoped to the frame that renders the bands. The outer component passes
    // `children` through before the frame draws anything, so scanning the
    // whole file finds that hand-off and reads it as the view's position.
    const at = file.indexOf('function SpaceFrame');
    assert.ok(at > 0, 'SpaceFrame is gone — this test is pointed at nothing');
    const src = file.slice(at);
    const bar = src.indexOf('<SpaceTopBar');
    const tabs = src.indexOf('<ViewTabs');
    const view = src.indexOf('{children}');

    assert.ok(bar > 0 && tabs > 0 && view > 0, 'a band is missing entirely');
    assert.ok(bar < tabs, 'the tabs rose above the space bar');
    assert.ok(tabs < view, 'the view rose above the tabs');
    assert.equal(src.indexOf('<PresenceStrip'), -1, 'WORKING NOW is drawn again');
  });
});

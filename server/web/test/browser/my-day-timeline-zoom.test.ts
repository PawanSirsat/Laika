/**
 * My day's Timeline at Fit, 1× and 2× (LAI-860): the owner's day was
 * five-minute collector blocks, some a few minutes apart and some at the same
 * time, and at 1× and 2× their count chips ran into one another, the blocks
 * stacked on top of each other, labels shrank to a letter and the selected
 * outline lay over the next block.
 *
 * Every assertion here is a bounding box, measured in a real browser, on a
 * day seeded in that shape. The API is stubbed (`my-day-week.ts`).
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, setTheme, type Harness } from './harness.ts';
import {
  ATLAS,
  CARD_A,
  CARD_B,
  CARD_C,
  SETTINGS,
  TODAY,
  at,
  weekData,
  weekStub,
  type DayData,
  type Draft,
  type Entry,
} from './my-day-week.ts';

/** A collector's block: `minutes` long from `h:m`, with its prompts and commits. */
function block(
  id: string,
  h: number,
  m: number,
  minutes: number,
  card: typeof CARD_A | null,
  prompts: number,
  commits: number,
): Draft {
  const started = at(TODAY, h, m);
  return {
    id,
    source: 'collector',
    day: TODAY,
    tz: 'UTC',
    started_at: started,
    ended_at: started + minutes * 60_000,
    minutes,
    task: card,
    task_key: null,
    project: card === null ? null : ATLAS,
    general: false,
    signals: { prompts, replies: prompts * 2, sessions: 1, commits, marks: 0 },
    note: null,
  };
}

/**
 * The owner's screen, in shape: five-minute blocks two minutes apart (z1–z3),
 * two that overlap (z2, z3) and three at once (z4–z6), each with the counts
 * the screenshot showed; a gap of 47 minutes; a block with no counts (z8); a
 * longer block with room for everything (z10); and a confirmed entry.
 */
function zoomDay(): Map<string, DayData> {
  const drafts = [
    block('z1', 8, 0, 5, CARD_A, 0, 13),
    block('z2', 8, 7, 5, null, 0, 3),
    block('z3', 8, 9, 5, CARD_B, 1, 0),
    block('z4', 8, 15, 5, CARD_A, 2, 1),
    block('z5', 8, 16, 5, null, 0, 2),
    block('z6', 8, 18, 5, CARD_C, 1, 1),
    block('z7', 9, 10, 5, CARD_B, 3, 0),
    block('z8', 9, 20, 5, null, 0, 0),
    block('z9', 9, 27, 5, CARD_C, 1, 4),
    block('z10', 10, 0, 30, CARD_A, 12, 2),
    block('z11', 10, 31, 5, CARD_B, 0, 1),
  ];
  const started = at(TODAY, 11, 0);
  const entries: Entry[] = [
    {
      id: 'ze1',
      day: TODAY,
      tz: 'UTC',
      started_at: started,
      ended_at: started + 30 * 60_000,
      minutes: 30,
      source: 'manual',
      task: null,
      project: null,
      note: 'Planning call',
      revision: 1,
      created_at: 1,
      updated_at: 1,
    },
  ];
  const data = weekData();
  data.set(TODAY, { drafts, entries });
  return data;
}

async function openZoomDay(): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, {
    ...weekStub(zoomDay()),
    '/api/v1/me/time-settings': SETTINGS,
  });
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  return h;
}

interface Box {
  readonly l: number;
  readonly r: number;
  readonly t: number;
  readonly b: number;
}

interface Drawn {
  readonly id: string;
  readonly box: Box;
  /** The box the block's count chip paints, or `null` when it paints none. */
  readonly chip: Box | null;
  readonly chipText: string;
  readonly label: string;
  readonly labelCut: boolean;
  readonly selected: boolean;
  /** How far past its own box the block's ring is drawn, in px: 0 when it keeps inside. */
  readonly ringReach: number;
  readonly edges: readonly Box[];
}

/** Every placed block as the browser drew it. */
async function measure(page: Page): Promise<Drawn[]> {
  return page.evaluate(() => {
    const boxOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    };
    // A chip is whatever inside it paints a fill or a border: the badge as drawn.
    const paints = (el: Element): boolean => {
      if (el.getClientRects().length === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = getComputedStyle(el);
      return s.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(s.borderTopWidth) > 0;
    };
    // The furthest any outer shadow or outline reaches past the border box.
    const reachOf = (s: CSSStyleDeclaration): number => {
      let reach = 0;
      if (s.boxShadow !== 'none') {
        for (const shadow of s.boxShadow.split(/,(?![^(]*\))/)) {
          if (shadow.includes('inset')) continue;
          const [x = 0, y = 0, blur = 0, spread = 0] = (shadow.match(/-?[\d.]+px/g) ?? []).map(
            parseFloat,
          );
          reach = Math.max(reach, Math.max(Math.abs(x), Math.abs(y)) + blur + spread);
        }
      }
      if (s.outlineStyle !== 'none') {
        reach = Math.max(reach, parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset));
      }
      return reach;
    };
    return [...document.querySelectorAll<HTMLElement>('[data-block-id]')].map((el) => {
      const chipRoot = el.querySelector('.dayline-signals');
      const painted =
        chipRoot === null ? undefined : [chipRoot, ...chipRoot.querySelectorAll('*')].find(paints);
      const top = el.querySelector('.dayline-block-top');
      return {
        id: el.dataset.blockId ?? '',
        box: boxOf(el),
        chip: painted === undefined ? null : boxOf(painted),
        chipText: (painted?.textContent ?? '').trim(),
        label: (top?.textContent ?? '').trim(),
        labelCut: top !== null && top.scrollWidth > top.clientWidth + 1,
        selected: el.classList.contains('dayline-selected'),
        ringReach: Math.max(
          reachOf(getComputedStyle(el)),
          reachOf(getComputedStyle(el, '::before')),
          reachOf(getComputedStyle(el, '::after')),
        ),
        edges: [...el.querySelectorAll('.dayline-edge')].map(boxOf),
      };
    });
  });
}

/** Two boxes share more than half a pixel each way: one is drawn over the other. */
const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;

const inside = (a: Box, b: Box): boolean =>
  a.l >= b.l - 0.5 && a.r <= b.r + 0.5 && a.t >= b.t - 0.5 && a.b <= b.b + 0.5;

/**
 * The block on top at the centre of block `id` as drawn, once scrolled into
 * view — the block's own box, which its body may be wider than and clipped to.
 */
async function onTopAtCentre(page: Page, id: string): Promise<string | undefined> {
  const block = page.locator(`[data-block-id="${id}"]`);
  await block.scrollIntoViewIfNeeded();
  return block.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return (hit?.closest('[data-block-id]') as HTMLElement | null)?.dataset.blockId;
  });
}

void after(async () => {
  await closeBrowser();
});

void describe('the Timeline at Fit, 1× and 2× (LAI-860)', () => {
  void test('short blocks close together and at the same time: no chip, block, label or outline is drawn over another', async () => {
    const h = await openZoomDay();
    // Every combination is measured before anything is asserted, so a failure
    // names everything that is drawn wrong, not only the first thing.
    const problems: string[] = [];
    const check = (ok: boolean, problem: string): void => {
      if (!ok) problems.push(problem);
    };
    try {
      for (const width of [1440, 390]) {
        await h.page.setViewportSize({ width, height: 900 });
        for (const theme of ['light', 'dark']) {
          await setTheme(h.page, theme);
          for (const zoom of ['fit', '1', '2']) {
            const where = `${String(width)} px, ${theme}, zoom ${zoom}`;
            await h.page.locator(`[data-zoom="${zoom}"]`).click();

            // Seen and picked out: each block is the one on top at its own centre.
            const drawn = await measure(h.page);
            assert.equal(drawn.length, 12, `${where}: every timed block is placed`);
            for (const { id } of drawn) {
              const top = await onTopAtCentre(h.page, id);
              check(top === id, `${where}: ${id} is covered by ${String(top)}`);
            }
            // …and selectable there: the three at once, one after another.
            for (const id of ['z4', 'z5', 'z6']) {
              const block = h.page.locator(`[data-block-id="${id}"]`);
              await block.scrollIntoViewIfNeeded();
              const box = await block.boundingBox();
              assert.ok(box !== null, `${where}: ${id} has no box`);
              await h.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              check(
                (await block.locator('[data-block-select]').getAttribute('aria-pressed')) ===
                  'true',
                `${where}: a click on ${id} did not select it`,
              );
            }

            const blocks = await measure(h.page);
            const picked = blocks.filter((b) => b.selected);
            check(
              picked.length === 1 && picked[0]?.id === 'z6',
              `${where}: the last click is not the selection`,
            );
            for (const b of blocks) {
              check(b.box.b - b.box.t >= 10, `${where}: ${b.id} is too short to see`);
              for (const other of blocks) {
                if (other.id <= b.id) continue;
                check(!overlaps(b.box, other.box), `${where}: ${b.id} lies over ${other.id}`);
                if (b.chip !== null && other.chip !== null) {
                  check(
                    !overlaps(b.chip, other.chip),
                    `${where}: ${b.id}'s chip "${b.chipText}" runs into ${other.id}'s "${other.chipText}"`,
                  );
                }
              }
              if (b.chip !== null) {
                for (const other of blocks) {
                  if (other.id === b.id) continue;
                  check(
                    !overlaps(b.chip, other.box),
                    `${where}: ${b.id}'s chip "${b.chipText}" lies over ${other.id}`,
                  );
                }
              }
              // A label is whole, or cut at a word with its ellipsis, or not there.
              check(!b.labelCut, `${where}: ${b.id}'s label "${b.label}" is cut off`);
              check(
                b.label === '' || b.label.replace(/…$/, '').length >= 2,
                `${where}: ${b.id}'s label is a lone "${b.label}"`,
              );
            }
            for (const b of picked) {
              check(
                b.ringReach <= 0,
                `${where}: the selected outline reaches ${String(b.ringReach)}px past ${b.id}`,
              );
              check(b.edges.length === 2, `${where}: the selected block lacks its two edges`);
              for (const edge of b.edges) {
                check(inside(edge, b.box), `${where}: an edge of ${b.id} sticks out of it`);
              }
            }

            // The positive control: where there is room, the chip and the label are drawn whole.
            if (zoom === '2') {
              const long = blocks.find((b) => b.id === 'z10');
              assert.ok(long !== undefined, `${where}: the 30-minute block is not drawn`);
              assert.equal(long.chipText, '12p 2c', `${where}: the 30-minute block lost its chip`);
              assert.equal(long.label, CARD_A.key, `${where}: the 30-minute block lost its label`);
            }
          }
        }
      }
      assert.deepEqual(problems, []);
    } finally {
      await h.close();
    }
  });
});

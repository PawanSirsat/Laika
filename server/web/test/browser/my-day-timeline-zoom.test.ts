/**
 * My day's Timeline at Fit, 1× and 2× (LAI-860): the owner's day was
 * five-minute collector blocks, some a few minutes apart and some at the same
 * time, and at 1× and 2× their count chips ran into one another, the blocks
 * stacked on top of each other, labels shrank to a letter and the selected
 * outline lay over the next block.
 *
 * Measured in a real browser, on a day seeded in that shape: the bounding
 * boxes of blocks, chips, labels and edge handles; which block is on top at a
 * block's centre, and that a click there selects it; whether a label is cut
 * across or down; and how far past its block a selection is drawn. The API
 * is stubbed (`my-day-week.ts`).
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

const CARDS = [CARD_A, CARD_B, CARD_C, null] as const;

/**
 * `n` hour-long blocks a minute apart from `h:m`, all at the same time:
 * `prefix1`… An hour is wide enough at 1× and 2× for a label and a chip, so
 * what stops them is the row's height, which is what these are here to test.
 */
const atOnce = (prefix: string, h: number, m: number, n: number): Draft[] =>
  Array.from({ length: n }, (_, i) =>
    block(`${prefix}${String(i + 1)}`, h, m + i, 60, CARDS[i % 4] ?? null, i + 1, n - i),
  );

/** Eight at once is past the rule's floor: each keeps its own row, below 10px. */
const PAST_THE_FLOOR = new Set(atOnce('g', 13, 30, 8).map((d) => d.id));

/**
 * The owner's screen, in shape: five-minute blocks two minutes apart (z1–z3),
 * two that overlap (z2, z3) and three at once (z4–z6), each with the counts
 * the screenshot showed; a gap of 47 minutes; a block with no counts (z8); a
 * longer block with room for everything (z10); and a confirmed entry. Then
 * what the drafter makes of tasks worked in parallel, an hour each: three at
 * once (k1–k3), five (f1–f5) and eight (g1–g8); three five-minute blocks back
 * to back (t1–t3); an hour with a card's title (h1); and a short block with
 * nothing near it (zl).
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
    ...atOnce('k', 6, 30, 3),
    ...atOnce('f', 12, 0, 5),
    ...atOnce('g', 13, 30, 8),
    block('t1', 15, 0, 5, CARD_A, 2, 0),
    block('t2', 15, 5, 5, CARD_B, 0, 2),
    block('t3', 15, 10, 5, CARD_C, 1, 1),
    block('h1', 15, 30, 60, CARD_B, 9, 2),
    block('zl', 18, 30, 5, CARD_C, 4, 2),
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

interface Edge {
  readonly box: Box;
  /** Visible and taking the pointer. */
  readonly drawn: boolean;
  /** Still reachable by Tab, so ← and → work. */
  readonly focusable: boolean;
}

interface Drawn {
  readonly id: string;
  readonly box: Box;
  /** The box the block's count chip paints, or `null` when it paints none. */
  readonly chip: Box | null;
  readonly chipText: string;
  readonly label: string;
  /** Cut across or down in its own box, or outside a box that clips it. */
  readonly labelCut: boolean;
  readonly selected: boolean;
  /**
   * How far past the block's own box its selection is drawn, in px: the
   * outer shadows and outlines of the block and of its `::before` and
   * `::after`, plus how far a positioned pseudo-element is set outside the
   * block by its offsets. An inset shadow draws inside its own box and adds
   * nothing. 0 when everything keeps inside.
   */
  readonly ringReach: number;
  readonly edges: readonly Edge[];
}

/** Every placed block as the browser drew it, and the track they are on. */
async function measure(page: Page): Promise<{ track: Box; blocks: Drawn[] }> {
  return page.evaluate(() => {
    const boxOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    };
    // A chip is whatever inside it is visible and paints a fill or a border.
    const paints = (el: Element): boolean => {
      if (el.getClientRects().length === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = getComputedStyle(el);
      if (s.visibility !== 'visible' || parseFloat(s.opacity) === 0) return false;
      return s.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(s.borderTopWidth) > 0;
    };
    // Outside the padding box of an ancestor, up to its block, that clips it.
    const clippedOut = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      for (let n = el.parentElement; n !== null; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
          const p = n.getBoundingClientRect();
          const l = p.left + n.clientLeft;
          const t = p.top + n.clientTop;
          if (
            r.left < l - 1 ||
            r.right > l + n.clientWidth + 1 ||
            r.top < t - 1 ||
            r.bottom > t + n.clientHeight + 1
          ) {
            return true;
          }
        }
        if (n.matches('[data-block-id]')) break;
      }
      return false;
    };
    const shadowReach = (s: CSSStyleDeclaration): number => {
      let reach = 0;
      if (s.boxShadow === 'none') return reach;
      for (const shadow of s.boxShadow.split(/,(?![^(]*\))/)) {
        if (shadow.includes('inset')) continue;
        const [x = 0, y = 0, blur = 0, spread = 0] = (shadow.match(/-?[\d.]+px/g) ?? []).map(
          parseFloat,
        );
        reach = Math.max(reach, Math.max(Math.abs(x), Math.abs(y)) + blur + spread);
      }
      return reach;
    };
    const outlineReach = (s: CSSStyleDeclaration): number =>
      s.outlineStyle === 'none' ? 0 : parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
    const pseudoReach = (el: Element, which: string): number => {
      const s = getComputedStyle(el, which);
      if (s.content === 'none' || s.content === 'normal') return 0;
      const placed = s.position === 'absolute' || s.position === 'fixed';
      const out = placed
        ? Math.max(
            0,
            ...['top', 'right', 'bottom', 'left'].map(
              (k) => -parseFloat(s.getPropertyValue(k)) || 0,
            ),
          )
        : 0;
      return out + shadowReach(s) + Math.max(0, outlineReach(s));
    };
    const track = document.querySelector('[data-dayline-track]');
    const blocks = [...document.querySelectorAll<HTMLElement>('[data-block-id]')].map((el) => {
      const chipRoot = el.querySelector('.dayline-signals');
      const painted =
        chipRoot === null ? undefined : [chipRoot, ...chipRoot.querySelectorAll('*')].find(paints);
      const top = el.querySelector('.dayline-block-top');
      const label = (top?.textContent ?? '').trim();
      const s = getComputedStyle(el);
      return {
        id: el.dataset.blockId ?? '',
        box: boxOf(el),
        chip: painted === undefined ? null : boxOf(painted),
        chipText: (painted?.textContent ?? '').trim(),
        label,
        labelCut:
          top !== null &&
          label !== '' &&
          (top.scrollWidth > top.clientWidth + 1 ||
            top.scrollHeight > top.clientHeight + 1 ||
            clippedOut(top)),
        selected: el.classList.contains('dayline-selected'),
        ringReach: Math.max(
          shadowReach(s),
          Math.max(0, outlineReach(s)),
          pseudoReach(el, '::before'),
          pseudoReach(el, '::after'),
        ),
        edges: [...el.querySelectorAll<HTMLElement>('.dayline-edge')].map((e) => {
          const es = getComputedStyle(e);
          const visible = es.visibility === 'visible' && es.display !== 'none';
          return {
            box: boxOf(e),
            drawn: visible && parseFloat(es.opacity) > 0 && es.pointerEvents !== 'none',
            focusable: visible && e.tabIndex >= 0,
          };
        }),
      };
    });
    return { track: track === null ? { l: 0, r: 0, t: 0, b: 0 } : boxOf(track), blocks };
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
  const el = page.locator(`[data-block-id="${id}"]`);
  await el.scrollIntoViewIfNeeded();
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return (hit?.closest('[data-block-id]') as HTMLElement | null)?.dataset.blockId;
  });
}

/** Click block `id` at its centre as drawn; whether that selected it. */
async function clickCentre(page: Page, id: string): Promise<boolean> {
  const el = page.locator(`[data-block-id="${id}"]`);
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  assert.ok(box !== null, `${id} has no box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return (await el.locator('[data-block-select]').getAttribute('aria-pressed')) === 'true';
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
            // Chrome hit-tests up to about a pixel off the boxes it reports (measured:
            // 0.9px at 390 px), so a centre within a pixel of a neighbour's box — two
            // five-minute blocks back to back at Fit on a phone, 1.7px each — cannot
            // be told apart by a pointer at all. That is where the rule stops across.
            const drawn = await measure(h.page);
            assert.equal(drawn.blocks.length, 33, `${where}: every timed block is placed`);
            for (const { id, box } of drawn.blocks) {
              const x = (box.l + box.r) / 2;
              const y = (box.t + box.b) / 2;
              const crowded = drawn.blocks.some(
                (o) =>
                  o.id !== id && y > o.box.t && y < o.box.b && x > o.box.l - 1 && x < o.box.r + 1,
              );
              if (crowded) continue;
              const top = await onTopAtCentre(h.page, id);
              check(top === id, `${where}: ${id} is covered by ${String(top)}`);
            }
            // …and selectable there: three at once, then the last of five and of eight.
            for (const id of ['z4', 'z5', 'z6', 'f5', 'g8']) {
              check(await clickCentre(h.page, id), `${where}: a click on ${id} did not select it`);
            }

            const { track, blocks } = await measure(h.page);
            const picked = blocks.filter((b) => b.selected);
            check(
              picked.length === 1 && picked[0]?.id === 'g8',
              `${where}: the last click is not the selection`,
            );
            for (const b of blocks) {
              // The rule's floor: up to five at once, a row is 10px or more.
              const floor = PAST_THE_FLOOR.has(b.id) ? 3 : 9.5;
              check(b.box.b - b.box.t >= floor, `${where}: ${b.id} is too short to see`);
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
                check(
                  b.chip.l >= track.l - 0.5 && b.chip.r <= track.r + 0.5,
                  `${where}: ${b.id}'s chip "${b.chipText}" runs off the track`,
                );
              }
              // A label is whole, or cut at a word with its ellipsis, or not there.
              check(!b.labelCut, `${where}: ${b.id}'s label "${b.label}" is cut off`);
              check(
                b.label === '' || b.label.replace(/…$/, '').length >= 2,
                `${where}: ${b.id}'s label is a lone "${b.label}"`,
              );
            }
            const selection = (b: Drawn, drawnEdges: boolean): void => {
              check(
                b.ringReach <= 0,
                `${where}: the selected outline reaches ${String(b.ringReach)}px past ${b.id}`,
              );
              check(b.edges.length === 2, `${where}: the selected ${b.id} lacks its two edges`);
              for (const edge of b.edges) {
                // Usable, or not drawn — and the keyboard can still reach it.
                check(edge.focusable, `${where}: an edge of ${b.id} cannot be reached by Tab`);
                if (!edge.drawn) continue;
                check(inside(edge.box, b.box), `${where}: an edge of ${b.id} sticks out of it`);
                check(
                  edge.box.b - edge.box.t >= 8 && edge.box.r - edge.box.l >= 4,
                  `${where}: an edge of ${b.id} is drawn too small to take`,
                );
              }
              if (drawnEdges) {
                check(
                  b.edges.every((e) => e.drawn),
                  `${where}: ${b.id} has room for its edges and does not draw them`,
                );
              }
            };
            for (const b of picked) selection(b, false);

            // The positive controls: where there is room, chips, labels and edges are drawn.
            const named = (id: string): Drawn | undefined => blocks.find((b) => b.id === id);
            check(
              named('zl')?.chipText === '4p 2c',
              `${where}: the short block standing alone lost its chip`,
            );
            if (zoom !== 'fit') {
              check(named('h1')?.label === CARD_B.key, `${where}: the hour lost its label`);
              check(named('k1')?.label === CARD_A.key, `${where}: three at once lost k1's label`);
            }
            if (zoom === '2') {
              check(named('z10')?.chipText === '12p 2c', `${where}: z10 lost its chip`);
              check(named('z10')?.label === CARD_A.key, `${where}: z10 lost its label`);
              check(named('z7')?.chipText === '3p 0c', `${where}: z7, with room, lost its chip`);
              check(named('f1')?.chipText === '1p 5c', `${where}: f1, with room, lost its chip`);
            }
            check(await clickCentre(h.page, 'z10'), `${where}: a click on z10 did not select it`);
            const roomy = (await measure(h.page)).blocks.find((b) => b.id === 'z10');
            if (roomy !== undefined) selection(roomy, true);
          }
        }
      }
      assert.deepEqual(problems, []);
    } finally {
      await h.close();
    }
  });
});

---
id: LAI-254
title: 'The board takes the prototype''s geometry: lanes, tubs and card anatomy'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-251]
discovered-from: LAI-248
status: backlog
---

## Goal

Phase B1 of the owner-approved prototype rebuild (2026-09-18). Phase A put the
right chrome around the board; this makes the board itself the design's
(`docs/design/Laika Prototype.dc.html` lines 146–313).

- **Sprint filter bar** (146–165): an *All sprints* chip plus one per sprint,
  each with mono id, `done/total` fraction, a progress hairline and a
  DONE/BLK/LEFT stat block; the active sprint in `--purs`, the selected one in
  `--accs`.
- **The lanes** (259–313): `grid-template-columns: repeat(5, minmax(248px, 1fr))`,
  `min-width: 1300px`, gap 12px; each lane a `--tub` tub at `border-radius: 12px`,
  `padding: 12px 10px`, gap 10px. Header: 7px dot, name 10.5px/800 at
  `letter-spacing: .07em` in the lane's colour, a mono count chip
  (`radius 5px`, `padding 3px 4px`), and the WIP hint right-aligned and
  ellipsised at `max-width: 82px`.
- **Lane colours**: BACKLOG `--tx3` · TO DO `--pur` · IN PROGRESS `--acc` ·
  REVIEW `--amb` · DONE `--grn`.
- **Card anatomy**: title 13.5px/600, `line-height 1.4`, `-.008em`, clamped to
  two lines; label chips 8.5px/700 from a `LABEL_COLORS` map (prototype 1444);
  the blocked banner in `--reds` with a 2px `--red` left border and a lock;
  then a footer above a 1px `--bd` rule holding the 9px priority dot with its
  1.5px ring, the 22px avatar (dashed `--bd2` ring when unassigned), the purple
  12px bot badge notched at the avatar's corner for agent-authored work, and
  mono dependency/comment counts.
- **`flash` and `pop`** on cards that change, from the space's stream.

## Acceptance criteria

- [ ] Lane geometry measured in a browser test: five tracks, 248px floor,
      `--tub` ground, radius 12, the header's dot/name/count chip present with
      the lane's own colour.
- [ ] Card anatomy measured: two-line clamp, chip sizes, blocked banner border,
      priority dot ring, avatar ring for unassigned, bot badge only where
      `created_via` is the agent path.
- [ ] `LABEL_COLORS` lives in `board/label-colors.ts` with a test; a tag with no
      entry falls back to neutral rather than rendering unstyled.
- [ ] The sprint chip bar renders real sprints with real fractions, and the
      active sprint is distinguishable from the selected one.
- [ ] A card that changes flashes, and `prefers-reduced-motion` suppresses it
      while the change still shows.
- [ ] `BoardScreen.tsx` splits into `board/{BoardScreen,BoardGrid,BoardColumn}.tsx`
      — the file is ~600 lines and this task adds to it.
- [ ] Both themes, widths 1440 / 1280 / 900 / 420, page overflow `0` at each.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

Absorbed backlog ids, for CHIEF to close against this: **LAI-232** (the board
is never rendered with sprints in a test), **LAI-223** (`comment_count` is
served and never shown).

**The responsive rules are the prototype's** (lines 34–37), per the owner's
exact-match mandate: the grid steps to `minmax(192px)` below 1180 and
`minmax(166px)` below 900. Where that contradicts LAI-175/LAI-244's shipped
breakpoints, the prototype wins and CHIEF records the supersession — the same
resolution LAI-251 applied to the Capacity tab.

**Do not invent a WIP denominator.** `demo/wip.ts` answers 4 for `in_progress`
only and is demo-gated (D-032); no endpoint stores column limits. The hint
renders from that or not at all.

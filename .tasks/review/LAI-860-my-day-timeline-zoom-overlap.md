---
id: LAI-860
title: 'My day Timeline at 1x and 2x: blocks, count chips and labels overlap each other'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-21T11:15:58Z
finished: 2026-10-21T11:41:11Z
---

## Goal

On My day, the Timeline reads cleanly at every zoom: Fit, 1x and 2x. Nothing
draws on top of anything else, and no label is cut to a single letter.

This is on the owner's direct instruction (2026-10-21, with a screenshot of
the live screen at 2x):

> "UI is little bit broken here when I switch 2x and 1x fix this as well"

## Found (from the owner's screenshot, 2x, the YOU row)

- The count chips above the blocks (`0p 13c`, `0p 3c`, `1p 0c`) collide with
  the chip of the next block and are cut off mid-text (`0p (`).
- Several short blocks sit on top of one another as a translucent stack, so
  none of them can be read or picked out.
- Block labels shrink to one letter or an ellipsis (`Ne…`, `S`, `M`).
- The selected block's dark outline spills over its neighbours.

Fit was not reported as broken. Check it anyway.

## Acceptance criteria

- [x] The cause is named in this file: which measurement or layout rule
      lets chips, blocks or outlines overlap at 1x and 2x.
- [x] At Fit, 1x and 2x, no block's count chip overlaps another block's chip.
      A chip that does not fit is hidden, shortened or moved, never drawn
      over a neighbour.
- [x] Blocks that overlap in time can each still be seen and selected, at
      every zoom. If doing that properly needs a design change (for example
      lanes), stop, file it, and fix only the overlap here.
- [x] The selected outline stays within its own block's space.
- [x] A label that does not fit is hidden or cut cleanly. A lone letter does
      not count as a label.
- [x] Both themes, and a narrow window (390 px wide).
- [x] A browser test measures the bounding boxes of neighbouring chips and
      blocks at 1x and 2x and fails on today's code. It asserts boxes, not a
      count, and it is aimed at a seeded day shaped like the screenshot: short
      5-minute blocks, some close together, some overlapping.
- [x] No design token or colour changes (D-020).
- [x] The repo-root gate exits 0: `pnpm test`, `pnpm lint`, `pnpm format`,
      each exit code captured on its own line.

## Notes

- Area is `server/web/src/routes/screens/my-day/`, most likely
  `Timeline.tsx`, `timeline-derive.ts` and `my-day.css`.
- **Work in flight on the same files, on other branches; do not touch them:**
  LAI-834 (`LAI-834-signals-lane`) changes `Timeline.tsx`, `my-day.css` and
  `timeline-derive.ts` to draw a SIGNALS lane above the row. It **keeps** the
  per-block count badge ("every block still shows its counts as a badge");
  this line said "in place of the count chip" until review round 1.
  LAI-858 (`LAI-858-my-day-lists-scroll`) has uncommitted edits to
  `my-day.css`. Keep this diff small and local to the chip and block layout,
  so whichever lands second merges it easily. Say in the review notes how this
  fix lines up with LAI-834's version of the chip.
- Seed a local instance on a port nobody else uses, with its own database
  (CLAUDE.md §4.3). No production or owner data goes into the repo or the
  tests. The repo is public.
- Owner-direct, dispatched by CHIEF. Branch `LAI-860-my-day-timeline-zoom`.

## Cause (reproduced 2026-10-21 on master `d36d2ee5`)

Reproduced on a local instance (port 3861, its own database) seeded with
eleven five-minute collector drafts shaped like the owner's screen, and in
the browser test below. **The lane placed each block by its time alone, in
one row, and drew everything around it as if the block were wide.** Zoom
only changes the width, so 1× and 2× (9 px and 18 px for five minutes) and
Fit (3.8 px at 1440) broke the same five rules:

1. **The count chip had no width limit.** `.dayline-signals` was sized to
   its text (`0p 13c` is about 50 px) and pinned `right: 0.25rem` to its
   block, so on any block narrower than its chip it hung left over the
   blocks before it. Each later chip, opaque `--bg-card`, was painted over
   the earlier one, which is the `0p (` cut.
2. **Nothing placed blocks that overlap in time.** Every block had the same
   `top`/`bottom` in one row, so two sessions on two cards over the same
   minutes were drawn in one place, and the translucent drafted fill stacked.
3. **The label had a bare `text-overflow: ellipsis` and no minimum**, so an
   18 px block showed a letter or `Ne…`.
4. **The selected ring and handles sat outside the block.** The ring was an
   outer `box-shadow` of 2 + 2 px, and `.dayline-edge` sat at `-0.25rem`.
   Both lay 4 px over neighbours a minute away (3.7 px at 2×).
5. **At Fit, the block body is wider than the block.** The button's padding
   and border (about 18 px) cannot shrink to a 3.8 px block, so it painted
   over the next blocks, and a selected one (z-index 3) covered them.
   Measured with `elementFromPoint`, not assumed.

## Fix

All in `server/web/src/routes/screens/my-day/`, no token or colour changes:

- `timeline-derive.ts` `stackOf`: blocks at the same time take a row each of
  the lane's height; a block nothing overlaps keeps the whole height. The CSS
  reads `--row`/`--rows`, and a stacked row drops to one line.
- ~~The chip is `FitLabel`'s, in a box kept inside its own block's width.
  Only a stretch's top row has one.~~ **Replaced in round 1:**
  `placeChips` (`timeline-derive.ts`) puts a badge inside its block's end
  where it fits, or centred over a narrower block, and draws it only where
  that box, as measured after each render, clears every other block, every
  badge already placed and both ends of the track; longer blocks first. So a
  short block alone keeps its badge, and no row-0 special case is needed. A
  block whose badge is not drawn still shows its counts in the inspector.
- **Round 1:** a stacked label uses `line-height: normal` (was `1`), the
  label box is `flex-shrink: 0` outside a stack, `FitLabel` also checks
  `scrollHeight`, and on a block under 20px tall or 10px wide the edge
  handles are not drawn but keep Tab, ← and →. The track is
  `overflow-x: clip`.
- The label is `FitLabel`'s: whole, cut after a whole word (`Needs a…`), or
  nothing (`cutsOf`).
- The ring is an inset shadow on `::after`, inside the block; the handles sit
  inside its edges at `min(0.5rem, 40%)`; the block is `overflow-x: clip`.
- `--row` and `--rows` are declared on `.dayline-block` (`0` and `1`), and
  the inline style overrides them. The first root gate caught them used and
  never defined (`tokens.test.ts`, "every var(--token) a stylesheet uses is
  actually defined"), which is the gate working.

This is a layout rule inside the existing YOU row, not new lanes, so the
"stop and file a design change" branch of the third criterion was not taken.

## Verification

- `server/web/test/browser/my-day-timeline-zoom.test.ts` (new) measures every
  block, chip, label, ring and handle as boxes, at 1440 and 390 px, light and
  dark, Fit/1×/2×, and clicks the three blocks at once at their centres.
  **On master's code it fails with 814 problems**: at 1× 248 (68 chip into
  chip, 84 chip over a block, 16 block over block, 12 covered at its centre,
  8 clicks that selected the wrong block, 48 cut labels, 4 rings 4 px out, 8
  handles out), at 2× 216, at Fit 350. **After: passes.** Run with master's
  three source files swapped in by name and restored by checksum.
  **Round 1, on the final fixture (33 blocks):** master's code 3868
  problems, `e262f6be` 264, final 0. Breakdown under "Strelka's fixes",
  item 5.
- `server/web/test/routes/screens/my-day/timeline-derive.test.ts`: four
  `stackOf` cases. Two mutations of `stackOf` turn it red (1 and 3 fail).
  **Round 1:** six `stackOf` cases and seven `placeChips` cases; seven
  mutations, each red (item 2 below).
- Root gate, run 1, after merging master `0e1f6d38`: `pnpm test` exit 1, on
  two cases. One was `tokens.test.ts` (fixed above). The other was the
  wider-font case at `my-day-v2.test.ts:950`, cutting `1:00–2:50 PM · 1 h 50
  min` at 1440, folded=false. That is the failure LAI-846 records on master
  with no My day edits. The file passed alone, 31/31, three runs of three.
  The case adds letter-spacing at 1280 px, resizes to 1440 and measures at
  once, so `FitLabel`'s ResizeObserver re-render has to land in between. This
  fix adds a `FitLabel` per block label and chip, so it may lose that race
  more often under load. The race is the test's, and LAI-846's to fix.
- Screenshots: `/tmp/LAI-860/before-light-1440-{fit,1,2}.png`,
  `/tmp/LAI-860/after-light-1440-{fit,1,2}.png`,
  `/tmp/LAI-860/after-dark-1440-2.png`, `/tmp/LAI-860/after-light-390-2.png`.

## Review notes (LAI-860, for whoever merges second with LAI-834)

- **No longer true after round 1; see "Strelka's fixes", item 4:** the
  round-1 rework edits the `Timeline` doc paragraph that LAI-834 rewrites,
  so the two now conflict there, and only there.
- **Merges cleanly with `LAI-834-signals-lane`.** `git merge-tree
  --write-tree` of the two branches reports no conflict. The merged web tree
  typechecks, and this test plus LAI-834's `my-day-signals.test.ts` pass
  together (5 of 5).
- **The chip fits LAI-834's version unchanged.** LAI-834 keeps the per-block
  badge ("every block still shows its counts as a badge") and adds the
  SIGNALS lane above the row. This fix changes only how the badge is bounded,
  so on top of LAI-834 a badge still shows where it fits and is left out
  where it does not, while the lane shows where in the block the signals
  fell. The badge reaches 3 px above the row; LAI-834's tallest mark (the
  commit tick, `0.25rem` + `1.25rem`) ends 4 px above the lane's bottom, so
  the two do not touch.
- **One sentence to adjust on landing:** the `Timeline` doc comment says each
  block shows its counts as a badge. After this fix that holds only where the
  badge fits and on a stretch's top row. I left that paragraph alone because
  LAI-834 rewrites it, and editing it here would have made the two conflict.
- **Would LAI-834's lane hit the same overlap?** Not at 1× or 2×: a prompt
  dot is 7 px (`0.4375rem`) and a five-minute slot is 9.2 px at 1× and
  18.3 px at 2×. **At Fit, yes**: a slot is 3.8 px at 1440, so dots in
  adjacent slots overlap by about 3 px, and at 390 px (1.7 px a slot) the
  2 px commit ticks touch as well. A prompt dot and a commit tick in the same slot share a
  centre by design. Filed as a follow-up rather than changed here.

## Review round 1 (CHANGES REQUIRED on PR #9) — unfinished, handed to Strelka

Belka stopped mid-round on the owner's word (out of usage). The work so far
is commit `375f5a35` (`wip(web): …`), **with the browser test red** and **no
gate run**. The file stays in `.tasks/review/` and PR #9 picks up the push.

**Done in `375f5a35` (not yet gated):**
- **Chips clear their neighbours.** `timeline-derive.ts` `placeChips` puts a
  badge inside its block's end where it fits, or centred over a narrower
  block. It draws the badge only if that box clears every other block, every
  badge already placed and both ends of the track; longer blocks go first.
  `Timeline.tsx` measures after every render (and on `loadingdone`) and sets
  `data-chip-place` (`end`/`centre`/`none`). The CSS hides `none` with
  `visibility`. The badge is outside the new `.dayline-block-clip` wrapper,
  so it can be wider than its block. It is `pointer-events: none`, so a click
  on it selects its block. The `row === 0` special case is gone.
- **Labels by height.** `FitLabel` now also checks `scrollHeight` and retries
  on a height change. The top label is `<FitLabel key={rows}>`. The key and
  the figures are `flex-shrink: 0`. The card title gives way first: it is a
  `FitLabel` with `ellipsis`, which tries height only. Three 18px lines never
  fit a 46px body, so the title is now hidden on every single-row block; on
  master it was drawn and clipped.
- **Handles usable or not drawn.** The block is `container: dayline-block /
  size`. Below 1.25rem tall or 0.625rem wide, the edges get `opacity: 0;
  pointer-events: none`, stay focusable for ← and →, and show on
  `:focus-visible`.
- **Stacks from the drag preview** (the optional item).
- **The track is `overflow-x: clip`.** The last hour line (`left: 100%`, 1px)
  made Fit scroll by 1px.
- **Comments.** The `Timeline` doc comment now says the badge shows where it
  clears its neighbours. The test header lists what it measures. `ringReach`
  now also counts a positioned pseudo-element set outside the block, and its
  comment says that inset shadows add nothing.
- **Browser test fixture and checks.** Hour-long blocks at three (k), five (f)
  and eight (g) at once; t1–t3 back to back; h1 with a title; zl standing
  alone; 33 blocks in all. Added: a vertical label-cut check (`scrollHeight`,
  plus outside a clipping ancestor), chips clear the track, handles usable or
  hidden and focusable, a 10px floor for every block except g*, and positive
  controls (zl's chip everywhere; z7, z10 and f1 chips at 2×; h1 and k1
  labels at 1× and 2×).

**Not done:**
1. **The test is red** on one thing: k1's label is missing at 1× and 2×
   (three at once, 18px rows, label `line-height: 1`). Find out why: the
   body's border and rounding against `scrollHeight`, the `key={rows}`
   remount, or `flex-shrink`. Measure; do not guess.
2. **B2 is not started.** Add `stackOf` cases [8:00–8:10, 8:05–8:10,
   8:10–8:15] (the third is `{row 0, rows 1}`) and [10:00–11:00,
   10:05–10:10, 10:10–10:15] (rows 2). Prove they go red under
   `start >= reach` → `>` and `end <= block.start` → `<`, check each edit
   landed, and restore. Add unit tests for `placeChips`.
3. **Where the rule stops, to write up and file** (CHIEF's 800–899 block,
   section 3 sweep re-run just before filing):
   - Down: rows are 60/n − 2 px, so 10px at five at once, 8px at six and
     5.5px at eight. From six at once each block keeps its own row and can
     still be clicked, but labels, chips and handles are not drawn.
   - Across: Chrome hit-tests up to about 0.9px off the boxes it reports at
     390 px (measured on isolated zl too, with or without the clip). So two
     back-to-back five-minute blocks at Fit on a phone, 1.7px each, cannot be
     told apart by a pointer. The browser test skips the centre check only
     for a centre within 1px of a neighbour's box. Get the reviewer to agree
     to that.
   - File the design follow-up: a cap with "+N", a taller row, real lanes, or
     a minimum width at Fit. It should also cover the hidden card title.
4. **The task file's Notes** still say LAI-834 draws its lane "in place of the
   count chip". It keeps the badge: correct that. Record in these notes that
   `375f5a35` now edits the doc paragraph LAI-834 rewrites, so a merge
   conflicts there. Before this change it silently carried "every block
   still shows its counts as a badge" (merged `Timeline.tsx:100-101`).
   Re-run `git merge-tree --write-tree` against `LAI-834-signals-lane`.
5. **Before/after evidence, re-measured on the final fixture.** On the
   pre-rework fixture, the new test failed on `e262f6be` with 48 problems
   (g8's edges drawn too small, zl and z7 lost their chips, h1's label cut,
   t1/t2 covered at 390 Fit) and on master with 3698. The hour-long stacks
   were added after that run, so re-run both, swapping the four source files
   in by name and restoring by checksum.
6. Merge local `master` (`e192c997`, docs only). Run the full gate as in
   CLAUDE.md §5: load under 20, each exit code on its own line. Update
   Cause/Fix here, verify from `git show`, push, `finish_task` with
   `[strelka]`, and report.

## Review round 1 — Strelka's fixes

[strelka] 2026-10-21, on `LAI-860-my-day-timeline-zoom` after `375f5a35`.
The file stays in `.tasks/review/`; PR #9 carries the push.

**1. k1's label at 1× and 2× — measured, then fixed.** A probe on the same
fixture read k1's boxes in the browser. The block is 18px, the body 18px
with a 1px border (16px inside, no padding when stacked), and the label box
had its full 12px line: **not the border or the rounding, and not
`flex-shrink`** (the box was not squeezed). **Not the `key={rows}` remount**
either: k1's `rows` never changes on this fixture. The cause is
`.dayline-stacked .dayline-block-top { line-height: 1 }`: a 12px line box
for JetBrains Mono, whose glyph box is about 16px, so with the label in
place `scrollHeight` was 14 against `clientHeight` 12. FitLabel saw every
option as cut down and left the label out, **whatever the row's height**.
Fix: `line-height: normal`, the font's own line. The label box is then 16px
in a 16px row, `scrollHeight` 16 = `clientHeight` 16, and `LAI-11` is
drawn, at DPR 1 and at DPR 2 (CDP device-scale override; the owner's
MacBook is DPR 2). Proved by mutation: `line-height: 1` put back (edit
checked, file restored by checksum) brings back exactly the eight original
failures, "three at once lost k1's label" at 1× and 2×, both widths, both
themes. The test was not loosened.

A second failure showed up once k1 was drawn, intermittently: "390 px,
light, zoom fit: k1 is covered by …". The test now names what it hit:
`.sidebar-nav`. Below 900px the sidebar is `position: fixed` and slides out
with `transition: transform 160ms` (`sidebar.css`), and the first
measurement after the resize to 390 landed inside those 160ms; k1 is the
leftmost block. The test now waits after each resize until every finite
animation has finished (`settle`), and did not switch motion off. 10 runs of
10 green afterwards, the last under load 29.

**2. B2: `stackOf`'s boundaries, and `placeChips` tested.** Two cases
added: [8:00–8:10, 8:05–8:10, 8:10–8:15] gives rows 2, 2 and `{row 0,
rows 1}`; [10:00–11:00, 10:05–10:10, 10:10–10:15] gives rows 2, the third
taking row 1 again. Seven `placeChips` cases: end where it fits and centre
one pixel short of it, a lone short block keeps its badge, a neighbour
within reach hides it while touching does not, the longer block wins and
the leftmost breaks a tie, both track ends, stacked rows (10px: top badge
drawn; 8px: none), a badge whose block is missing.

Mutations, each edit asserted to match its anchor exactly once and to
change the file's SHA-256 before the run, the file restored and its
checksum (`17c97df1…`) confirmed after each:

| mutation | red |
| --- | --- |
| `block.start >= reach` → `>` | only "a block that starts as a stretch ends begins a new one" |
| `end <= block.start` → `<` | only "a row is free from the minute its block ends" |
| drop the other-blocks check | "not drawn where it would lie over another block…", "in a stack…" |
| drop the longest-first order | "of two badges that would meet…" |
| drop the track-ends check | "not drawn past either end of the track" |
| drop the placed-badges check | "of two badges that would meet…" |
| `crosses` at `>= 0` (touching counts) | "not drawn where it would lie over…; touching is not lying over" |

The first two show the earlier four `stackOf` cases were green under both
boundary mutations, which is the hole B2 named.

**B1: the rules at any depth.** Every check in the browser test (no block,
badge or label over another, no label cut across or down, badges on the
track, handles usable or not drawn and still focusable, each block on top
at its centre and selected by a click there) runs on all 33 blocks,
including the eight-at-once stretch (g1–g8, a 6+ stretch). The 3-, 5- and
8-at-once stretches and the vertical-cut check were in `375f5a35`; round 1
adds that eight at once draw no label, badge or handle, so the write-up
below claims nothing the test does not check.

**Badges where they clear (the lone short block).** `placeChips` draws a
badge whenever its box clears every neighbour. The test's positive controls
hold at every width, theme and zoom: zl (five minutes, nothing near) keeps
`4p 2c`, and at 2× z7, z10 and f1 keep theirs.

**Comments.** `my-day.css` says why a stacked label is `line-height:
normal`; `settle` says what it waits for and why. Re-read against what the
assertions under them check: the test header, `ringReach`, the crowded-centre
skip and the `PAST_THE_FLOOR` and floor comments claim no more than is
asserted. The `Timeline` doc comment (badge "wherever it clears its
neighbours") matches `placeChips`.

**3. Where the rule stops — for the reviewer to agree or not.** Filed as
**LAI-300** (Strelka's block, LAI-300–399, D-097; the handover said CHIEF's
800–899, CLAUDE.md gives Strelka 300–399). Measured on stretches of one to
eight hour-long blocks at 2×, rows are `60 / n − 2` px:

- 1 at once, 58px: label, figures, badge, handles. The card title is not
  drawn (three 18px lines do not fit a 46px body).
- 2 at once, 28px: each label; the top row's badge; handles.
- 3, 18px: each label; the top row's badge; no handles (under 20px).
- 4, 13px, and 5, 10px: the top row's badge only. No labels.
- 6, 8px; 7, 6.6px; 8, 5.5px: the blocks only. Each still has its own row,
  is on top at its centre and is selected by a click there.

**Across:** Chrome hit-tests up to about 0.9px off the boxes it reports at
390px (Belka's measurement, on zl alone, with and without the clip; not
re-measured in round 1). At Fit on a 390px
window five minutes is about 1.7px, so two back-to-back five-minute blocks
cannot be told apart by a pointer. **The browser test skips the "on top at
its centre" check only for a centre within 1px of a neighbour's box**, and
nowhere else. That skip is the one place the test is narrower than the
rule; LAI-300 asks for the design that removes it (a cap with `+N`, a
taller row, real lanes, or a minimum width at Fit) and covers the hidden
card title.

**4. LAI-834.** The Notes are corrected: LAI-834 keeps the badge.
`git merge-tree --write-tree HEAD origin/LAI-834-signals-lane` (HEAD after
merging `origin/master`; LAI-834 at `431193c8`) exits 1 with two
conflicts:

- `server/web/src/routes/screens/my-day/Timeline.tsx`: **the doc paragraph
  only**, lines 101–115 of the merged file. Ours ends "…shows its counts
  as a badge instead … wherever the badge clears its neighbours (LAI-860)";
  LAI-834's says "every block still shows its counts as a badge". Before
  `375f5a35` this merged silently and carried LAI-834's sentence, which is
  no longer true after this fix. Resolve with LAI-834's paragraph and its
  badge sentence ending "…as a badge wherever it clears its neighbours
  (LAI-860)". `my-day.css` and `timeline-derive.ts` merge automatically.
- `docs/DECISIONS.md`: **not ours.** `git merge-tree origin/master
  origin/LAI-834-signals-lane` reports the same conflict without this
  branch; LAI-834 has not merged `master` since D-097.

**5. Before and after, final fixture.** The four source files
(`FitLabel.tsx`, `Timeline.tsx`, `my-day.css`, `timeline-derive.ts`)
swapped in by name from each ref, the test run, the files restored and all
four checksums confirmed after each run:

| code | problems | Fit | 1× | 2× | 1440px | 390px |
| --- | --- | --- | --- | --- | --- | --- |
| `origin/master` (6b8cd862) | **3868** | 1820 | 1012 | 1036 | 1752 | 2116 |
| `e262f6be` | **264** | 16 | 120 | 128 | 132 | 132 |
| final | **0** | | | | | |

On master: 1624 badge over a block, 1072 badge into badge, 540 block over
block, 312 labels cut, 96 + 96 + 12 eight-at-once blocks drawing labels,
badges, handles, 48 handles out, 25 clicks selecting the wrong block, 24
rings past their block, 16 badges off the track, 3 covered at the centre.
On `e262f6be`: 132 labels cut, 64 eight-at-once labels, 24 handles drawn
too small, 12 zl lost its badge, 12 eight-at-once handles, 8 badges over a
block, 8 eight-at-once badges, 4 lost badges with room. **The counts come
from the assertion's indexed listing**: the `+` diff above it is truncated
by node and showed 844 and 124.

**6. Merged `origin/master`** (`6b8cd862`, docs only, no conflict) with
`git merge origin/master`, not the local `master`.

**7. PR #9's red CI run, and the merge of `origin/master`** ([strelka]
2026-10-22). GitHub run 39603271201 on `14f4681c` failed on this test alone,
"three at once lost k1's label" at 1× and 2×, both widths, both themes:
exactly item 1, whose fix (`d8d32758`) was committed but never pushed. No
other failure in that run. Merged `origin/master` (`28cf1877`, 115 commits,
LAI-834 among them) with `git merge origin/master`: one conflict, the
`Timeline` doc paragraph, resolved as item 4 says (LAI-834's paragraph, its
badge sentence ending "wherever it clears its neighbours (CHIEF's addition
G, LAI-860)"). `my-day.css` and `timeline-derive.ts` merged automatically.

**Gate** (repo root, on `92d4e1a3`, the merge, under
`/tmp/laika-root-gate.lock`, each command to its own file):

- Run 1, load 5: `node --test test/browser/my-day-timeline-zoom.test.ts`
  (server/web) exit 0; `pnpm test` **exit 1**, on one case only:
  `server/test/services/sprints.test.ts` "is exact past the page size…"
  timed out at 5000ms. That is LAI-304's known flake (server, untouched by
  this branch). `pnpm lint` exit 0, `pnpm format` exit 0.
- That file alone (`pnpm exec vitest run test/services/sprints.test.ts`,
  server/, load 42): exit 0, 43 passed.
- Run 2, load 13: the browser test exit 0; `pnpm test` **exit 0** (server
  3411 passed, 10 skipped; server/web pass 2777 fail 0; cli pass 551 fail
  0); `pnpm lint` exit 0; `pnpm format` exit 0.

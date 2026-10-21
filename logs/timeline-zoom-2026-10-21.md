## 2026-10-21T11:43:00Z — LAI-860

A Claude Code builder worked this task in the worktree `Laika-timeline-zoom`,
on branch `LAI-860-my-day-timeline-zoom`, dispatched by CHIEF on the owner's
direct instruction ("UI is little bit broken here when I switch 2x and 1x").
Board card LAIKA-659.

**What changed**
- server/web/src/routes/screens/my-day/timeline-derive.ts — `stackOf`: blocks
  at the same time take a row each of the lane's height; a block nothing
  overlaps keeps the whole height.
- server/web/src/routes/screens/my-day/Timeline.tsx — reads `stackOf` into
  `--row`/`--rows`; the label and the count chip are `FitLabel`s (`cutsOf`
  cuts a label after a whole word); only a stretch's top row has a chip.
- server/web/src/routes/screens/my-day/my-day.css — rows from `--row`/`--rows`;
  the block clipped across to its own width; the selected ring an inset
  shadow on `::after`; edge handles inside the block; the chip a box inside
  its block's width with the badge drawn by `FitLabel`'s span. No token or
  colour changed.
- server/web/test/browser/my-day-timeline-zoom.test.ts — new. Boxes of every
  block, chip, label, ring and handle on a day shaped like the owner's screen,
  at 1440 and 390 px, light and dark, Fit/1×/2×; clicks the three blocks at
  once at their centres. 814 problems on master's code, none after.
- server/web/test/routes/screens/my-day/timeline-derive.test.ts — four
  `stackOf` cases.
- .tasks/review/LAI-860-my-day-timeline-zoom-overlap.md — cause, fix,
  verification and review notes on LAI-834.
- .tasks/backlog/LAI-861-my-day-signals-lane-fit-overlap.md — filed.

**Decisions**
- Blocks at the same time share the YOU row in rows, rather than filing a
  design task for lanes and only "fixing the overlap". A row inside the row
  that already exists adds no lane, label or colour, and it is the smallest
  rule that lets each block be seen and clicked. The third criterion's
  file-it branch was for a design change, and this is not one.
- A chip that does not fit is hidden, not shortened. `0p 13c` → `13c` was
  possible, but it reads as a different badge, and the inspector has the
  counts either way.
- The chip's box spans its block's width and the badge is `FitLabel`'s inner
  span, rather than `FitLabel` measuring the badge itself. A shrink-to-fit
  badge that has chosen "nothing" never changes width again, so `FitLabel`'s
  ResizeObserver would never retry it at a wider zoom.
- The CSS edits stop two lines short of where LAI-834 inserts its lane rules,
  and the new badge rule sits above `.dayline-signals` rather than below it.
  That is why `git merge-tree` with `LAI-834-signals-lane` comes out clean.
- The `Timeline` doc comment ("each block shows its counts as a badge") is
  left for LAI-834 to correct, because LAI-834 rewrites that paragraph. It is
  flagged in the review notes.

**Discovered**
- At Fit a five-minute block (3.8 px at 1440) is narrower than its body
  button's padding and border, which cannot shrink below about 18 px. So the
  body painted over the next blocks, and a selected one covered them. Found
  with `elementFromPoint` after the other four fixes were in; `overflow-x:
  clip` on the block fixes it and leaves the badge on its top edge.
- My first browser test aimed its clicks at the body button's centre, which
  is outside the clipped block at Fit. It now aims at the block's own box,
  which is what a reader clicks.
- The wider-font case in `my-day-v2.test.ts:950` failed once in a combined
  run of four My day files, cutting `1:00–2:50 PM · 1 h 50 min` at 1440,
  folded=false. That is LAI-846's recorded flake, the same text on master
  with no My day edits. It passed 3 of 3 runs alone.
- LAI-834's SIGNALS lane overlaps at Fit: 7 px prompt dots on 3.8 px slots,
  and at 390 px its 2 px ticks touch. Clear at 1× and 2× → LAI-861 filed
  (discovered-from: LAI-860).
- The live repro's axis labelled the hours in the browser's zone (IST) for a
  `tz: UTC` day. Blocks and hours agreed with each other, so nothing was
  misplaced. Not chased.

**State**
Moved to .tasks/review/. Verified: the new browser test, the four
`timeline-derive` cases, web typecheck, and the trial merge with LAI-834
(5 of 5 My day tests pass there). The repo-root gate runs after this commit;
its three exit codes are in the PR body and on LAIKA-659.

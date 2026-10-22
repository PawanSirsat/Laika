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

## 2026-10-21T11:50:00Z — LAI-860 (gate, run 1)

**What changed**
- server/web/src/routes/screens/my-day/my-day.css — `--row: 0; --rows: 1;`
  declared on `.dayline-block`, so `tokens.test.ts` finds them defined; the
  inline style still sets them per block.
- .tasks/review/LAI-860-my-day-timeline-zoom-overlap.md — the fix and gate
  run 1 recorded.

**Decisions**
- Declared the defaults rather than exempting the two names from the token
  check: the check is right that a `var()` with nothing behind it in any
  stylesheet is how a misspelt token hides.

**Discovered**
- Root gate run 1 (`pnpm test`, exit 1) also failed the wider-font case at
  `my-day-v2.test.ts:950`, which is LAI-846's recorded flake. It passed alone
  three times. This fix adds `FitLabel`s, so it may lose that resize race
  more often under load. The race belongs to the test and to LAI-846; noted
  there in the review notes, not filed again.

**State**
In review; root gate re-run after this commit, exit codes in the PR body and
on LAIKA-659.

## 2026-10-21T13:35:00Z — LAI-860 (review round 1, [strelka])

[strelka] Took over from Belka mid-round (HANDOVER, `logs/chief-2026-10-21.md`
on origin/master) in the worktree `Laika-860`, branch
`LAI-860-my-day-timeline-zoom`, from `14f4681c`.

**What changed**
- server/web/src/routes/screens/my-day/my-day.css — a stacked label is
  `line-height: normal`, not `1`: the 12px line box under 16px glyphs made
  `scrollHeight` exceed `clientHeight` on every stacked block, so FitLabel
  hid k1's label at any row height (measured, DPR 1 and 2).
- server/web/test/browser/my-day-timeline-zoom.test.ts — `settle` waits out
  the sidebar's 160ms slide-out after each resize (it covered k1 at 390px,
  intermittently); a covered block names what covers it; eight at once
  asserted to draw no label, badge or handle.
- server/web/test/routes/screens/my-day/timeline-derive.test.ts — two
  `stackOf` boundary cases (B2) and seven `placeChips` cases.
- .tasks/backlog/LAI-300-my-day-timeline-crowded-stretches.md — the design
  follow-up: four or more at once, and blocks too narrow to point at.
- .tasks/review/LAI-860-my-day-timeline-zoom-overlap.md — Notes on LAI-834
  corrected; Fix and Verification updated; "Review round 1 — Strelka's
  fixes" with the evidence.
- Merged `origin/master` (`6b8cd862`), not the local `master`.

**Decisions**
- Fixed k1 with the font's own line height rather than loosening FitLabel's
  or the test's `scrollHeight` check: the check is what found it, and a
  label whose glyph box overflows its line can lose its descenders.
- Waited for the sidebar's transition to finish rather than emulating
  reduced motion, so nothing the Timeline animates is hidden from the test.
- Filed from LAI-300, Strelka's block (D-097), not CHIEF's 800–899 as the
  handover said; CLAUDE.md gives Strelka 300–399, and the §3 sweep (every
  local and `origin/*` ref, both `git log` halves) found no 3xx id in use.
- The 0.9px hit-test slop at 390px is Belka's measurement; I did not
  re-measure it and the task file says so.

**Discovered**
- Node's assertion diff truncates a long array: the before counts read 844
  (master) and 124 (`e262f6be`) from the `+` lines, and are really 3868 and
  264 from the indexed listing. Recorded in the task file; the §5 "a
  truncated answer looks complete" rule, met in a test runner.
- Labels go from four at once, not six as the handover's notes put it
  (probe on stretches of one to eight). Written into LAI-300.
- `git merge-tree` against LAI-834 now conflicts on the `Timeline` doc
  paragraph (expected) and on `docs/DECISIONS.md`, which conflicts between
  `origin/master` and LAI-834 without this branch; not ours.
- This worktree had no `node_modules`; `pnpm install --frozen-lockfile`
  added nothing to the lockfile.

**State**
In review on PR #9; gate result in the task file's round-1 section. Laika
`finish_task` left to polly after cross-review, as instructed.

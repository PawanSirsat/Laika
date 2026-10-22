---
id: LAI-888
title: "My day to the owner's \"Laika App v3\" design"
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-22T10:14:46Z
finished: 2026-10-22T10:57:32Z
---

## Goal

My day (`/my-day`) is laid out and styled as the owner's **Laika App v3**
design (Claude Design project *UI Reorganization and Simplification*,
`1af73506-d3bf-4636-807b-46695bf84eb4`, files `Laika App v3.dc.html`,
`Timeline.dc.html` and `timeline-core.js`, imported to `docs/design/` by
this task). The data, the API calls and every action the page already has
stay; what changes is the shape: the Timeline becomes a card of its own with
the day's totals in its header, a labelled column for SIGNALS / YOU / AGENTS
with their figures, hours along the top, a footer of keys, a hover tooltip,
and Fit folding idle stretches; the editor, the two lists, the Add time form
and the two side cards take the design's rows, pills and columns.

## Acceptance criteria

- [x] `docs/design/` carries `Laika App v3.dc.html`, `Timeline.dc.html` and
      `timeline-core.js`, byte for byte as fetched from the project, and
      `README.md` says which screen they are the reference for. `support.js`
      is unchanged (checksum equal).
- [x] **Timeline card.** Header: *Timeline* and the day; a legend of
      Confirmed, Drafted, Needs a card and Gaps **with the day's minutes
      beside each** (every figure from the response; Gaps opens the first
      gap); ‹ · Now · › moving the selection between blocks; Fit / 1× / 2×.
      Hours are labelled along the **top** of the track; a lane column on the
      left names SIGNALS (with the day's prompt and commit totals), YOU (hours
      of work, and how much is confirmed) and AGENTS (the agent's minutes,
      *Beside your day. Never added to your hours.*). On today, the time after
      now is shaded and the now line carries its clock. A footer lists the keys
      (← → ↵ G X Esc) and, with a block selected, says *Editing … below ↓*.
- [x] **Blocks** are drawn as the design's: an icon chip (✓ ✎ ? + ‖ ×) and
      the key or word on the first line, the card's title when the block is
      wide enough, and the range and length on a mono line — each line only
      where it fits, as `FitLabel` already decides. Blocks at the same time
      still take a row each (`stackOf`). Hovering a block, a gap, a signal
      bucket or an agent run shows a dark tooltip with its kind, its time and
      length, and its counts — **counts only**, never a prompt's text.
- [x] **Fit** folds every idle stretch of 45 minutes or more at either end of
      the day (before the first block, after the last block or now) into a
      hatched 92px segment that says *No activity* and its span; the lane
      column says *Idle hours folded*. 1× and 2× are linear. The selection,
      the gaps, the breaks, the edge handles, the now line, the SIGNALS and
      AGENTS lanes, the no-signal notice, the untimed count and the keys all
      keep working at every zoom, in both themes, at 1440 and 390 px.
- [x] **Editor** (the inspector): a state pill with its icon, the range in
      mono at the heading size, the source line, *Not work* and the confirm
      button in the head; CARD / LENGTH / DRAFTED FROM (or BUILT FROM) as
      three columns that stack on a narrow page; the counts as tiles —
      prompts, commits, marks, **and agents** (runs on the AGENTS lane that
      overlap the block) — and a line saying how long an agent worked in that
      time. Everything the inspector does today (Split in two, a typed
      length, General, Other card…, Delete, Note, History, a gap's Add time
      here and Mark as break, a break's Not a break) still does it.
- [x] **To settle**: the bulk actions (N selected · Confirm · General · Not
      work · Clear) sit in the card's header once anything is ticked; each row
      has a state swatch, the range, the length, the card and its title, and a
      source pill. **Confirmed**: each row has a solid swatch, the range, the
      length, the key, title and note, and a source pill; *Add time* at its
      foot on the quiet background with the lengths, the card chips, the note
      field and *Add …*. Paging, Shift-select, select-all, Undo and the batch
      progress are unchanged.
- [x] **Side**: *Agent time* — the total, the design's line, one bar a card
      with its minutes, keyboard minutes beneath; *On your plate* as today
      with the design's group heads (dot · label · count · link →).
- [x] The week strip keeps *previous*, *next* and *Today* (SPEC §11.4.2) and
      restyles its tiles to the design's.
- [x] No demo data, no hardcoded figure, no colour literal in
      `server/web/src/routes/screens/my-day/` (`theme-single-source.test.ts`
      stays green); the fonts stay self-hosted.
- [x] Every browser and unit test under `server/web/test/browser/my-day*` and
      `server/web/test/routes/screens/my-day/` is green against the new
      layout — updated where it measured the old one (the stats strip, the
      axis at the foot, 110 px an hour) and extended for the new (the legend
      figures, the top axis, the folded stretch at Fit, the tooltip, the
      agents tile).
- [x] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Filed and built by CHIEF on the owner's direct instruction
  (*"implement this v3 in /My day page"*, 2026-10-22), in the temporary
  worktree `Laika-myday-v3` on `LAI-888-my-day-v3`, as LAI-858 and LAI-860
  were.
- Files: `server/web/src/routes/screens/my-day/` and its tests; `docs/design/`
  for the import only. No new dependencies.
- What the design has that the server does not, and so is **left out**: a
  shared hour's split between cards (`shares`, the split footer) — the server
  has no such field; agent **names** per run — `agent.lane` carries seconds
  and whether on a card, nothing more (LAI-835 is in review for names on a
  proposal); *marks* per five minutes — `signal_times` has prompts and
  commits only, so the SIGNALS lane draws those two and the marks figure
  appears in the editor's tiles from the block's counts. Each is noted in the
  code where the design has it.
- The toast stays at the foot of the screen with Undo (LAI-831); the design's
  inline bar has no Undo.
- The per-block count badge of LAI-860 stays as it is; LAI-881 is unaffected.

## Record

- Gate at `53de0a09` on `LAI-888-my-day-v3`: repo-root `pnpm test` 0,
  `pnpm lint` 0, `pnpm format` 0. The My day browser files: 74 tests, all
  green, the LAI-860 zoom suite included.
- The design files' checksums as fetched: `Laika App v3.dc.html`
  `0fd028bfe48713ccd9d07f050e6a392b`, `Timeline.dc.html`
  `75dba641040922d679a88f5f02d5cf00`; `support.js` unchanged
  (`951ae391b8ae72ef12e671c2fad23353`).
- Two things the tests found that a screenshot did not, both in
  `logs/myday-v3-2026-10-22.md`: a label box that sizes to its own words
  makes `FitLabel` re-try for ever, and a 92px fold on a phone can cost more
  than the stretch it replaces, so a fold now happens only where it makes
  room (`buildScale`).
- Not in this task, by the Notes: the shared-hour split, agent names on a
  run, marks per five minutes, the design's inline toast.
- **Renumbered from LAI-883 on 2026-10-22**, before the merge: the id was
  taken from a sweep that had not fetched `origin` first (D-097 item 3), and
  the other machine had meanwhile pushed five filings renumbered onto
  LAI-883 to LAI-887. This filing was the earlier one by half an hour, but
  those five were already on `origin/master`, so this one moved. **The
  eight commits of this task carry `[LAI-883]`** in their messages, and the
  branch is `LAI-883-my-day-v3`; §4 forbids rewriting them, so they stand,
  and `LAI-883` (*owners see every project*) records that those commits are
  not its own. The board card LAIKA-692 carries `LAI-888`.


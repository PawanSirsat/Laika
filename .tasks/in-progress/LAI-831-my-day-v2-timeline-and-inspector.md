---
id: LAI-831
title: 'My day v2: build the owner''s "Laika App v2" design (week strip, lane timeline with gaps, inspector, To settle and Confirmed lists, Add time into a gap) plus CHIEF''s additions'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-810
status: in-progress
started: 2026-10-20T19:53:15Z
---

## Goal

My day looks and works like the owner's design. Owner, 2026-10-21, sending
`Laika App v2.html`:

> *"analyze the My day page design and features … I like the design; if you
> want to add more features you can, if you have good ideas do it"*

**The reference** is `/tmp/laika-myday-v2/Laika App v2.html` (a copy of
`~/Downloads/Laika App v2.html`, 2026-10-21 01:15). Open it in a browser. The
My day markup sits in the `__bundler/template` script, and its behaviour is in
`myDay()`. It is a mockup: copy its **layout, states and behaviour**, never its
markup, inline styles or data (CLAUDE.md §5.1). The current screen is
`server/web/src/routes/screens/my-day/` (LAI-810).

Made on the owner's direct instruction. One agent may do any area this needs,
web and server, and must say in the task file which server files it touched.

## What the design contains (CHIEF's reading; the census below decides what is new)

1. **Header.** "My day", the date ("Wednesday 21 October · today") and a lock
   reading "Only you see drafts". The **Draft my time** switch sits in the
   header. The primary button reads **Confirm day · <total>**, or **Confirm N
   ready · <total>** when some drafts still need a card. Its tooltip says how
   many are left out.
2. **Week strip.** Seven day tiles. Each tile shows:
   - the day name and date, with a red dot on today;
   - the day's total;
   - a bar in two parts: confirmed (solid) and drafted (striped);
   - a state label: *Not yet* (future, faded), *No signal* (hatched), *N to
     settle* or *Settled*.

   Clicking a tile opens that day.
3. **Stats strip.** CONFIRMED ("others can see this"), TO SETTLE ("N drafted
   blocks · only you"), GAPS ("N unaccounted · click to fill") and AGENT
   ("beside the day, not in it").
4. **Lane timeline.**
   - **Lanes.** SIGNALS (prompts as dots, commits as ticks). YOU: confirmed
     blocks are solid, drafted are dashed purple, blocks that need a card are
     dashed amber, and gaps of 20 minutes or more are dashed and clickable,
     labelled "+ <length>". AGENTS: agent working time, grey when it is not
     tied to a card.
   - **Controls.** A red "now" line with its time. Hour axis 6 AM–10 PM, with
     12 PM emphasised. Zoom: Fit, 1× and 2×. Earlier / Now / Later buttons,
     sideways scroll, and on open it scrolls to the first block.
   - **Other states.** A legend row. A *No signal* day is hatched and reads
     "No signal — nothing reached Laika from your machine. That is not zero
     hours; add what you worked below." A future day reads "This day has not
     happened yet."
5. **Inspector** for the selected block.
   - **Drafted.**
     - Range, source ("From your collector" or "Proposed by claude-code"),
       **Not work** and **Confirm <length>**. The button reads "Needs a card"
       and is disabled until a card or General is chosen.
     - **CARD:** a warning when no card is set, or when a named card cannot be
       read, then card chips plus General.
     - **LENGTH:** −/+ in 5-minute steps, and **Split in two**.
     - **DRAFTED FROM:** prompts, sessions, commits and marks, with the line
       "Counts only — never what you typed, file names or commit messages."
     - A key hint row: ↵ confirm, G general, X not work, J/K next and previous.
   - **Confirmed.** Range, source · rev N, **Delete**, card chips and −/+.
     "Every edit is kept as a revision."
6. **To settle** list.
   - A select-all checkbox (with a mixed state), the count and total.
   - With rows checked: bulk **Confirm / General / Not work**. Rows that still
     need a card are left out of a bulk confirm, stay checked, and are counted
     in the toast. With nothing checked, the hint reads "N need a card".
   - Each row shows a checkbox, range, length, card key or *General* or *Needs
     a card*, a title line, and a source badge (claude-code or collector).
     Clicking a row selects it.
7. **Confirmed** list.
   - Rows show range, length, key + title + note, source (*From draft* or
     *Typed*) and rev N. The header reads "the only time anyone else can see".
   - **Add time** footer: "a meeting, a call — confirmed as you add it".
     - A slot chip ("At 2:29–2:48 PM ×") appears after clicking a gap.
       Otherwise "No set time — or click a gap on the timeline".
     - Length chips 15m / 30m / 45m / 1 h / 1 h 30 min, card chips with
       General, a note field, and **Add <length>**.
8. **Right column** (sticky).
   - **Agent minutes:** per card bars, then "At your keyboard in Claude Code
     N min".
   - **On your plate:** In progress (Board →), Waiting on your review
     (Inbox →, with proof state lines) and Blocked.
9. **Toasts** for every action, dark, with a close button.

## CHIEF's additions (the owner invited them)

- **A. Times and durations follow LAI-830, not the mockup.** Clock times are
  12-hour with AM/PM, as the mockup already does. Durations print **"19 min",
  "1 h 35 min"**, never "1:35": the owner called h:mm confusing on this very
  screen. Use LAI-830's shared helpers (see Notes).
- **B. Undo.** Every toast for confirm, bulk confirm, General, Not work,
  delete, split and add offers **Undo** for about 10 seconds. Undo restores
  exactly the previous state on the server.
- **C. Drag to adjust.** On the timeline, dragging either edge of a block (drafted
  or confirmed) moves its start or end in 5-minute steps. −/+ stays. A drag
  on a confirmed block is one revision.
- **D. Gaps you can wave away.** A gap can be marked **Break**, so it stops
  counting under GAPS and stops showing "+". This is stored per person and
  day. If no server field exists, add the smallest one with a migration and
  record it in the task file. Breaks never count as time.
- **E. Other weeks.** Previous and next week arrows on the week strip, and a
  week total. Never show a target or a score: per-person hours are not
  scored (Organisation → Time).
- **F. Safe off switch.** Turning **Draft my time** off asks first: "Turn
  off? This deletes N drafts you hold (H h M min). Confirmed time stays." It
  does not delete silently as the mockup does.
- **G. Honest signals.** Dots and ticks are drawn only where real timestamps
  exist. If the server only has counts for a block, show the counts as a
  small badge on the block, and do not spread invented dots evenly as the
  mockup does. Say which case applies in the task file.
- **H. `?` opens a shortcut sheet.** Shortcuts never fire while typing in a
  field.
- **I. Phone (390 px).** The week strip scrolls sideways, the inspector
  stacks, the right column moves below, and the timeline scrolls without
  scrolling the page.

## Acceptance criteria

- [ ] **Census first, in the task file.** For every numbered item and every
      addition above, record: already live (with file), changed or new; and
      which endpoint provides its data. Anything with no data source is
      **filed as its own task and left out**. Do not stub it (§5.1, D-032).
- [ ] Everything in sections 1–9 and A–I is built, except items the census
      filed. Every number, name, key and count comes from an API response,
      and no mockup data (LAIKA-381, "Standup", 4:50 PM …) appears in the
      code or the bundle.
- [ ] **Privacy holds.** Drafts are only ever visible to their owner. The
      inspector shows counts only. No prompt text, file names, branches or
      commit messages are fetched or shown.
- [ ] Both themes, at 1440, 1024 and 390 px, and with the sidebar folded or
      open. No overflow, no clipped text and no page-wide horizontal scroll.
      Sizes come from type tokens (LAI-828 will raise the scale).
- [ ] **Keyboard.** ↵ / G / X / J / K / ? work on the selected draft and never
      fire while typing. Focus is visible, and every control is reachable by
      Tab.
- [ ] **Tests**, each failing on today's code:
      - week strip states and navigation;
      - gap detection, and Break;
      - confirm or bulk confirm leaving out drafts that need a card;
      - split, ± and drag (5-minute snap, revision count);
      - Undo restoring server state;
      - the off switch asking first;
      - Add time into a picked gap;
      - shortcuts not firing in inputs;
      - no mockup string in the built bundle;
      - and, for any server change, a route test with `can()` and the
        owner-only rule.
- [ ] **Screenshots**, before and after, light and dark, 1440 and 390: a
      drafted day, a settled day, a No signal day, a future day, the inspector
      for both kinds, and bulk selection. Save them to `/tmp/laika-myday-shots/`.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- **LAI-830** (12-hour clock and plain durations) is being built now and lands
  on `master` first. Do not write your own time or duration formatter. Merge
  `master` before finishing and use LAI-830's helpers. If it has not landed
  when you reach display text, keep every format call behind one local module
  and point that module at the shared helpers after the merge.
- **LAI-827** (task panel editor) and **LAI-828** (type scale) are also in
  flight. Touch neither's files.
- **"Waiting on your review"** uses the server's count. If the server says the
  count is capped, show "200+" (LAI-820).
- No new dependencies.

## Census (the builder, 2026-10-20, before any code)

Read against `server/web/src/routes/screens/my-day/` at `0f9c3cbd` (LAI-810)
and `server/src/services/{my-day,time-drafts,time-entries}.ts`. **live** = on
the screen today (file), **changed** = there but reshaped, **new** = not there.
Every endpoint named is `/api/v1`. `GET /me/time` is "the day" below.

| # | Item | State | Data from |
| --- | --- | --- | --- |
| 1 | Title *My day*, the date | live (`MyDayScreen.tsx`, `ScreenHeader`); date gains "· today" | the day: `day`, `today` |
| 1 | "Only you see drafts" lock | new (fixed words) | — |
| 1 | *Draft my time* switch in the header | changed: moved from the side column (`DraftMyTime.tsx`) | `GET`/`PUT /me/time-settings`, the day's `settings` |
| 1 | *Confirm day · total* / *Confirm N ready · total*, tooltip | live (`MyDayScreen.tsx`, `draft-bulk.ts` `confirmPlan`) | `POST /me/time/days/:day/confirm`, `POST /me/time-drafts/:id/confirm` |
| 2 | Seven tiles, name and date, click opens the day | live (`WeekStrip.tsx`) | the day's `week[]` |
| 2 | Red dot on today | new | `today` |
| 2 | Day total | live (`weekCell`) | `week[].confirmed_minutes + drafted_minutes` |
| 2 | Two-part bar, confirmed solid and drafted striped | new | `week[].confirmed_minutes`, `drafted_minutes` |
| 2 | *Not yet* / *No signal* (hatched) / *N to settle* / *Settled* | changed (was *Drafted* / *Confirmed*); "N" is minutes, the only per-day figure served | `week[].state`, `drafted_minutes` |
| 3 | CONFIRMED · TO SETTLE · GAPS · AGENT strip | new | `entries[]`, `drafts[]`, derived gaps, `agent.minutes` |
| 4 | SIGNALS lane: prompts as dots, commits as ticks | **filed, left out — LAI-834**: a block carries counts only, no timestamp (`time_drafts.signals`). G's badge is drawn instead | — |
| 4 | YOU lane: confirmed solid, drafted dashed purple | changed (`DayBar.tsx`, a thin bar) | `entries[]`, `drafts[]` spans |
| 4 | YOU lane: needs-a-card dashed amber | new | `drafts[]` with no task, project or General |
| 4 | YOU lane: gaps ≥ 20 min, dashed, "+ length", click to fill | new, derived on the client from the spans | `entries[]`, `drafts[]`, `breaks[]` (D) |
| 4 | AGENTS lane: agent working time, grey when on no card | **filed, left out — LAI-833**: `agent_time_days` holds seconds per session per day, never a time of day. Agent minutes stay in the right column | — |
| 4 | Now line with its time | live (line, `DayBar.tsx`); the time label new | `today`, the clock |
| 4 | Axis 6 AM–10 PM, 12 PM emphasised | changed (was 08–18, 24-hour); widens to any block outside it | — |
| 4 | Zoom Fit / 1× / 2×, Earlier / Now / Later, sideways scroll, open on first block | new | — |
| 4 | Legend; *No signal* hatched sentence; future sentence | changed / changed / live | the day's `state` |
| 5 | Inspector, drafted: range, source line, *Not work*, *Confirm length* / disabled *Needs a card* | new (replaces the row's "⋯" menu, `DraftRow.tsx`) | `drafts[]`; `POST …/dismiss`, `POST …/confirm` |
| 5 | Source "Proposed by claude-code" | changed: "Proposed by an agent". **The name is filed — LAI-835**: a draft carries `source: 'agent'` and no client | `drafts[].source` |
| 5 | CARD: warning (no card / a key you cannot read), chips + General | new; chips are the reader's own cards in progress (what *On your plate* already reads) and the block's own, plus *Other card…* by key | `GET /projects/:slug/tasks?assignee=&status=in_progress`; `drafts[].task_key`; `PATCH /me/time-drafts/:id` |
| 5 | LENGTH −/+ (5 min), *Split in two* | changed: minutes were a typed form; split was a typed time | `PATCH /me/time-drafts/:id` (**server: span, C**), `POST …/split` |
| 5 | DRAFTED FROM counts, "Counts only — …" | changed (was one line of evidence) | `drafts[].signals` |
| 5 | Key hint row | new | — |
| 5 | Inspector, confirmed: range, source · rev N, *Delete*, chips, −/+, "Every edit is kept as a revision." | new (replaces `EntryRow.tsx`'s menu; History kept) | `entries[]`; `PATCH`/`DELETE /me/time-entries/:id`, `GET …/revisions` |
| 6 | *To settle*: select-all with mixed state, count and total | live (`DraftList.tsx`, LAI-810) | `drafts[]` |
| 6 | Bulk Confirm / General / Not work; needs-a-card left out, kept checked, counted | live (`draft-bulk.ts` `runBulk`); its report becomes the toast | `POST …/confirm`, `PATCH …`, `POST …/dismiss`, one block each |
| 6 | Rows: box, range, length, key / General / *Needs a card*, title line, source badge, click selects | changed (title line, badge and click-to-select new) | `drafts[]` |
| 7 | *Confirmed* list: range, length, key + title + note, *From draft* / *Typed*, rev N; header line | changed (`EntryList.tsx`) | `entries[]` |
| 7 | Add time: slot chip from a gap, or "No set time — …" | new | `POST /me/time-entries` with `started_at`/`ended_at` (already accepted) |
| 7 | Length chips 15m … 1 h 30 min, card chips + General, note, *Add length* | changed (`AddTimeForm.tsx` was typed fields); a typed length stays | `POST /me/time-entries` |
| 8 | Agent minutes: per-card bars, then keyboard minutes | changed (`AgentStrip.tsx`, a list) | `agent.by_task`, `unattributed_minutes`, `keyboard_minutes` |
| 8 | On your plate: In progress (Board →), Waiting (Inbox →, proof lines), Blocked | live (`OnYourPlate.tsx`); *Board →* new; "200+" when `truncated` new | `GET /projects/:slug/tasks`, `GET /review` (`truncated`) |
| 8 | Right column sticky | new | — |
| 9 | Dark toasts with a close button | new (replaces the batch line and the error paragraph) | — |
| A | 12-hour clock, durations "19 min" / "1 h 35 min" | changed; every call goes through `my-day/format.ts`, pointed at LAI-830's helpers once it lands | — |
| B | Undo on confirm, bulk confirm, General, Not work, delete, split, add | new. **Server**: nothing could restore a held block's collector, a split's original or a confirmed draft; see *Server changes* | `POST /me/time/undo` (new) |
| C | Drag a block's edge, 5-min snap; confirmed = one revision | new. **Server**: neither `PATCH` took a start or an end | `PATCH /me/time-drafts/:id`, `PATCH /me/time-entries/:id` (+ `started_at`, `ended_at`) |
| D | Break: a gap waved away, per person and day, never counted | new. **Server**: no field existed | `breaks[]` in the day; `POST /me/time-breaks`, `DELETE /me/time-breaks/:id` (new) |
| E | Previous / next week, week total, no target or score | arrows live (`WeekStrip.tsx`); week total new; bars scale to the week's busiest day, never to a fixed day length | `week[]` |
| F | Off asks first: "This deletes N drafts you hold (H h M min)" | new. **Server**: the day carried one day's drafts; `DELETE /me/time-drafts` deletes every day's | `drafts_held` in the day (new) |
| G | Honest signals | **the counts case applies**: the server holds counts per block and no timestamp, so each block shows a small count badge and nothing is spread along it | `drafts[].signals` |
| H | `?` opens a shortcut sheet; nothing fires while typing | new | — |
| I | 390 px: week scrolls sideways, inspector stacks, column below, timeline scrolls alone | changed (`my-day.css`) | — |

**Filed and left out** (each from CHIEF's block, `discovered-from: LAI-831`):
LAI-833 (agent time has no time of day), LAI-834 (signals have no
timestamps), LAI-835 (a proposal does not name its agent), and LAI-836 (SPEC
§4 and §6.4 for the server additions below — CHIEF's area; the two new
tables carry a `TABLES_NOT_IN_SPEC` exemption naming it until then).

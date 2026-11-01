---
id: LAI-515
title: 'My day: the editor''s contents as designed — the head, the section order, Add time''s date tiles and time-range bar, the gap editor, the task search with reasons, HISTORY and Delete entry on a confirmed entry, the break and not-work editors, the timer-stopped banner, the overlap error'
area: web
assignee: chief
priority: p1
depends-on: [LAI-511]
discovered-from: LAI-888
status: done
started: 2026-10-25T01:20:00Z
finished: 2026-10-25T08:28:07Z
---

## Goal

LAI-504 built the editor from an earlier `MyDay.dc.html`; beside the current
one on 2026-10-24 the order of sections, the head, the Add time fields and
the per-state editors still differ. Master also has a defect: in Add time
the *No set time* label wraps vertically into OFF-SCREEN WORK.

## Acceptance criteria

- [ ] Head: the state pill with its icon (✎ Draft, ? No task yet, ✓
      Confirmed, ‖ Personal break, × Not work time, + New entry, + Gap);
      *Saved ✓* with *Undo* after a change; `5 of 8 ‹ ›` on drafts, `Gap 3 of
      3 ‹ ›` on gaps; ×. Then the mono key and the title at 17px, and the
      sub line `1:45–2:25 PM · 40 min · Drafted by your collector · only you
      see it` (confirmed: *owners and admins can see it*; break: *not counted
      in your hours*; not work: *not counted*; read-only: *Dana's entry*).
- [x] Section order WHEN · OFF-SCREEN WORK (Add time only) · TASK · KIND ·
      WHAT IT WAS · SPLIT · DRAFTED FROM / BUILT FROM · note · HISTORY; the
      footer fixed at the bottom. The length stepper, *? all keys* and the
      second *Counts only* line go.
- [x] WHEN: Start / End / Length mono fields with the design's hint; on a
      typed End that overlaps confirmed time the field turns red with
      *Overlaps LAI-860, 12:30–1:30 PM. Confirmed time can't overlap.*
- [x] Add time: *No set time* checkbox at the right of WHEN; seven date
      tiles (weekday + mono date; future days disabled with their tip; a
      past day adds a confirmed entry on that day); chips 15m 30m 45m 1h
      1h 30 2h and *Ends now*; the time-range bar 8 AM–8 PM with the day's
      busy time in grey, the now line in red, the violet range that drags
      and places by click; the two hints. The *No set time* defect is gone.
- [x] OFF-SCREEN WORK: *Time Laika can't see. One tap sets the kind and
      title.* and the six pill presets (14px radius).
- [x] TASK: the current task line (mono key + title, or *Shows as Meeting on
      the Timeline* for General); the orange *No task yet.* box with the
      reason on a draft with none; the search field with its icon and
      *Search tasks, or type a new one* — results in a bordered list; a typed
      name that matches no task sets WHAT IT WAS's title and General (no task
      is created, D-110 item 7); suggestion chips with their reason (*In
      progress*, *kepler was building it*, *Card before*, *Card after*).
- [x] KIND: the chips as LAI-516's eight, 28px, 4px radius, the current one
      accent-soft.
- [x] WHAT IT WAS: title and description with the design's placeholders
      (*e.g. Timeline zoom presets* / *Add a description (optional)*),
      read-only fields flat on a read-only entry.
- [x] SPLIT inline (*Split at [3:55 PM] Split Cancel* and the hint).
- [ ] DRAFTED FROM / BUILT FROM: the four tiles (figure over word) and one
      agent line. HISTORY on a confirmed entry (time · what · who) from the
      revisions. The timer-stopped banner after a stop. Break: the note and
      *Turn into work time* / *Remove break*. Not work: *Back to review*.
- [x] Gap: *Fill this gap*, the big mono range with *Found on your Timeline.
      Drag its edges there…*, *Reset to the whole gap* after a change, and
      the footer *Add 20 min ↵* / *Mark as break*.
- [x] Footer: *Confirm 40 min ↵* / *Split…* / *Not work time* on a draft;
      *Pick a task or kind* disabled when none; *Add 30 min ↵* / Cancel on a
      new entry; *Delete entry* (red outline) on a confirmed entry.
- [x] Both themes; `my-day-editor`, `my-day-v2`, `my-day` re-aimed; new
      browser tests for the date tiles, the bar, the search reasons, HISTORY
      and the overlap error.

## Notes / context

Design: `MyDay.dc.html` — `editor()`, `picker()`, `insight()`. The *On your
calendar* insight waits for a calendar source (D-110 item 3) and is not
built. Depends on LAI-511 for where the editor lives.

## Build notes (2026-10-25)

Three criteria stay unticked:

- **Head.** Everything but *× Not work time* is built. A block marked not
  work leaves `GET /me/day`, so there is nothing to select and no pill to
  show. The draft's sub line says *only you and the owners see it*, not the
  design's *only you see it*: an owner can read a member's day (D-102).
- **KIND.** The chips have the design's size, radius and accent-soft current
  one, but list today's `ENTRY_KINDS`. LAI-516 changes the enum to the
  design's eight in its own branch.
- **DRAFTED FROM / BUILT FROM.** All of it is built except *Not work: Back to
  review*. There is no dismissed-draft view and no un-dismiss endpoint; both
  are CORE's.

Two deviations inside ticked criteria:

- The agent's chip reason reads *Agent worked on it*, from `agent.by_task`.
  The day view carries no agent names, so *kepler was building it* cannot be
  said.
- The head uses the type scale's steps (16, 14 and 12 px), not the design's
  17, 15 and 12.5 px. `type-floor.test.ts` refuses a size off the scale.

## Accepted (CHIEF, 2026-10-25)

KIND is met now that LAI-516's eight kinds are merged. The head's *× Not work time* pill and *Not work: Back to review* stay unmet: a dismissed draft leaves the day and has no way back. Filed as LAI-519 (server, then web). Released with the My day design merge on the owner's word after the local review ("perfect push everthing on master now").

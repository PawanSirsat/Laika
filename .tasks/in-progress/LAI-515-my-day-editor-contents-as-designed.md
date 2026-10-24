---
id: LAI-515
title: 'My day: the editor''s contents as designed — the head, the section order, Add time''s date tiles and time-range bar, the gap editor, the task search with reasons, HISTORY and Delete entry on a confirmed entry, the break and not-work editors, the timer-stopped banner, the overlap error'
area: web
assignee: chief
priority: p1
depends-on: [LAI-511]
discovered-from: LAI-888
status: in-progress
started: 2026-10-25T01:20:00Z
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
- [ ] Section order WHEN · OFF-SCREEN WORK (Add time only) · TASK · KIND ·
      WHAT IT WAS · SPLIT · DRAFTED FROM / BUILT FROM · note · HISTORY; the
      footer fixed at the bottom. The length stepper, *? all keys* and the
      second *Counts only* line go.
- [ ] WHEN: Start / End / Length mono fields with the design's hint; on a
      typed End that overlaps confirmed time the field turns red with
      *Overlaps LAI-860, 12:30–1:30 PM. Confirmed time can't overlap.*
- [ ] Add time: *No set time* checkbox at the right of WHEN; seven date
      tiles (weekday + mono date; future days disabled with their tip; a
      past day adds a confirmed entry on that day); chips 15m 30m 45m 1h
      1h 30 2h and *Ends now*; the time-range bar 8 AM–8 PM with the day's
      busy time in grey, the now line in red, the violet range that drags
      and places by click; the two hints. The *No set time* defect is gone.
- [ ] OFF-SCREEN WORK: *Time Laika can't see. One tap sets the kind and
      title.* and the six pill presets (14px radius).
- [ ] TASK: the current task line (mono key + title, or *Shows as Meeting on
      the Timeline* for General); the orange *No task yet.* box with the
      reason on a draft with none; the search field with its icon and
      *Search tasks, or type a new one* — results in a bordered list; a typed
      name that matches no task sets WHAT IT WAS's title and General (no task
      is created, D-110 item 7); suggestion chips with their reason (*In
      progress*, *kepler was building it*, *Card before*, *Card after*).
- [ ] KIND: the chips as LAI-516's eight, 28px, 4px radius, the current one
      accent-soft.
- [ ] WHAT IT WAS: title and description with the design's placeholders
      (*e.g. Timeline zoom presets* / *Add a description (optional)*),
      read-only fields flat on a read-only entry.
- [ ] SPLIT inline (*Split at [3:55 PM] Split Cancel* and the hint).
- [ ] DRAFTED FROM / BUILT FROM: the four tiles (figure over word) and one
      agent line. HISTORY on a confirmed entry (time · what · who) from the
      revisions. The timer-stopped banner after a stop. Break: the note and
      *Turn into work time* / *Remove break*. Not work: *Back to review*.
- [ ] Gap: *Fill this gap*, the big mono range with *Found on your Timeline.
      Drag its edges there…*, *Reset to the whole gap* after a change, and
      the footer *Add 20 min ↵* / *Mark as break*.
- [ ] Footer: *Confirm 40 min ↵* / *Split…* / *Not work time* on a draft;
      *Pick a task or kind* disabled when none; *Add 30 min ↵* / Cancel on a
      new entry; *Delete entry* (red outline) on a confirmed entry.
- [ ] Both themes; `my-day-editor`, `my-day-v2`, `my-day` re-aimed; new
      browser tests for the date tiles, the bar, the search reasons, HISTORY
      and the overlap error.

## Notes / context

Design: `MyDay.dc.html` — `editor()`, `picker()`, `insight()`. The *On your
calendar* insight waits for a calendar source (D-110 item 3) and is not
built. Depends on LAI-511 for where the editor lives.

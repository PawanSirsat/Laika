---
id: LAI-514
title: 'My day: the tabs (Overview first, All), the list rows and group rows, the select-all header, the floating bulk bar with Assign task, the tray with a kind pill, and Overview''s Range scope — as designed'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-888
status: backlog
---

## Goal

Below the Timeline the design's lists differ from master's in the tab set,
the default tab, the row columns, the source pills, the bulk bar's place and
its Assign task menu, and the tray's words. The owner wants the design.

## Acceptance criteria

- [ ] Tabs: *Overview · To review n · Confirmed n · All*, 40px, the count in
      a mono pill (accent when selected), a 2px accent bar under the selected
      one. Overview is the default for a day with no kept tab; *All* stacks
      Overview, To review and Confirmed. The kept-per-browser tab stays.
- [ ] Rows (desktop): 44px min height, a 14×11 swatch, the range in mono
      muted (116px), the length in mono bold (72px), the mono key or sans
      word (*General*, or orange *No task yet*), the title muted and
      ellipsised, and a source pill at the right — *Collector*, *Live*,
      *Split*, *Shared hour* on drafts; *Timer*, *You added*, *From draft*,
      *Shared hour* on entries. On a phone the range and length move under
      the label and the pill goes.
- [ ] Group rows *MORNING · AFTERNOON · EVENING* on the `c.col` tint with the
      count and the mono subtotal; *No set time* stays a group.
- [ ] The list header: a select-all checkbox (indeterminate dash when some
      are ticked), *To review*, `n · sum` in mono, and the right-hand hint
      (*2 with no task yet* in orange, *All ready to confirm*, or none).
      Confirmed's hint: *Visible to owners and admins* / *What Dana
      confirmed*. Empty texts as the design's.
- [ ] The bulk bar is a floating toolbar, sticky 20px above the bottom of
      the page (12px on a phone), shadowed: *n selected* · sum · divider ·
      Confirm (or *Confirm k* when some have no task) · *Assign task ▾* · *Not
      work time* · ×. Assign task lists the day's cards and the person's
      in-progress cards plus *No task · Shows as its kind*; picking one puts
      every ticked draft on it (one write each, as today's batches).
- [ ] The tray: *No set time* / *Drag onto the Timeline to give it a time*
      (desktop), *Tap to set a time* (phone), *Added without a time*
      (read-only); each item `⋮⋮ · 20 min · title · [kind]`; draggable on
      desktop (LAI-512 takes the drop).
- [ ] Overview gains the *Range* scope: two selects over the shown week; the
      stats and the BY DAY bars cover the range; BY KIND and BY TASK stay
      Day-only with the tab saying so (the week payload carries minutes only).
- [ ] Both themes, 1440 and 390px; `my-day-tabs`, `my-day-bulk`,
      `my-day-page-scroll` re-aimed; new browser tests for Assign task, the
      All tab and the Range scope.

## Notes / context

Design: `MyDay.dc.html` — `tabs`, `rvM`, `cfM`, `rvRows`, `cfRows`, `bulk`,
`tray`, `overview`. Assign task returns by the owner's 2026-10-25 word
(D-110 item 11 amended).

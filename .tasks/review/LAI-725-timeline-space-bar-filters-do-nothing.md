---
id: LAI-725
title: 'Timeline: the space bar''s Priority, tag, Anyone and Ready filters show there and filter nothing'
area: web
assignee: shell
priority: p3
depends-on: []
discovered-from: LAI-721
status: review
finished: 2026-10-23T10:31:45Z
started: 2026-10-23T10:00:37Z
---

## Goal

On `/timeline` the space bar (`SpaceTopBar`) draws Search, `Priority: all`,
`Any tag`, `Anyone` and `Ready only` — visible in the owner's production
screenshots of 2026-10-08 — and the Timeline reads none of them: it did not
before LAI-721 and does not after. A control that changes nothing on the
screen it sits on reads as broken.

Decide one of: hide them on the Timeline (as the Board hides the bar's copy
behind its own toolbar), or make them narrow what an opened sprint lists.

## Acceptance criteria

- [x] On `/timeline`, every filter the space bar shows changes what the
      Timeline shows, or the bar does not show it there — asserted in a
      browser test either way.
- [x] Whatever is chosen does not reintroduce a whole-project task walk
      (LAI-721, D-074): filtering applies to a sprint's tasks as it is opened.

## Notes / context

- Found while building LAI-721; out of its scope.
- `space-bar.test.ts` and `space-chrome-compaction.test.ts` currently assert
  the Timeline keeps these filters in the bar, so a decision to hide them
  re-aims those tests on purpose.

## Outcome

**Hidden, not applied** (SHELL, 2026-10-23). `TimelineScreen` calls
`useClaimSpaceFilters()` once, exactly as the dashboard does for LAI-711, so on
`/timeline` the bar draws no Search, Priority, tag, assignee or Ready-only
control. The Timeline lists a sprint's tasks only when that sprint is opened
(LAI-721, D-074); applying five filters to a per-sprint request would have
been five new reads of URL state for a screen whose own controls are project,
zoom and sprint, and the owner's complaint was a control that did nothing,
not a missing filter. The comments in `SpaceSlot.tsx` and `SpaceTopBar.tsx`
that named the Timeline as a view that keeps the bar's filters now name the
Calendar.

**Re-homed tests.** The three assertions that pinned the old behaviour moved
to `/calendar`, which still keeps the bar's filters: `space-bar.test.ts`'s
member faces and `+2`, its *"a view with no toolbar keeps the bar's own
filters"*, and `space-chrome-compaction.test.ts`'s geometry check. New:
`space-bar.test.ts` *"the timeline hides the filters it never read"* (AC1,
read from the rendered DOM; a mutant without the claim call fails it on
exactly that assertion) and `timeline-sprints.test.ts` *"the bar's filters in
the URL change no task request"* (AC2: arrive with `q`, `priority`, `tag`,
`assignee` and `ready` all set, open a sprint, the request names `sprint=s2`
and carries none of the five).

**Gate** — see the PR body for the final run's three exit codes; the log
entry records the runs and what each one hit.

**Discovered, not fixed:** `/calendar` reads none of the bar's filters either
(`CalendarScreen.tsx` reads the whole project set from the task store and
`listSprints`). Same defect, left for a task of its own.

**Laika board:** the MCP tools did not connect in this session, so the card
was not mirrored; working under §2.


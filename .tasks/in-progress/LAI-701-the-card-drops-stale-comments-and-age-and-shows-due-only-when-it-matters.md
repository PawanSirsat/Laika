---
id: LAI-701
title: 'The card drops stale, comment count and age, and shows the due date only when it is today or past'
area: web
assignee: chief
priority: p1
depends-on: [LAI-495]
status: in-progress
started: 2026-10-06T10:27:43Z
---

## Goal

The owner's two crops of a board card, 2026-10-06: *"don't show stale, we can
show only the due date if that is gone or for today … also remove this from
card, I don't need that"* — the second crop being the comment count and the
`3h` age. The footer was also clipping (`stale 12` cut off by the avatar),
because it is one non-wrapping row whose items shrink.

## Acceptance criteria

- [ ] `CardFields` no longer has `stale`, `comments` or `age`; View settings
      no longer lists *Stale marker*, *Comment count* or *Last updated*; the
      card renders none of `.marker-stale`, `.card-comments`, `.card-age`. A
      stored preference that still carries those keys is read without error
      and they are ignored. Their now-unused card CSS is removed.
- [ ] A pure `dueState(task, now)` in `api/date-only.ts` (mirrored test)
      returns `overdue` for an open task due before today, `today` for an open
      task due today, and nothing otherwise — including a task due later, and
      a `done` or `cancelled` one whatever its date. Edges tested: the first
      and last millisecond of the due day.
- [ ] The card's due chip renders only when `dueState` says so: overdue in
      the overdue red with a ⚠ and the short date, today in amber reading
      *Due today*, each with a title giving the full date. A future date
      renders nothing. The *Due date* toggle still hides it.
- [ ] Browser tests: a stale-flagged task with comments shows no stale marker,
      no comment count and no age (positive control first); a card due
      yesterday, today and next week shows the red chip, the amber chip and
      nothing; on a 218px card with sprint, due, subtasks and an avatar,
      nothing in the footer is clipped.
- [ ] SPEC §11.4.1's card list matches; the decision is recorded. Both
      themes; the repo-root gate exits 0 on all three.

## Notes / context

Owner-directed, filed and built by CHIEF. `card-fields.ts`, `TaskCard.tsx`,
`board.css`, `date-only.ts`; tests in `test/browser/stale-marker.test.ts`,
`card-anatomy.test.ts`, `view-settings.test.ts`,
`test/routes/screens/board/view-preferences.test.ts`, `task-card.test.ts`.
**Staleness is not lost:** the server still flags it (§11.6) and the
Activity tab's stale list still shows it; only the card stops drawing it.
The List's UPDATED column and the drawer's comments are untouched.

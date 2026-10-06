---
id: LAI-701
title: 'The card drops stale, comment count and age, and shows the due date only when it is today or past'
area: web
assignee: chief
priority: p1
depends-on: [LAI-495]
status: review
started: 2026-10-06T10:27:43Z
finished: 2026-10-06T11:20:30Z
---

## Goal

The owner's two crops of a board card, 2026-10-06: *"don't show stale, we can
show only the due date if that is gone or for today … also remove this from
card, I don't need that"* — the second crop being the comment count and the
`3h` age. The footer was also clipping (`stale 12` cut off by the avatar),
because it is one non-wrapping row whose items shrink.

## Acceptance criteria

- [x] `CardFields` no longer has `stale`, `comments` or `age`; View settings
      no longer lists *Stale marker*, *Comment count* or *Last updated*; the
      card renders none of `.marker-stale`, `.card-comments`, `.card-age`. A
      stored preference that still carries those keys is read without error
      and they are ignored. Their now-unused card CSS is removed.
- [x] A pure `dueState(task, now)` in `api/date-only.ts` (mirrored test)
      returns `overdue` for an open task due before today, `today` for an open
      task due today, and nothing otherwise — including a task due later, and
      a `done` or `cancelled` one whatever its date. Edges tested: the first
      and last millisecond of the due day.
- [x] The card's due chip renders only when `dueState` says so: overdue in
      the overdue red with a ⚠ and the short date, today in amber reading
      *Due today*, each with a title giving the full date. A future date
      renders nothing. The *Due date* toggle still hides it.
- [x] Browser tests: a stale-flagged task with comments shows no stale marker,
      no comment count and no age (positive control first); a card due
      yesterday, today and next week shows the red chip, the amber chip and
      nothing; on a 218px card with sprint, due, subtasks and an avatar,
      nothing in the footer is clipped.
- [x] SPEC §11.4.1's card list matches; the decision is recorded. Both
      themes; the repo-root gate exits 0 on all three.

## Notes / context

Owner-directed, filed and built by CHIEF. `card-fields.ts`, `TaskCard.tsx`,
`board.css`, `date-only.ts`; tests in `test/browser/stale-marker.test.ts`,
`card-anatomy.test.ts`, `view-settings.test.ts`,
`test/routes/screens/board/view-preferences.test.ts`, `task-card.test.ts`.
**Staleness is not lost:** the server still flags it (§11.6) and the
Activity tab's stale list still shows it; only the card stops drawing it.
The List's UPDATED column and the drawer's comments are untouched.

## Finished — CHIEF (session jira-style-task-view-refactor), 2026-10-06

**Built by the other CHIEF session (`laika-7c`) on `build-list`** — `9d0c7d0`,
the code and its tests — and **finished here** on the owner's instruction,
after they saw it was not on production. The two sessions agreed the hand-off
by message; `laika-7c` made no further commits except the one below.

**What was missing, and is now done:** SPEC §11.4.1 and §11.4.2.1 no longer
list the stale marker and say the due date shows only today or past; the
decision is **D-069**. My LAI-495 `subtasks.test` asserted a chip on a task
due next year, which this task deliberately removes; both assertions now
assert the absence, with a positive control.

**One gap found by the builder and closed:** `card-footer.test`'s colour
check compared against `.card-key`, so a today chip that lost its amber rule
still passed. `12d49f0` (by `laika-7c`) resolves the tokens through a probe
span and asserts each chip equals its own token in both themes. Re-checked
here: deleting `.card .card-due-today` turns it red.

**Mutations (by the builder, each restored by copy and checksum):**
`dueState` never `today`; `done` / `cancelled` keep their chip; the footer back
to `nowrap`; both chip colour rules removed — all red after `12d49f0`.

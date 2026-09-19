---
id: LAI-477
title: 'The ISO week number is correct and nothing proves it'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-274
status: backlog
---

## Goal

`isoWeek()` in `server/web/src/routes/screens/calendar/calendar-derive.ts` draws
the calendar's `W38` gutter. **It is correct — I checked — and no test asserts
it.**

Its own comment names the risk:

> *"the first Thursday, which is the rule every calendar a reader has used
> follows, and getting it wrong is invisible for eleven months of the year."*

**A comment that names a failure mode with no assertion under it is the exact
shape CLAUDE.md §5 warns about**, and this is the worst kind of function to leave
unguarded: wrong only at year boundaries, where nobody looks, in a value that
looks plausible whatever it says.

`calendar-derive.test.ts` exists and covers `monthGrid` — six weeks, starts
Monday, marks weekends. It does not touch `isoWeek`.

## Acceptance criteria

- [ ] **`isoWeek()` is asserted against known ISO-8601 dates**, and the cases are
      the year-boundary ones — a test of mid-year dates proves nothing, because
      every naive implementation is right in June.
      **These nine all pass today**; use them as the floor, not the ceiling:

      | date | ISO week |
      | --- | --- |
      | 2026-01-01 (Thu) | W1 |
      | 2025-12-29 (Mon) | W1 |
      | 2021-01-01 (Fri) | **W53** of 2020 |
      | 2020-12-28 | W53 |
      | 2024-12-30 (Mon) | **W1** of 2025 |
      | 2016-01-03 (Sun) | **W53** of 2015 |
      | 2015-12-31 | W53 |
      | 2019-12-30 | W1 |
      | 2026-09-19 | W38 |

- [ ] **A 53-week year and a 52-week year are both covered.** 2020 and 2015 have
      53 ISO weeks; most years have 52. An implementation that always returns
      `1 + floor(dayOfYear / 7)` passes a careless test and fails these.
- [ ] **The guard is proved to fail.** Break `isoWeek` — change the `+ 3` Thursday
      shift to `+ 2` — and confirm **that assertion** goes red, not the suite
      generally and not a typecheck error (the review skill's rule: the red must
      come from the property under test). Restore by checksum.
- [ ] Full gate — repo root, all three `EXIT 0`.

## Notes / context

**This is not a defect report.** I extracted the function and ran it against the
nine dates above during review of LAI-274; all nine are correct. This task adds
the assertion that keeps them correct.

**LAI-274 was accepted, not sent back.** None of its criteria asked for this
test, and §2 forbids adding criteria to work already submitted. It is also the
only one of the 27 tasks in that pass whose commits added no test file at all —
worth knowing, not worth holding against it.

**`monthGrid` already has coverage**; do not duplicate it. The gap is `isoWeek`
alone, and `weeksOf()` which labels rows from it.

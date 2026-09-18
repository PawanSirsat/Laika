---
id: LAI-260
title: 'The spaces list reorders itself when you click it'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-248
status: backlog
---

## Goal

**Owner-reported, with screenshots.** Clicking a space in the sidebar moves it
to the top of the list, so the rows shuffle under the pointer:

```
before click            after clicking Laika Infra
  LW  Laika Web           LI  Laika Infra
  LI  Laika Infra         LW  Laika Web
  LC  Laika Core          LC  Laika Core
```

The owner's words: **"seque must not be change"** — the sequence must not
change. A list that rearranges itself as you use it means the row you want is
never where you last saw it, and the next click lands on whatever slid into
that position.

`recentSpaces()` returns its rows in recency order, and `promote()` puts the
space you just opened at the front. That is LAI-248's AC2, and it is also what
the prototype's `openSpace()` does (`recent: [name].concat(rest).slice(0, 3)`)
— **the owner is overriding both.**

## What to keep and what to change

**Recency still decides *which* spaces are listed.** With more than three
projects something has to choose, and "the three you have opened most
recently" is the design's rule and a good one. Storage and `promote()` are
unchanged.

**Recency must not decide the *order they are drawn in*.** Sort the rows for
display so a click never moves one. Alphabetical by name: deterministic, and
it only changes when a project is renamed or added.

## Acceptance criteria

- [ ] Clicking any space leaves every row exactly where it was. Asserted in a
      browser test by reading the rendered order before and after a click and
      comparing them.
- [ ] Opening a fourth space still replaces the least-recent one — membership
      is unchanged, only the drawing order.
- [ ] The order is stable across a reload with the same three spaces.
- [ ] A unit test on `recentSpaces()` covers both halves: the *set* follows
      recency, the *sequence* does not.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

**This supersedes LAI-248's AC2 as written** ("moves it to the front of
`recent`") for the visible list. LAI-248 is in `.tasks/review/`; the criterion
was met as written and the owner has since changed what is wanted, so this is
a new task rather than a send-back. CHIEF should record the supersession when
reviewing both.

**Alphabetical rather than the server's order.** `GET /projects` sorts by
`updated_at asc`, which moves whenever anything in a project changes — it
would shuffle the sidebar on its own, which is the same defect arriving from
the server instead of from a click.

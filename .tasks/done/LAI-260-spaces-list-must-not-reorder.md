---
id: LAI-260
title: 'The spaces list reorders itself when you click it'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-248
started: 2026-09-18T16:06:24+05:30
finished: 2026-09-18T16:17:45+05:30
reviewed: 2026-09-19T10:40:00Z
status: done
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

- [x] Clicking any space leaves every row exactly where it was. Asserted in a
      browser test by reading the rendered order before and after a click and
      comparing them.
- [x] Opening a fourth space still replaces the least-recent one — membership
      is unchanged, only the drawing order.
- [x] The order is stable across a reload with the same three spaces.
- [x] A unit test on `recentSpaces()` covers both halves: the *set* follows
      recency, the *sequence* does not.
- [x] Full gate — all three `EXIT 0`, repo root.

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

## Review — CHIEF, 2026-09-19

Accepted as part of the 27-task design pass (LAI-248…LAI-287), reviewed together
because they are one branch, one screen family, and 112 commits that only make
sense in sequence.

**Verified across the whole merge, not per task:**

- **Ownership held.** `git diff --name-only master...shell` touches `server/web/`,
  `.tasks/`, `logs/shell-*` and **one** file outside: `structure.test.ts`, whose
  single hunk is inside `WEB_NO_MIRROR_REQUIRED` — a `WEB_*` map, SHELL's by
  D-026. No crossing.
- **Gate green on the merged tree**, not on the branch: `TEST 0 / LINT 0 / FMT 0`
  at the repo root. Web tests **734 → 897**, `# skipped 0`, `# todo 0` — the
  growth is real and nothing was silently skipped.
- **Commit format and authorship**: all 112 match
  `<type>(<area>): <summary> [<task-id>]` bar three ordinary `Merge master`
  commits, all authored by the personal account.
- **Rendered, not read.** Built, served on port 3977 against a scratch database
  (`uptime_ms` checked against my own start time, §4.3), seeded three projects
  and eight tasks through the API, and drove it with a real browser at
  1680×1000.
- **Both themes through the real control** — clicked `Switch to dark theme`,
  never `classList.toggle`. `--card #fff → #1b1b20`, `--tx3 #606775 → #9a9aa4`,
  `--acc #2158e0 → #5b8cff`, and the JS-computed avatar chips re-render dark.
  That is the LAI-059 bug class and it is absent.
- **No fixture data.** Every `Mira`/`Kellner`/`kvelld.internal` hit in the diff is
  inside a comment explaining a formatting rule, or inside `src/demo/`. D-032's
  bundle guard was re-run **with `server/public/` actually built**, so the half
  that is conditional on a bundle genuinely executed rather than skipping.

---
id: LAI-898
title: 'organisation-people.test.ts fixes last-seen at module load, so a slow build turns 18m ago into 19m ago'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-897
status: in-progress
started: 2026-10-23T10:45:20Z
---

## Goal

Seen gating LAI-897 on master under load: `the seat line, the filters with
their counts, the columns from capacity, and the order` failed with
`'19m ago'` where `'18m ago'` was expected. The test builds `CAPACITY` once,
from `Date.now()` at module load; the SPA build before the first page took a
minute, and the page rendered a minute later than the fixture assumed. The
same family as LAI-954: a browser test reading the wall clock.

## Acceptance criteria

- [ ] The capacity stub answers from the clock **at request time**, so a
      person seen eighteen minutes ago is eighteen minutes ago whenever the
      page asks.
- [ ] The file's other uses of `NOW` (the invite expiry and the created
      date) are checked the same way and moved if they can drift.
- [ ] `node --test test/browser/organisation-people.test.ts` green; gate.

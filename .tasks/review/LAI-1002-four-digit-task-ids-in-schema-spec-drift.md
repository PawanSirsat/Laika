---
id: LAI-1002
title: 'schema-spec-drift reads LAI-1000 as LAI-100: closedTaskIds and PLANNED_MARK take exactly three digits'
area: server
assignee: polly
priority: p3
depends-on: []
discovered-from: LAI-1000
status: review
started: 2026-11-01T20:45:41Z
finished: 2026-11-01T20:47:22Z
---

D-120 gives CHIEF `LAI-1000` – `LAI-1099`. Two anchored parsers in
`server/test/tooling/schema-spec-drift.test.ts` take exactly three digits:

- `closedTaskIds`: `/^(LAI-\d{3})/` reads `.tasks/done/LAI-1000-….md` as
  `LAI-100`, so the four-digit task is never "closed" and `LAI-100` is closed
  twice;
- `PLANNED_MARK`: `(LAI-\d{3})[^*]*` reads `**Planned — LAI-1000 …**` as
  `LAI-100`, which is already in `done/`, so the mark reads as expired the day
  it is written.

Harmless today (no four-digit Planned mark exists, `LAI-100` – `LAI-109` are
all done). Not changed in LAI-1000 because the guard is CORE's and the
dispatch said to report rather than change a guard silently.

**Until this lands, no `**Planned — LAI-10xx …**` mark may be written into
SPEC §4** (Belka, 2026-10-30). Such a mark is read as `LAI-100`, which is in
`done/`, so `schema-spec-drift` › *has no planned mark that has outlived its
reason* goes red the moment it is written. An unmarked §4 section with no
table is red too, so a §4 table that a four-digit task will build is not
written into SPEC until this lands.

## Acceptance criteria

- [x] Both read `LAI-\d{3,}` with a boundary (`(?!\d)` / `-` after), so
      `LAI-1000` parses as `LAI-1000` and `LAI-100` as `LAI-100`
- [x] A test names a four-digit Planned mark and a four-digit done file
- [x] The repo gate exits 0

## Builder notes

- `server/test/tooling/schema-spec-drift.test.ts`: `PLANNED_MARK` and
  `closedTaskIds` read `LAI-\d{3,}(?!\d)`.
- Two new tests in *the planned mark (LAI-080)*: a `**Planned — LAI-1045 …**`
  mark parses as `LAI-1045` (and is not expired by `LAI-104` in `done/`), and a
  temp `.tasks/done/` holding `LAI-1045-….md` and `LAI-100-….md` reads as
  exactly `LAI-100`, `LAI-1045`.
- Red first on the old parse (`expected 'LAI-104' to be 'LAI-1045'`); each
  regex reverted alone turns only its own test red.
- Gate: this file, lint, format, server typecheck locally (Belka rule: no full
  suite); the repo gate is CI on the PR.

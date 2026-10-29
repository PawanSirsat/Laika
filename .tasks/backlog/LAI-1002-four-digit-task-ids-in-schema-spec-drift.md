---
id: LAI-1002
title: 'schema-spec-drift reads LAI-1000 as LAI-100: closedTaskIds and PLANNED_MARK take exactly three digits'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-1000
status: backlog
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

## Acceptance criteria

- [ ] Both read `LAI-\d{3,}` with a boundary (`(?!\d)` / `-` after), so
      `LAI-1000` parses as `LAI-1000` and `LAI-100` as `LAI-100`
- [ ] A test names a four-digit Planned mark and a four-digit done file
- [ ] The repo gate exits 0

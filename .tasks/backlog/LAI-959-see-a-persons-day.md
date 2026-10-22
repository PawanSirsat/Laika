---
id: LAI-959
title: 'Owner and admin have nowhere to open a person''s day, hours and activity, and nothing links a name to it'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-957]
discovered-from:
status: backlog
---

## Acceptance criteria

- [ ] Member profile gains **Day** (read-only My day timeline for any date,
      reusing My day components with a `readOnly` subject — no edit, confirm,
      break or switch controls rendered) and **Hours** (week totals) tabs,
      from LAI-957's endpoints; shared local activity shown as the person sees
      it.
- [ ] My day: a **Viewing: Me ▾** switcher for anyone holding the capability;
      choosing a person shows their day read-only with a clear banner; the URL
      carries `?user=`; a refused URL shows the existing not-allowed state.
- [ ] Names link to the person's profile (holders only) from Work rows,
      Organisation → Activity rows, Capacity, and a task's assignee.
- [ ] My day shows **Who looked at my time** from `/me/analytics-views`.
- [ ] Endpoint-coverage and view-type drift green; light/dark, 1440/390;
      browser tests with the pinned clock (LAI-954).
- [ ] Gate: `pnpm test` / `lint` / `format` exit 0 with LAI-957 merged.

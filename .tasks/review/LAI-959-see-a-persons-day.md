---
id: LAI-959
title: 'Owner and admin have nowhere to open a person''s day, hours and activity, and nothing links a name to it'
area: web
assignee: shell
priority: p1
depends-on: [LAI-957]
discovered-from:
started: 2026-10-22T14:31:35Z
status: review
finished: 2026-10-22T15:56:47Z
---

## Acceptance criteria

- [x] Member profile gains **Day** (read-only My day timeline for any date,
      reusing My day components with a `readOnly` subject — no edit, confirm,
      break or switch controls rendered) and **Hours** (week totals) tabs,
      from LAI-957's endpoints; shared local activity shown as the person sees
      it.
- [x] My day: a **Viewing: Me ▾** switcher for anyone holding the capability;
      choosing a person shows their day read-only with a clear banner; the URL
      carries `?user=`; a refused URL shows the existing not-allowed state.
- [x] Names link to the person's profile (holders only) from Work rows,
      Organisation → Activity rows, Capacity, and a task's assignee.
- [x] My day shows **Who looked at my time** from `/me/analytics-views`.
- [x] Endpoint-coverage and view-type drift green; light/dark, 1440/390;
      browser tests with the pinned clock (LAI-954).
- [ ] Gate: `pnpm test` / `lint` / `format` exit 0 with LAI-957 merged.

## Builder notes (SHELL, 2026-10-22)

**Gate is red, by §4.4, and only where named below.** Base:
`origin/LAI-957-owner-admin-read-a-persons-day` @261f7b04 with
`origin/LAI-954-my-day-tests-pin-the-clock` merged (4df352b8).

1. **Server staleness — LAI-957's half, `server/` is not mine.**
   `server/test/tooling/response-type-coverage.test.ts`, two assertions, one
   cause: LAI-959 pairs `WhoLookedView` ↔ `WhoLooked` in `view-type-drift.test.ts`,
   so LAI-957's `UNPAIRED` entry expired, exactly as its own comment says it
   would (*"the person's 'who looked' view is LAI-959, which brings the
   mirror"*):

   ```
   × names nothing that is already paired or no longer served
     + "WhoLookedView is paired now — remove it from UNPAIRED",
   × reports how much of the surface is actually guarded
     AssertionError: expected 79 to be 78
   ```

   Green on deleting `['WhoLookedView', 'no client type exists']` (and its two
   comment lines) from `UNPAIRED`. Not edited from here.
2. **`api/v1/org/permissions` uncalled — LAI-960's.** `endpoint-coverage.test.ts`
   *"no endpoint is served, uncalled and unexplained"*: `+ 'api/v1/org/permissions'`.
   The caller is LAI-960's grid on its own branch. My three —
   `api/v1/people/*/time`, `api/v1/people/*/local-activity`,
   `api/v1/me/analytics-views` — are called (`api/people-analytics.ts`).

Criterion 6 stays unticked: the gate cannot exit 0 on this branch until both
halves above land.

**How the client knows** (as the dispatch asked): `GET /permissions`
`me.actions` containing `people.analytics.read` — `useOrgActions` +
`holdsPeopleAnalytics` in `api/people-analytics.ts`. Until it answers (or if it
cannot) the default grants stand in — owner and admin — so a stand-in can only
draw a link the server then refuses, never data. `PersonLink` (Capacity,
Usage, Dashboard, and now Work, Organisation → Activity, the task's assignee)
uses it, as does the profile's own gate (`profile.read`).

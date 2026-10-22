---
id: LAI-951
title: 'An owner has nowhere to read everything that happened across the organisation'
area: web
assignee: shell
priority: p2
depends-on: [LAI-886]
discovered-from:
started: 2026-10-22T12:06:28Z
status: review
finished: 2026-10-22T12:31:00Z
---

## Goal

LAI-886 serves `GET /api/v1/activity/history` (owner/admin only,
`audit_log.export`): every project's activity, newest first, filterable.
Give it a screen.

## Acceptance criteria

- [x] Organisation gains an **Activity** tab, shown only to owners and admins
      (the same gate the route uses; a member never sees the tab and a
      direct URL shows the existing not-allowed state).
- [x] Rows: when, who (person or agent), what (the existing activity wording
      from `server/web/src/api/activity.ts`, no second copy), which project
      and task (linked).
- [x] Filters: person, project, type, from / to date — kept in the URL;
      "Load more" walks `next_cursor`.
- [x] Loading, empty and error states.
- [x] `server/web/test/api/endpoint-coverage.test.ts` no longer lists
      `api/v1/activity/history`.
- [x] Light and dark, 1440 and 390, no sideways scroll; design tokens only.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 — on a branch
      that has LAI-886 merged in (CLAUDE.md §4.4 step 4).

## Notes

Base the branch on `master` with `origin/LAI-886-org-activity-history`
merged in.

## Builder notes (SHELL, 2026-10-22)

**The gate criterion is left unticked, honestly.** `pnpm lint` and `pnpm format`
exit 0. `pnpm test` exits 1 on two `server/web` browser tests in files this task
does not touch, both of which depend on the local time of day (run at ~17:55 IST)
and fail identically on this branch's base without the LAI-951 commit
(`git switch --detach HEAD~1`, each run alone):

- `test/browser/my-day-v3.test.ts:106` — *the card spans the page above the
  editor, and today opens with now in view (LAI-889)*: `now at 917 of 882`.
- `test/browser/my-day.test.ts:369` — *a 12-hour clock with AM/PM, and minutes
  and hours in words*: `ticks: 6 AM, … 11 AM, 1 PM, …` (no `12 PM`).

One server load timeout on the full run, green alone:
`test/services/estimates.test.ts` *stays under 50 ms at p95 on 120 finished
tasks* (36 passed, 1 skipped, exit 0 alone).

`endpoint-coverage.test.ts` is green: `api/v1/activity/history` is no longer
listed.

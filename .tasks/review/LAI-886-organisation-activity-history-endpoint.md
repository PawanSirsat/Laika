---
id: LAI-886
title: 'An owner has no paginated, filterable history of everything that happened across the organisation'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
status: review
finished: 2026-10-22T11:12:42Z
started: 2026-10-22T10:51:39Z
---

## Goal

The owner wants to see everything across all people (2026-10-22). Project
activity is readable per project; org-wide rows exist behind
`audit_log.export` (`server/src/services/activity.ts` ~132,
`events.ts` ~81) but there is no paginated history a screen can browse.

## Acceptance criteria

- [x] First, report what already exists: if an org-wide paginated read with
      filters is already served, say so in the log and reduce this task to
      the missing filters.
- [x] `GET /api/v1/activity` (or the existing route extended) returns
      activity across every project, newest first, cursor-paginated per
      SPEC §6.3 conventions, filterable by `actor` (user id), `project`
      (slug), `type` (from `ACTIVITY_TYPES`), `since`, `until`.
- [x] Guarded by `can(actor, 'audit_log.export', …)` — owner/admin only. A
      member gets the §6.3 refusal `code`, asserted by code, not by a bare
      throw.
- [x] Per-person local-activity data (D-079) is **not** included; this is
      the board's own activity rows only.
- [x] Tests for each filter, pagination, and the refusal.
- [x] **Named cross-area edit (D-033):** the endpoint's row in SPEC §6.4
      Endpoints only.
- [x] No new `ACTIVITY_TYPES` verb (that would make this three-owner).
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 (repo root).
      **Not met alone (§4.4 step 1):** lint 0, format 0, test 1 on the one
      `server/web` assertion quoted below; LAI-889 turns it green.

## Notes

Drives LAI-889 (web: Organisation → Activity tab).

## Renumbered

Filed by CHIEF on 2026-10-22 as `LAI-874`, which collided with a task already on
`origin/master` (the id sweep ran before `git fetch`). Commit `2274bfc9`
carries `[LAI-871]` for all five filings, and a claim commit `2c1a7274`
`[LAI-872]` (pushed as branch `LAI-872-share-activity-switch`) belongs to the
filing now LAI-884 — **neither is the task that holds that number now.**

## Submitted (CORE, 2026-10-22)

**What already existed.** `GET /api/v1/activity` is already an org-wide,
cursor-paginated feed — but viewer+ (`member_list.read`, rows filtered per
caller) with only `since` and `task_id`. Gating it to owner/admin would take a
SPEC'd feed away from members, so the history is a sibling route instead:
**`GET /api/v1/activity/history`**, `?actor=&project=&type=&since=&until=`
plus `limit`/`cursor`, same row shape (`EventView`), same `(created_at, seq)`
descending cursor. `/api/v1/activity` is unchanged.

**Submitted red under §4.4 step 1.** The repo-root `pnpm test` exits 1 on one
assertion in SHELL's area, and only that one:

```
server/web/test/api/endpoint-coverage.test.ts:255
not ok 1 - no endpoint is served, uncalled and unexplained
served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not
+ [ 'api/v1/activity/history' ]
- []
```

The caller is LAI-889 (web: Organisation → Activity tab), which turns it
green. `NO_BROWSER_CALLER` lives in `server/web/`, so there is no exemption
CORE could take without crossing; none was taken.

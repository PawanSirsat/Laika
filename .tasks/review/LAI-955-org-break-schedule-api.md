---
id: LAI-955
title: 'An owner cannot set the organisation''s lunch and other breaks: no break schedule exists, only one person''s breaks on one day'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-10-22T13:30:30Z
finished: 2026-10-22T13:44:43Z
---

## Goal

D-101: owners and admins set the organisation's break windows (e.g. Lunch
13:00–13:45, Mon–Fri); every person's My day draws them. This is the server
half. Design and evidence: CHIEF's investigation of 2026-10-22 (summarised in
D-101).

## Acceptance criteria

- [x] Migration (next number): nullable JSON text column `breaks` on
      `org_time_settings`; Drizzle schema updated. Absent / null means no
      schedule.
- [x] `PUT /api/v1/org/time/breaks` with body `{ breaks: Window[] }`, where
      `Window = { label, start: "HH:MM", end: "HH:MM", days: number[] }`
      (`days` ISO 1=Mon … 7=Sun, non-empty, unique). Validation per D-101
      item 1 → `422` with the §6.3 shape naming the offending window. Empty
      list clears the schedule. If no `org_time_settings` row exists, one is
      created with `mode: 'off'`. Answers the full `TimeSettingsView`.
      Writes nothing else (drafts, entries, breaks untouched — test it).
- [x] Guarded by `can(actor, 'org.time.set')` before any read or write:
      owner and admin `200`; member and viewer `403`; any token `403`
      (session-only). Assert the `code`.
- [x] `TimeSettingsView` (so `GET /me/time-settings` and My day's
      `settings`) carries `breaks: Window[]` (empty list when none), as an
      inline shape — no new exported response type.
- [x] **Named cross-area edits (D-033):** SPEC §4.45's table gains the
      `breaks` row; §6.4's endpoint list gains the `PUT /org/time/breaks`
      line and its short prose beside `PUT /org/time`; the
      `GET /me/time-settings` answer list names `breaks`. Nothing else in
      `docs/`.
- [x] §4.4: `server/web/test/api/view-type-drift.test.ts` will go red on
      `TimeSettingsView` gaining `breaks` until LAI-956 mirrors it — quote the
      exact failure in this file; do not touch `server/web/`.
- [x] Gate: `pnpm test`, `pnpm lint`, `pnpm format` (only the quoted §4.4
      failure allowed).

## Notes

Reuse `atClock`-style wall-clock strings; no zone stored. Keep it off
`PUT /org/time` (that switch deletes drafts when leaving `drafts`). No MCP
tool. Base on `integration-owner-visibility-2026-10-22`.

## Builder notes (CORE, 2026-10-22)

- **Migration `0048_org_time_breaks`**: `ALTER TABLE org_time_settings ADD
  breaks text;` — additive, no rebuild. Self-contained; LAI-958, built from the
  same base, may also take 0048 — whichever lands second regenerates per
  `server/src/db/migrations/README.md`.
- **Window** = `{ label, start, end, days }`: label trimmed, 1–40; `start`/`end`
  `HH:MM`, `00:00`–`23:59`; `days` ISO ints 1–7, non-empty, unique, stored
  sorted. At most 8. Route schema holds shape; the service holds start < end
  (so nothing crosses midnight), unique days and no overlap between windows
  that share a day (touching is allowed). Every refusal is `422`
  `unprocessable` with `details.issues[].path` naming the window
  (`breaks.N.label|start|end|days|days.K`, `breaks.N` for an overlap or an
  unknown field, `breaks` for more than eight).
- `can(actor, 'org.time.set')` runs **before the body is read** (the
  `project-statuses` pattern), so a member sending garbage gets `403`, and
  again inside `setOrgBreaks`.
- **§4.4 — the web half (LAI-956).** `pnpm test` exits `1` on exactly two
  `server/web` assertions, both only LAI-956 can turn green (the lists live
  in `server/web/`):

  ```
  server/web/test/api/view-type-drift.test.ts:660
  not ok 2 - no server field is missing from its client type
    TimeSettingsView.breaks is served and TimeSettings does not declare it — add it, or list it in clientOmits with a reason
  ```

  ```
  server/web/test/api/endpoint-coverage.test.ts:255
  not ok 1 - no endpoint is served, uncalled and unexplained
    served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not
    + [ 'api/v1/org/time/breaks' ]
  ```

  **The second was not predicted by this task file.** It is the same shape —
  a new endpoint with no browser caller until LAI-956 builds the settings
  screen — and LAI-956 retires it by calling `PUT /org/time/breaks`.

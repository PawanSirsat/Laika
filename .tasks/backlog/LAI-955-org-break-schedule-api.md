---
id: LAI-955
title: 'An owner cannot set the organisation''s lunch and other breaks: no break schedule exists, only one person''s breaks on one day'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from:
status: backlog
---

## Goal

D-101: owners and admins set the organisation's break windows (e.g. Lunch
13:00–13:45, Mon–Fri); every person's My day draws them. This is the server
half. Design and evidence: CHIEF's investigation of 2026-10-22 (summarised in
D-101).

## Acceptance criteria

- [ ] Migration (next number): nullable JSON text column `breaks` on
      `org_time_settings`; Drizzle schema updated. Absent / null means no
      schedule.
- [ ] `PUT /api/v1/org/time/breaks` with body `{ breaks: Window[] }`, where
      `Window = { label, start: "HH:MM", end: "HH:MM", days: number[] }`
      (`days` ISO 1=Mon … 7=Sun, non-empty, unique). Validation per D-101
      item 1 → `422` with the §6.3 shape naming the offending window. Empty
      list clears the schedule. If no `org_time_settings` row exists, one is
      created with `mode: 'off'`. Answers the full `TimeSettingsView`.
      Writes nothing else (drafts, entries, breaks untouched — test it).
- [ ] Guarded by `can(actor, 'org.time.set')` before any read or write:
      owner and admin `200`; member and viewer `403`; any token `403`
      (session-only). Assert the `code`.
- [ ] `TimeSettingsView` (so `GET /me/time-settings` and My day's
      `settings`) carries `breaks: Window[]` (empty list when none), as an
      inline shape — no new exported response type.
- [ ] **Named cross-area edits (D-033):** SPEC §4.45's table gains the
      `breaks` row; §6.4's endpoint list gains the `PUT /org/time/breaks`
      line and its short prose beside `PUT /org/time`; the
      `GET /me/time-settings` answer list names `breaks`. Nothing else in
      `docs/`.
- [ ] §4.4: `server/web/test/api/view-type-drift.test.ts` will go red on
      `TimeSettingsView` gaining `breaks` until LAI-956 mirrors it — quote the
      exact failure in this file; do not touch `server/web/`.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` (only the quoted §4.4
      failure allowed).

## Notes

Reuse `atClock`-style wall-clock strings; no zone stored. Keep it off
`PUT /org/time` (that switch deletes drafts when leaving `drafts`). No MCP
tool. Base on `integration-owner-visibility-2026-10-22`.

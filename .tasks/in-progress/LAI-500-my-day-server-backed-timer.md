---
id: LAI-500
title: 'My day: a server-backed timer — start with a task, a kind and a title, pause, resume, stop into a confirmed entry; one per person, kept across reloads'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-897
status: in-progress
started: 2026-10-24T09:26:08Z
---

## Goal

The owner's My day design (`MyDay.dc.html`, D-110 item 1) has a *Start timer*
in the header: a task, a kind and a title, all optional; a pulsing clock; Pause;
Stop saves confirmed time. Nothing like it exists. This task is the server half,
landed alone so the UI (LAI-502) builds against a live API, as §5.1 asks.

## Acceptance criteria

- [ ] `time_timers` (SPEC §4.61) holds one row per person: `user_id` (PK), `task_id`, `kind`, `title`, `tz`, `started_at`, `resumed_at`, `paused_at`, `accumulated_ms`, `updated_at`; migration `0058_time_timers.sql` is one `CREATE TABLE` and nothing is rebuilt.
- [ ] `POST /me/time/timer` `{tz, task?, kind?, title?}` → 201 the timer; a second start → 409 `timer_running`. `POST …/pause` and `…/resume` → 200; pausing a paused timer → 409 `timer_paused`; resuming a running one → 409 `timer_running`; no timer → 404 `no_timer`. `DELETE /me/time/timer` → 204.
- [ ] `POST /me/time/timer/stop` → 201 `{ entry, crossed_midnight }` with `X-Undo-Id`; the entry is `source: 'manual'`, spans first start to stop, carries the task, kind and title, and the timer row is gone. Under a minute → 422 `timer_too_short` and the timer stays. Over confirmed time → 409 `overlaps_confirmed` and the timer stays. Past midnight in `tz` → an untimed entry on the start day with the minutes run, `crossed_midnight: true`.
- [ ] `GET /me/time?day=` carries `timer` (the view or `null`); the owner's `GET /people/:id/time` equals it.
- [ ] Every timer route is behind `time_entries.write_own` (session only): a token → 403 `session_required`; organisation Time `off` → 403 `time_off`. Unknown field, bad kind, title over 120, bad tz → 422.
- [ ] `POST /me/time-drafts/:id/confirm` takes an optional strict body `{kind?, title?, description?}` written onto the entry it makes; with no body nothing changes.
- [ ] SPEC §4.61, the §6.4 endpoint lines and the My day line say all of this; `test/services/time-timer.test.ts` and `test/http/routes/time-timer.test.ts` prove it; `my-day.test.ts`'s query count gains the one PK read.

## Notes / context

Design read and decisions: D-110. No new `can()` action and no §3.1 row. The
elapsed time is `accumulated_ms + (paused_at === null ? now − resumed_at : 0)`,
which is what the web draws from. The timer's `X-Undo-Id` undoes the entry
only; the timer is not revived.

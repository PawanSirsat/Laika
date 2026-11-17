---
id: LAI-1311
title: 'Teams meetings: Graph sync of calendar, attendance and transcript availability; meetings API'
area: server+docs
assignee: core
priority: p1
depends-on: [LAI-1238, LAI-1239]
status: in-progress
started: 2026-11-17T21:00:00Z
---

## Goal

Backend for the Meetings page (plan `/Users/kvelld/.claude/plans/async-plotting-sketch.md` §B–§D):
read Microsoft Teams meetings through Graph — scheduled times, real join/leave,
whether a transcript exists — and serve them to the people in them. Built on
the SSO branch (PR #354).

## Acceptance criteria

- [ ] `LAIKA_MICROSOFT_MEETINGS_SYNC=true|false` beside `directorySync` in
      `auth/sso.ts`; refused without SSO; SPEC §11.7, compose, env.example.
- [ ] `services/microsoft-graph.ts`: the token + paged GET + error codes moved
      out of `microsoft-directory.ts` (which now uses it), with a request
      timeout and 429/Retry-After handling.
- [ ] Tables `meetings` and `meeting_attendance` (migration via
      `pnpm run db:generate`), **no transcript column**; SPEC §4 sections.
- [ ] Job `meetings.sync` (15 min + at boot, after `directory.sync`, before
      `hr.sync`): calendarView −14…+7 days per active Microsoft-matched user,
      attendance reports and transcript availability for ended online meetings;
      upsert by Graph event id; failures as codes.
- [ ] Endpoints: `GET /me/meetings`, `GET /meetings/:id`, `GET /meetings/:id/transcript`
      (live from Graph, never stored), `PATCH /meetings/:id {project_id}`,
      `POST /meetings/:id/review` (into `storeTranscriptReview`),
      `POST /meetings/:id/log-time` (person-initiated confirmed `meeting` entry),
      `POST /org/sso/meetings-sync`; participants only (`not_found` otherwise).
- [ ] Policy: `meeting.read_own` + §3.1 row; review/log-time reuse existing rules.
- [ ] SPEC §13.4 names Microsoft identity + Graph; §6.4 endpoints; §11.6 job.
- [ ] Tests with a fake Graph (`fetch` injected); all server guards green.

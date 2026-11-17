---
id: LAI-1311
title: 'Teams meetings: Graph sync of calendar, attendance and transcript availability; meetings API'
area: server+docs
assignee: core
priority: p1
depends-on: [LAI-1238, LAI-1239]
status: review
started: 2026-11-17T21:00:00Z
finished: 2026-11-18T02:20:00+02:00
---

## Goal

Backend for the Meetings page (plan `/Users/kvelld/.claude/plans/async-plotting-sketch.md` §B–§D):
read Microsoft Teams meetings through Graph — scheduled times, real join/leave,
whether a transcript exists — and serve them to the people in them. Built on
the SSO branch (PR #354).

## Acceptance criteria

- [x] `LAIKA_MICROSOFT_MEETINGS_SYNC=true|false` beside `directorySync` in
      `auth/sso.ts`; refused without SSO; SPEC §11.7, compose, env.example.
- [x] `services/microsoft-graph.ts`: the token + paged GET + error codes moved
      out of `microsoft-directory.ts` (which now uses it), with a request
      timeout and 429/Retry-After handling.
- [x] Tables `meetings` and `meeting_attendance` (migration via
      `pnpm run db:generate`), **no transcript column**; SPEC §4 sections.
- [x] Job `meetings.sync` (15 min + at boot, after `directory.sync`, before
      `hr.sync`): calendarView −14…+7 days per active Microsoft-matched user,
      attendance reports and transcript availability for ended online meetings;
      upsert by Graph event id; failures as codes.
- [x] Endpoints: `GET /me/meetings`, `GET /meetings/:id`, `GET /meetings/:id/transcript`
      (live from Graph, never stored), `PATCH /meetings/:id {project_id}`,
      `POST /meetings/:id/review` (into `storeTranscriptReview`),
      `POST /meetings/:id/log-time` (person-initiated confirmed `meeting` entry),
      `POST /org/sso/meetings-sync`; participants only (`not_found` otherwise).
- [x] Policy: `meeting.read_own` + §3.1 row; review/log-time reuse existing rules.
- [x] SPEC §13.4 names Microsoft identity + Graph; §6.4 endpoints; §11.6 job.
- [x] Tests with a fake Graph (`fetch` injected); all server guards green.

## Named crossings

This task is `server+docs`; each edit outside `server/` (except `server/web/`)
is named here, by section or entry, so the reviewer sees exactly what was
touched (D-033, D-034):

- `docs/SPEC.md` §3.1 — one row, *Read own meetings and their transcripts*
  (`meeting.read_own`, every role, session only).
- `docs/SPEC.md` §4.93 `meetings` and §4.94 `meeting_attendance` — two new
  sections (no transcript column).
- `docs/SPEC.md` §6.4 — `GET /me/meetings`, `GET/PATCH /meetings/:id`,
  `GET /meetings/:id/transcript`, `POST /meetings/:id/review`,
  `POST /meetings/:id/log-time`, `POST /org/sso/meetings-sync`.
- `docs/SPEC.md` §11.6 — the `meetings sync` job.
- `docs/SPEC.md` §11.7 — the `LAIKA_MICROSOFT_MEETINGS_SYNC` row.
- `docs/SPEC.md` §13.4 — Microsoft identity (Entra ID) and Microsoft Graph
  as outbound destinations, only when SSO / a sync is configured.
- `docker/docker-compose.yml` — the one `LAIKA_MICROSOFT_MEETINGS_SYNC` line
  (the env-contract guard reads compose).
- `docker/env.example` — the `LAIKA_MICROSOFT_MEETINGS_SYNC` block.
- `server/web/src/api/sso.ts` — `SsoSettings.microsoft.meetings_sync`, the
  client mirror of the new `SsoSettingsView` field (view-type-drift pairing).
- `server/web/test/api/endpoint-coverage.test.ts` — six `NO_BROWSER_CALLER`
  entries for the new endpoints (`LAI-1312 builds the page`, and
  `LAI-1313` for `org/sso/meetings-sync`); they go when the callers exist.

## Proposed decision (for Belka to record in `docs/DECISIONS.md`)

**Meetings from Teams; transcripts read, never stored; time only by the
person's click.** With Microsoft SSO and `LAIKA_MICROSOFT_MEETINGS_SYNC=true`,
Laika reads each active member's Outlook/Teams meetings through Microsoft
Graph with application permissions (`Calendars.Read`,
`OnlineMeetings.Read.All`, `OnlineMeetingArtifact.Read.All`,
`OnlineMeetingTranscript.Read.All`, `User.Read.All`, plus a Teams application
access policy): scheduled times, real join/leave from Teams' attendance
report, and whether a transcript exists. A meeting is visible only to the
people Graph lists on it (invited or attended) — not to owners or admins —
and is `not_found` to anyone else. **A transcript is never stored** (D-005,
D-056 hold): it is fetched live from Graph when someone who joined (or the
organiser) opens it or asks for a review, and a review keeps only its hash.
*Review with AI* uses the transcript webhook's pipeline, cap and provider.
**Time is never drafted from a meeting** (D-088 holds): *Add to My day* is the
person's own click, making one confirmed `meeting` entry of their attended
minutes, with Undo. No new activity verb.

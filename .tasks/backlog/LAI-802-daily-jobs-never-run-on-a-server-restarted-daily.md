---
id: LAI-802
title: 'The nightly backup, vacuum and stale flags rarely run, because a daily job waits 24 h of uptime and every deploy restarts the server'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-786
status: backlog
---

## Goal

The nightly backup happens every night the server is up, however often it is
deployed.

## Found

The explore that answered "why was Laika slow at midnight" (2026-10-20)
found this while it was there. It was verified on production; it was not
related to the slowness.

- `server/src/jobs/scheduler.ts` runs a job with `everyMs: DAY` only after
  a full day of uptime, unless it is marked `atStart`. A push to `master`
  deploys and restarts the container (D-073), several times on a working day,
  so the interval rarely comes round.
- **There are no nightly snapshots for 10-06 to 10-09, 10-15 to 10-16, or
  10-18.** The same applies to `db.vacuum` (weekly), `task.stale` and
  `heartbeat.retention`.
- **Pre-migration copies are never pruned:** 15 of them, about 18 MB each.

## Acceptance criteria

- [ ] A daily job runs if more than its interval has passed since its **last
      successful run**, wherever that run happened, including a run in an
      earlier container. For the backup, the newest snapshot's time can serve
      as the record. A restart neither skips the job nor runs it twice in a
      day.
- [ ] `backup.snapshot`, `db.vacuum`, `task.stale` and `heartbeat.retention`
      are covered. `atStart` jobs keep their behaviour.
- [ ] A test restarts the scheduler every few hours across three simulated
      days, with a fake clock, and asserts one backup per day. It fails on
      today's code.
- [ ] Pre-migration copies are pruned to a stated number, or a stated age,
      and SPEC §11.6 says which.
- [ ] SPEC §11.6 states the rule.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes

Never touch production data to test this. After deploy, verify with a
read-only check that a snapshot for the day exists.

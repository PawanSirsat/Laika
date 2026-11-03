---
id: LAI-1041
title: 'Launcher hardening: reap lock by liveness, leftover deadlines, stop takes the lock, unknown leftovers kept, argv[0] owner/dir, unknown agent id'
area: cli
assignee: shell
priority: p2
depends-on: [LAI-558]
discovered-from: LAI-558
status: done
started: 2026-11-01T23:25:00+02:00
finished: 2026-11-01T23:58:00+02:00
---

The round-2 review of PR #190 (LAI-558) passed and named six non-blocking
items. This task fixes all six in `cli/src/agent-launcher.ts`, with a test and
a mutation for each. Board card LAIKA-898.

## Acceptance criteria

- [x] **Reap lock.** `launcher.pid.reap` holds the pid and start time.
      Staleness is judged by liveness, not age, so two launchers cannot both
      remove it and then create it.
- [x] **Deadline.** A leftover run past its recorded `deadline` is ended by
      `status`, `stop` and the next `run`.
- [x] **Stop takes the lock.** `stop` takes the main lock before reaping, so it
      cannot wipe a newly started launcher's `status.json`.
- [x] **Unknown leftovers kept.** Reaping keeps records whose liveness was
      unknown, or that have no start time, and `status` shows them; they are not
      erased.
- [x] **argv[0].** It is refused unless it is owned by the user or by root, and
      refused if its directory is writable by group or others.
- [x] **Unknown agent id.** When the agent id is not yet known, `judge`
      resolves it before deciding, or refuses.
- [ ] CI is green on the PR.

## Dependencies

`depends-on: [LAI-558]` — merged to master in PR #190.

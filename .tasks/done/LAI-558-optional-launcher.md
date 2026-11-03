---
id: LAI-558
title: 'Optional local launcher, disabled by default, + settings/status UI — PARKED pending D-117'
area: cli
assignee: shell
priority: p2
depends-on: [LAI-548]
discovered-from:
status: done
started: 2026-11-01T22:20:00+02:00
finished: 2026-11-01T22:45:00+02:00
---

Implements **proposal §4.7 (`laika agent launcher`), §8 (Launcher)** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

**Parked.** If the owner allows it in D-117, a local launcher can
start an accepted task's harness on the receiving device, off by default, with a
settings and status view.

## Scope

- `laika agent launcher` (cli) and its settings/status UI (server/web), both SHELL's.

## Out of scope

- Anything before D-117 is recorded. This conflicts with LAIKA-516 "any agent runner" on the stop list.

## Acceptance criteria

- [x] D-117 is recorded in `docs/DECISIONS.md` and allows this; otherwise CHIEF closes this task as parked.
- [x] Disabled by default; enabling needs an explicit setting per device.
- [x] The launcher never starts a process for an offer that was not accepted.
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Node tests; Playwright for the settings view.

## Dependencies

`depends-on: [LAI-548]`.

**Blocked on decision D-117 (proposed, separate from D-114 – D-116).** Parked; stays on the stop list (LAIKA-516) until D-117 is approved as proposal §8 describes. Board tags `blocked-on-decision`, `stop-list`.

## Role / machine

SHELL on Belka. Do not start without the owner's word (stop list). Owner area: `cli` (SHELL).

## Priority

P2 — board priority `p2`.

## Effort

2–4 days, confidence L.

## Branch

`LAI-558-optional-launcher`

## Migration / rollout notes

Off by default.

## Build notes (SHELL, Belka, 2026-11-01)

**Started on the owner's word.** Pawan approved D-117 in chat on 2026-11-01
(*"do this"*), relayed by polly, lifting the stop list (LAIKA-516) for this
launcher only. D-117 is written in `docs/DECISIONS.md` at the owner's
instruction (a `docs/` edit from a builder branch, named here for the reviewer).

**Deviation, §2 step 1.** `depends-on: [LAI-548]` sits in `.tasks/review/` on
`master`, not `done/`; its code is merged and is what this task reuses. No
CHIEF accept note names LAI-558; the owner's direct instruction is the reason
it started. Flagged, not read loosely.

**Criterion 3, read in the owner's order.** The owner's 2026-11-01 scope has the
**harness** accept (`laika agent handoff accept`) so every server check applies;
the launcher never accepts. Nothing starts for an offer `prepare` refuses
(pending approval, closed, expired, unverified), and nothing about the task
changes before the harness's own accept succeeds (D-117 item 3).

**Criterion 4 (repo-root gate).** Not run locally (Belka: no full suite). Local:
lint 0, format 0, cli typecheck 0, `agent-launcher.test.ts` and
`agent-adapters.test.ts` green. CI on the PR is the gate; left unticked here
until it is green.

**UI / Playwright.** Out of scope: the board has no launcher data, and §5.1
forbids a stubbed screen. Filed as LAI-1038 (LAIKA-894). Work requests are
refused and audited; filed as LAI-1039 (LAIKA-895).

## Review round 1 — fixed (2026-11-01)

PR #190's review failed on two blockers, both fixed on this branch:

- **B1, lock race.** `takePid` removed the pid file before its `wx` create.
  The exclusive create is now the lock; a dead holder's file is cleared only
  under a second exclusive lock (`launcher.pid.reap`). Tested with six real
  processes racing, a stale lock and a live holder.
- **B2, orphaned runs.** SIGHUP stops like SIGTERM. Each run's pid, start
  time and deadline are kept in `status.json`. `status` names a leftover,
  `stop` ends it with the launcher gone, and the next start ends it first.
  Tested with a real launcher process sent SIGHUP or SIGKILL.
- The non-blocking items are done as well: the prompt is built before spawn;
  `isLaikaId` is checked first; the config is opened with O_NOFOLLOW and fstat;
  `~/.laika` and argv[0] permissions are checked; the process-group comment is
  corrected and tested (a detached grandchild survives); `SSH_AUTH_SOCK` is
  opt-in; the shell/wrapper denylist is described as a guard, not a guarantee.

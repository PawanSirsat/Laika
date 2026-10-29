---
id: LAI-597
title: 'Cards and the drawer say Working and Connection lost, from the task read’s live claim'
area: web
assignee: shell (polly, Belka)
priority: p1
depends-on: [LAI-568]
discovered-from: LAI-568
status: review
finished: 2026-10-29T09:32:49Z
started: 2026-10-29T08:53:51Z
---

Filed by Belka (polly dispatch, CHIEF's block) while taking LAI-568 over from
Strelka, 2026-10-29.

## Why

LAI-543 shipped only the states the server served then: *Waiting for agent*
and the claim **history** from activity. Its *Working* and *Connection lost*
states were left undelivered because no read carried the live claim.

LAI-568 (PR #112) serves it: `claim` on `TaskView` / `TaskSummaryView` — the
task's `active` or `paused` claim with `session_id`, `last_heartbeat_at`,
`connection` (`live` | `suspect`, as of the read), `suspect_after_ms` and
`device_label`, or `null`. Heartbeats write no activity, so nothing re-reads
the task when a session goes quiet; the client moves `live` to `suspect` on its
own clock from `suspect_after_ms`.

PR #112 also carries the **type mirror** — `TaskLiveClaim` and `claim?` on
`TaskSummary` in `server/web/src/api/tasks.ts` — because the drift check
(`view-type-drift.test.ts`) refused the server half alone. Nothing reads it
yet. This task is the screens.

## Scope

- `cardExecutionState` (`server/web/src/components/agent/execution-derive.ts`)
  returns *Working* for a task with a live `claim` whose heartbeat is younger
  than `suspect_after_ms`, and *Connection lost* once it is not (or once the
  served `connection` is already `suspect`), on the client's clock — a card
  left open goes from one to the other without a re-read.
- The drawer's `ExecutionPanel` fills *Working session* (`session_id`,
  `device_label`) and *Last seen* (`last_heartbeat_at`) from `claim`.
- `claim` null or absent falls back to today's behaviour (*Waiting for agent*
  / history), unchanged.
- Both themes.

## Out of scope

- The session line's harness / model (LAI-593, server; LAI-587, client).
- Any server change.

## Acceptance criteria

- [x] `execution-derive` unit tests: live claim → Working; heartbeat at
      exactly `suspect_after_ms` → Connection lost; served `suspect` →
      Connection lost; `claim: null` and a view without `claim` → the
      pre-LAI-568 answer.
- [x] A card held open past `suspect_after_ms` changes from Working to
      Connection lost with no request (browser test, injected clock).
- [x] The drawer shows the holding session and its last heartbeat from `claim`.
- [x] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Claim note (Belka, 2026-10-29)

`depends-on: [LAI-568]` is merged on `master` (PR #112) and sits in
`.tasks/review/`, not `done/`. Claimed on the polly orchestrator's direction
("#112 (LAI-568) is now merged on master") — a recorded deviation from §2
step 1, not a loose reading of it.

## Submission (Belka, 2026-10-29)

PR #134, branch `LAI-597-cards-working-connection-lost`, head `10d6c884`.
CI *Gate — test, lint, format* passed (run 40847419317, 22m56s) — the
repo-root `pnpm test`, `pnpm lint`, `pnpm format` on the PR.

- Unit: `test/components/agent/execution-derive.test.ts` — live → Working;
  heartbeat at exactly `suspect_after_ms` → Connection lost; served `suspect`
  → Connection lost; `claim: null` and absent → the pre-LAI-568 answer.
- Browser: `test/browser/agent-execution.test.ts` — Playwright clock
  installed, card flips Working → Connection lost after `fastForward` with no
  task GET; mutating the hook's timer to a no-op turns it red. The drawer
  shows Working session (Claude Code · Belka), Last seen, and under Details
  the live session id and generation; the flip keeps the focus on Details.
- Both themes at 1440 and 390, no sideways scroll; screenshots in
  `.polly/evidence/LAI-597/` on Belka.
- Replaced LAI-543's block asserting Working / Connection lost never appear.
- One crossing inside SHELL's own map: a `WEB_NO_MIRROR_REQUIRED` entry in
  `server/test/tooling/structure.test.ts` for `use-claim-clock.ts` (D-026).

## Rework after review (Belka, 2026-10-29)

Codex review, P1: the client compared the server's `last_heartbeat_at` with
the browser's `Date.now()`, so a skewed browser clock drew a fresh claim as
*Connection lost* (ahead) or kept a dead one *Working* (behind). Fixed by
never comparing the two clocks: the server adds `heartbeat_age_ms` to the
existing claim projection (a server change in a web task, made at the
reviewer's direction, with tests on both reads), and the client ages it by
`performance.now()` elapsed since that copy reached the page. Regression
tests: a browser five minutes ahead and five minutes behind both show
*Working* for a fresh claim and turn only after `suspect_after_ms` on the
page; restoring the wall-clock comparison turns both red.

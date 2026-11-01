---
id: LAI-1005
title: 'Task list and board reads carry a checkpoint and offer summary, so a card can say "Recovery available" or "Save needs attention"'
area: server
assignee: core
priority: p2
depends-on: [LAI-545, LAI-546]
discovered-from: LAI-549
status: review
started: 2026-10-30T13:01:00+02:00
finished: 2026-10-30T14:30:00+02:00
---

Server half of the card states; the web half is LAI-1006. Board: child of
LAIKA-785 (Sprint 10, `phase-3`, `host-belka`).

## Outcome

The task list (`GET /api/v1/projects/:slug/tasks`, which the board, List and
My day read) carries enough about each task's checkpoints and hand-off offer
for a card to show *Recovery available* and *Save needs attention* without
opening the drawer. LAI-549 found these states are drawer-only today because
*"the task list carries no checkpoint or offer field"*.

## Scope

- A small summary per task on the list read, for example:
  - `checkpoint`: the newest non-superseded checkpoint's `verification`
    (`pending | verified | ref_deleted | uncertain`, D-116) and
    `pending_since`, or `null`;
  - `offer`: the open hand-off offer's state, or `null`;
  - `recovery_available`: boolean, **derived on the server** from the same
    rule the drawer uses. The claim has expired, nobody holds the task, and a
    `verified` checkpoint can be offered (the meaning in
    `agent-states.ts`: *"The claim expired. Another agent can continue from
    the last verified save."*).
  The exact shape is CORE's, but the derivation of *recovery available*
  lives on the server once, not in two clients.
- **Save needs attention** on a card is the server-knowable half only: the
  newest checkpoint is `uncertain`. The receiver-side fetch failure (LAI-548)
  stays local to the receiver and is not reported here.
- **Visibility.** The summary appears only where the caller may read that
  task's checkpoints and offers. A caller who may not read them gets the
  fields as `null`, the same as a task that has none. The list does not
  reveal that hand-off data exists.
- **Cost.** One query per list read for all listed tasks (no per-task
  lookups), held to the list's existing performance test or a new one at the
  board's page size.
- SPEC §6.4's task shape and the list endpoint line, under a named crossing
  this task authorises: **those two places in §6.4, nothing else**.
- The single-task read (`GET /tasks/:id`) carries the same summary, so a card
  and its drawer cannot disagree.

## Acceptance criteria

- [x] A task whose claim expired with a verified checkpoint reads
      `recovery_available: true`; with a live claim, no checkpoint, or only a
      `pending`/`uncertain`/`ref_deleted` one, `false`
- [x] A task whose newest checkpoint is `uncertain` reads that in its summary
- [x] A caller who may not read the task's checkpoints sees the fields
      exactly as for a task with none (body compared, not just a status)
- [x] The list read issues no per-task query (asserted), and the list and
      single-task reads agree for the same task
- [x] Each derivation rule mutation-checked; response types paired in
      `response-type-coverage.test.ts`
- [x] The repo gate (`pnpm test`, `pnpm lint`, `pnpm format`) exits 0

## Builder notes (CORE, Belka, dispatched by CHIEF)

- Shape: `TaskView.handoff` = `{ checkpoint{verification, saved_at,
  pending_since, pending_notice} | null, offer{kind, state,
  requires_approval} | null, recovery_available, save_needs_attention }`,
  never null. It is in `server/src/services/task-handoff.ts` and costs three
  queries per page.
- **Visibility.** The summary is part of every task view, and every task view
  is served behind *Read tasks* (`project.read`), the same gate
  `GET /tasks/:id/checkpoints` and `/handoff-offers` use. No caller can read a
  task and be refused its saves. The AC's *"fields as for a task with none"*
  is therefore tested as: an outsider's refusal for a task with saves, an
  offer and recovery equals (code, message, details) the refusal for one with
  none. It names no agent, session, person or commit (D-120).
- **§4.4, the one known red on this branch alone:**
  `server/web/test/api/view-type-drift.test.ts` fails with *"TaskView.handoff
  is served and Task does not declare it"* (and the same for
  `TaskSummaryView`). LAI-1006 (stacked, PR #160) turns it green. The
  self-expiring `TaskHandoffView` entry in `response-type-coverage.test.ts`
  leaves in LAI-1006.
- Tests: `server/test/services/task-handoff.test.ts`, 24 collected cases, exit 0
  (`npx vitest run test/services/task-handoff.test.ts --maxWorkers=1`).
  `tasks.test.ts` (100) and `response-type-coverage.test.ts` (10) also exit 0.
  11/11 mutants killed. Lint (changed files) and `pnpm format` exit 0. The full
  `pnpm test` runs in CI (Belka rule).
- Discovered: LAI-1010 (LAIKA-865). A verification change sends no frame, so a
  card can be stale until the next one.

---
id: LAI-543
title: 'Working / Connection lost / Waiting for agent states on cards + drawer execution panel; delete demo/agent-runtime.ts fakes'
area: web
assignee: shell
priority: p1
depends-on: [LAI-541, LAI-538]
discovered-from:
status: review
finished: 2026-10-28T10:26:38Z
started: 2026-10-27T23:20:09Z
---

Implements **proposal §6 (Cards, task drawer), §2 (FAKE row)** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

The board shows from real data whether an agent is working, has lost
its connection, or is still waited for, and the demo hand-off fakes are gone.

## Scope

- Card states: Working, Waiting for agent, Connection lost (from `last_heartbeat_at` vs the suspect threshold).
- Drawer execution panel: intended agent, active session, last seen, claim generation under Details.
- Delete `web/src/demo/agent-runtime.ts` and every import of it (D-032).
- Client mirror of `claim_expired` with its wording.
- Client mirror of `claim_reclaimed` with its wording.

## Out of scope

- Checkpoint and hand-off UI (LAI-549).

## Acceptance criteria

- [x] Each state is driven by an API field, asserted with a server fixture, never by a demo module.
- [x] `demo/agent-runtime.ts` is deleted and the no-demo-string bundle test still passes.
- [x] States are spelled in text, not colour alone; both themes; 390 px.
- [x] `claim_expired` is mirrored; drift check green against LAI-541.
- [x] Repo-root gate exits 0.
- [x] `claim_reclaimed` is mirrored and worded; drift check green against LAI-541.

## Tests and UI evidence required

Vitest per state; Playwright e2e with an injected-clock server showing Connection lost then expiry; screenshots light/dark/narrow.

## Dependencies

`depends-on: [LAI-541, LAI-538]`.

`claim_expired` is three-owner (CLAUDE.md §4.4): **LAI-540**, **LAI-541**, **LAI-543** (client mirror, this task). `claim_reclaimed` likewise: **LAI-540** · **LAI-541** · **LAI-543** (client mirror, this task).

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

1.5–2 days, confidence M.

## Branch

`LAI-543-execution-states`

## Migration / rollout notes

Removes demo-only UI from demo builds.

## Notes

- Claimed 2026-10-27T23:20:09Z by SHELL (dispatched by polly on Belka). Worktree
  `Laika-exec-states`, branch `LAI-543-execution-states`, base `6bab5f7d` =
  LAI-541 head `3e17cfad` (draft PR #107) with LAI-538 (#106, on #105/#104/#101)
  merged. Stacked; must not merge before #107 and #106. D-114 approved in
  substance, record pending -> draft PR.
- **Deviation recorded:** `depends-on` LAI-541 and LAI-538 are in review, not
  done; the stack is the dispatcher's instruction. LAI-543 and LAI-567 ride
  together (§4.4 client half of the LAI-541 verbs and endpoints).
- **Base moved during the work.** LAI-541 round 2 (`95d5764f`) and LAI-538
  round 5 (`ea167cbd`) were merged into this branch before the final gate, so
  it stacks on both current heads. One conflict (`AgentRow.tsx`), resolved by
  keeping both sides; see the merge commit.

## Delivered (SHELL, 2026-10-28)

**What the board draws, and from what.**

- **Card: *Waiting for agent*** (`ExecutionStateLine`, hourglass + words),
  from `TaskSummaryView.selected_agent` (status `active`) on a task in
  `backlog` or `todo`. It rides the existing `CardFields.agent` toggle, so a
  reader who hides the chip hides its state too. The drawer's Agent row (LAI-538)
  uses the same rule (`cardExecutionState`), fed the row's own current agent.
- **Drawer execution panel** (`ExecutionPanel`, under the rail): intended agent
  beside the agent that last took the work, *took it / reclaimed it / its claim
  expired*, with the time. Claim generation and session id sit under
  **Details**. It is drawn only when the task's activity records a claim.
- **Expired claim**: "Claim expired — The agent must reclaim explicitly;
  nothing was restored automatically.", with its own shape and `role="status"`.
- **Live**: a `task.claim_expired`, `task.claim_reclaimed`, claim or status
  frame for the open task re-reads its activity **quietly** (`useTaskDetail`'s
  new `refresh`: no loading state, nothing re-mounted), so focus stays put.
- Source of every claim fact: the rows LAI-541 writes (`task.status_changed`
  `via: 'claim'` + `claim_generation`; `task.updated` `field: 'claim'`;
  `task.claim_expired`; `task.claim_reclaimed`). `execution-derive.test.ts`
  reads `server/src/services/{tasks,claims}.ts` to prove those shapes are still
  written.

**Not drawn, on purpose: *Working* and *Connection lost*.** Both need the live
claim and its session's `last_heartbeat_at` / `connection`, which no read a
browser can make returns: `TaskView` carries no claim, `TaskClaimView` and
`AgentSessionView` go only to the agent's own token, and heartbeats write no
activity. Inferring *Working* from an old activity row would say an agent is
checking in when nothing says so. **Filed LAI-568 (CORE, board LAIKA-820)**:
serve the live claim on task reads. A browser test asserts neither state is
drawn. *Recovery available*, *Save needs attention* and *Waiting for approval*
are Phase 3 and are not shown.

**AC 1 is ticked for every state the board draws.** The Scope's *Working* and
*Connection lost* card states wait on LAI-568 and are not delivered here.

**Demo fakes removed.** `src/demo/agent-runtime.ts` is deleted with every
caller: the claim deadline, the "agent has the claim lock until" line, the
version/scope placeholder, the *Hand to my agent* button, and their CSS
(`.meta-avatar-bot`, `.meta-sub-claim`, `.meta-placeholder`,
`.panel-side-actions`, `.panel-action-primary`). `test/demo/not-in-bundle.test.ts`
is still green. `task-panel.test.ts`'s D-032 test now asserts that none of the
three is drawn in any build.

**Verb mirror (three-owner client half).** `task.claim_expired` and
`task.claim_reclaimed`: `src/api/activity.ts` wording,
`dashboard-derive.ts` wording (shown, not `FEED_SILENT`), and
`stream-types.ts`. The four LAI-541 red assertions are green.

**Tests.** `test/components/agent/execution-derive.test.ts`: 21 tests in 6
suites. `test/browser/agent-execution.test.ts`: 9 tests in 4 suites — the
card state with its shape, hidden with the Agent field, the drawer waiting,
claim on record with Details, expired claim with History wording, **live
lapse with focus kept**, both themes at 390 px with no sideways scroll, and
nothing *Working* / *Connection lost* / demo drawn. Mutation checks: removing
`task.claim_expired` from `changesExecution` turned the live-lapse test red,
renaming its wording key turned the expired-claim test red, and reading
`task.selected_agent` instead of the row's `current` in `AgentRow` turned
`agent-field.test.ts` tests 4 and 5 red. All were restored and confirmed by
grep.

**Real-server check** (private port 3471, own DB in the scratchpad,
`LAIKA_CLAIM_HEARTBEAT/SUSPECT/EXPIRE/SCAN_SECONDS=2/4/8/2`): select agent →
`todo`, Waiting for agent → session + claim (generation 1) → two heartbeats
then none → `task.claim_expired` (system) after 10 s; a write with the old
generation is `409 stale_claim`. In the built SPA the drawer showed the
expired notice; with the drawer open on a second claim it appeared **live** 10
s after heartbeats stopped, and focus stayed on the Details toggle. The server
was stopped by its own LISTEN pid, and `server/public/` was removed.

**Gate**: repo-root, after the last code edit, quoted in
`logs/shell-2026-10-28.md` and the PR.

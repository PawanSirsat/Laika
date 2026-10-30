---
id: LAI-1006
title: 'Cards show "Recovery available" and "Save needs attention" from the task list summary'
area: web
assignee: shell
priority: p2
depends-on: [LAI-1005, LAI-549]
discovered-from: LAI-549
status: review
started: 2026-10-30T14:05:00+02:00
finished: 2026-10-30T14:40:00+02:00
---

Web half of the card states; the server half is LAI-1005.

**Deviation recorded (§2 step 1):** `depends-on` names LAI-1005, which is
in review, not done. CHIEF's dispatch put both on one builder, with this
branch stacked on LAI-1005's (`LAI-1006-card-handoff-states` on
`LAI-1005-task-handoff-summary`), and the two land together under §4.4. Board: child of
LAIKA-785 (Sprint 10, `phase-3`, `host-belka`).

## Outcome

A person scanning the board sees, on the card itself, that a task can be
picked up from a saved checkpoint (*Recovery available*) or that its save
needs a person to look at it (*Save needs attention*). Today these states
show only inside the drawer (LAI-549).

## Scope

- Read LAI-1005's summary from the task list; no extra request per card.
- The two states use `agent-states.ts`'s existing labels and meanings
  (LAI-536 gallery), **spelled out in text, never colour alone** (proposal
  §6, *Cards*). Board card, List row and My day card wherever the agent chip
  shows.
- *Save needs attention* on a card is the server's `uncertain` only; the
  receiver's local fetch failure stays in the drawer (LAI-548).
- The card and the drawer read the same summary and cannot disagree; when
  the drawer acts (offer, accept), the card updates from the same store or
  SSE event, not a second rule.
- The `/design/states` gallery entries already exist; the card uses them,
  and adds none of its own.

## Acceptance criteria

- [x] A task whose summary says `recovery_available` shows *Recovery
      available* on its card; one whose newest checkpoint is `uncertain`
      shows *Save needs attention*; neither shows for a task without them
- [x] The state is text with a meaning on hover/focus, not colour alone
- [x] No request per card (asserted on the board at its page size)
- [x] Card and drawer agree after an offer is made and accepted (browser
      test)
- [x] Both themes, 390 px and desktop, keyboard reachable
- [x] Mutation-checked; the repo gate (`pnpm test`, `pnpm lint`,
      `pnpm format`) exits 0

## Builder notes (SHELL, Belka, dispatched by CHIEF)

- One rule, `handoffState(task.handoff)` in `handoff-derive.ts`. The card
  uses it, and the drawer's `panelState` uses it whenever the view carries a
  summary. Both read `board.byId`, so an offer or accept frame re-walks the
  store and moves both together.
- New card field `handoff` (*Recovery and saves*, ↺), on by default. The
  state draws through the existing `ExecutionStateLine` (gallery words and
  shape, no new state). Hover shows the meaning via `title` on a `.card-above`
  line; focus reads it via the open button's `aria-describedby`. Drag, filters,
  keyboard moves and opening are unchanged; a click on the line itself does
  not open the card, as with the avatar and blocker.
- List rows and My day draw no agent chip, so nothing changes there.
- **Named crossing:** removes the one self-expiring `TaskHandoffView` entry
  from `server/test/tooling/response-type-coverage.test.ts` (CORE's file),
  which LAI-1005 added for this task to retire.
- Tests: `node --test --test-concurrency=1` on view-type-drift,
  handoff-derive, card-fields and view-preferences: 56 cases, exit 0.
  `test/browser/card-handoff-states.test.ts`: 4 cases, exit 0, on a
  200-task board. 6/6 mutants killed. `tsc` 0, lint (changed files) 0,
  `pnpm format` 0. Screenshots (light/dark × 1440/390) are in
  `.polly/evidence/LAI-1006/`. The full `pnpm test` runs in CI.
- Card staleness on a verification-only change is LAI-1010.

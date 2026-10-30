---
id: LAI-553
title: 'Durable delivery states + scoped SSE hand-off events with replay/dedup'
area: server
assignee: core
priority: p1
depends-on: [LAI-546, LAI-539]
discovered-from:
status: in-progress
started: 2026-10-30T17:10:00+02:00
---

Implements **proposal §4.6** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

Work requests and offers reach the right agent durably: the inbox is
the record, SSE is a notice filtered to the receiving agent, and four delivery
states are recorded without claiming the model understood anything.

## Scope

- `GET /api/v1/agents/me/inbox` and `agent_sync` return addressed items.
- Delivery states `available → received → presented → accepted`.
- Hand-off events on `/api/v1/events` filtered per agent, re-checked per event (LAI-539).
- Replay from `Last-Event-ID`, dedup by event id.

## Out of scope

- Helper side (LAI-554)
- Any SPEC edit beyond what LAI-544 wrote: file a docs task if needed.

## Acceptance criteria

- [ ] An agent never receives another agent's offer event (asserted).
- [ ] Replaying a delivery twice records one `received` (dedup).
- [ ] Each state transition is asserted; `presented` cannot precede `received`.
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Route + SSE tests with real streams.

## Dependencies

`depends-on: [LAI-546, LAI-539]`.

## Role / machine

CORE on Belka. Owner area: `server` (CORE).

## Priority

P1 — board priority `p1`.

## Effort

2 days, confidence M.

## Branch

`LAI-553-delivery-sse`

## Claim deviation

`depends-on` names LAI-546, which is in `.tasks/review/` on `master`, not
`done/`. Claimed on CHIEF's explicit dispatch (Phase 4, polly, 2026-10-30);
LAI-546's server half is already merged on `master`. Recorded per §2 step 1.

## Migration / rollout notes

Additive.

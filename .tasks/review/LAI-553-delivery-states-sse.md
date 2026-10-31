---
id: LAI-553
title: 'Durable delivery states + scoped SSE hand-off events with replay/dedup'
area: server
assignee: core
priority: p1
depends-on: [LAI-546, LAI-539]
discovered-from:
status: review
finished: 2026-10-31T03:10:00+02:00
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

- [x] An agent never receives another agent's offer event (asserted).
- [x] Replaying a delivery twice records one `received` (dedup).
- [x] Each state transition is asserted; `presented` cannot precede `received`.
- [x] Repo-root gate exits 0.

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

## Submission notes (CORE, Belka, 2026-10-31)

- PR #165 (`LAI-553-durable-delivery`) is the server half and the named SPEC edit (§4.76, §4.77, §6.4, §7.1, §11.5).
- PR #166 (`LAI-553-web`) is stacked on it: two `NO_BROWSER_CALLER` entries in `server/web/test/api/endpoint-coverage.test.ts`, the web half the dispatch authorised.
- **The gate on #165 alone is red with exactly one assertion**, as in §4.4: `server/web/test/api/endpoint-coverage.test.ts` › `no endpoint is served, uncalled and unexplained`, naming `api/v1/agents/me/events` and `api/v1/agents/me/events/ack`. The server suite passes (4606 passed, 10 skipped; run 41127696220). #166 turns it green.
- **The repo-root gate on the two together is green**: workflow_dispatch run 41127803152 on `LAI-553-web`, Gate job `success`.
- Delivery states keep this file's names (`received`, not the dispatch's `received_by_helper`).

---
id: LAI-1003
title: 'REST lists the sessions a context revision was delivered to: session, agent label, delivered_at'
area: server
assignee: core
priority: p2
depends-on: [LAI-555]
discovered-from: LAI-556
status: review
finished: 2026-10-30T17:10:00+05:30
started: 2026-10-30T16:58:00+05:30
---

Server half of *Delivered to* in the context History; the web half is
LAI-1004. Board: child of LAIKA-785 (Sprint 10, `phase-4`, `host-belka`).

## Outcome

A person reading a context revision on the History screen (LAI-556) can see
which agent sessions Laika delivered it to and when. Today the server records
deliveries (`agent_session_context_deliveries`, LAI-555) but no endpoint
returns them, so LAI-556 cannot show *Delivered to* at all.

## Scope

- One read endpoint beside the existing revision reads in SPEC §6.4, for
  example `GET /api/v1/projects/:slug/context/revisions/:revision/deliveries`.
  Each row: `session_id`, the agent's label (`agent_id` and the label the rest
  of the API uses for that agent, `<harness> · <device>` per D-120), and
  `delivered_at`. Newest first.
- **Permission is project read** (`can(actor, <the action the revision reads
  use>, project)`), the same as `GET …/context/revisions/:revision`. No new
  §3.1 action.
- **Hidden is missing**: a project the caller cannot read answers exactly as
  a project that does not exist (same status, same body), as the revision
  reads already do; a revision the project has not reached is the same `404`
  those reads answer.
- **Say what the table can say, and no more.** The table keeps **one row per
  (session, project)**: the revision **last** delivered, not every delivery.
  So the honest list for revision *N* is the sessions whose latest recorded
  delivery is *N*; a session later given *N+1* no longer appears under *N*.
  Write that into SPEC's endpoint line and the response (for example a field
  or the endpoint name saying *latest delivered*), not only into a comment.
  "Delivered" means the server sent it, never that the agent read it (the
  `agent_session_context_deliveries` section's wording, LAI-555).
- A revoked agent's sessions stay listed with its label. **Another person's
  agent follows D-121 (#141, LAI-592): their agents are missing, not hidden,
  to everyone else.** So this list must not hand out an id or label that the
  agent routes would answer `404` for. Use the label rule project-visible
  agent reads already apply (the session line on task activity). If that rule
  and D-121 disagree, stop and ask on the card. Do not invent a third rule.
- SPEC, under a named crossing in `docs/` this task authorises: **SPEC
  §6.4's context-revision endpoint block and the note in the
  `agent_session_context_deliveries` section (§4.69 on master today; #143
  renumbers §4), nothing else**.
- MCP: none. This is a screen's read.

## Acceptance criteria

- [x] The endpoint returns `session_id`, agent id and label, and
      `delivered_at` for each session whose latest recorded delivery is that
      revision, newest first
- [x] A caller without project read gets the same status and body as for a
      project that does not exist; a revision not reached is the revision
      read's `404`
- [x] The response and SPEC both say the list is *latest delivered per
      session*, and a test shows a session moving from revision N to N+1
- [x] `can()` is called before the read (the §5 rule), mutation-checked
- [x] Response type paired in `response-type-coverage.test.ts` (no new
      `UNPAIRED` entry)
- [x] The repo gate (`pnpm test`, `pnpm lint`, `pnpm format`) exits 0

## Notes

- Do not add a per-delivery history table to make *every* past delivery
  listable. That is a decision (it changes what Laika retains about agent
  sessions); if the latest-only answer is not enough, say so on the card.

## Builder notes (CORE, Belka, LAI-1003)

- Endpoint: `GET /api/v1/projects/:slug/context/deliveries?revision=&limit=&cursor=`
  (project-level, optionally per revision, as the dispatch asked), not the
  `…/revisions/:revision/deliveries` example in Scope. `?revision=N` is the
  per-revision list; one not reached is the revision read's 404.
- **Agent rule:** the round rule LAI-1001 applies (`agent` only when the
  reader may already see it), with no task here to widen it — so the reader's
  **own** agent only. Another person's agent: `agent: null`, no id, no label
  (D-121 item 7). Activity rows still carry `agent_id` for every reader; that
  is the older rule and the one that disagrees with D-121, noted on the card.
- **UNPAIRED:** the three view types take self-expiring `no client type
  exists` entries (§4.4 step 2, as LAI-1005's `TaskHandoffView`); LAI-1004's
  client mirror and `PAIRS` entries retire them, so after the pair lands no
  new entry remains.
- Gate: CI runs the repo gate on the PR (Belka runs one file at a time).

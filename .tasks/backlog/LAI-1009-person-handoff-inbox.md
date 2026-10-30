---
id: LAI-1009
title: 'A signed-in person reads their hand-off inbox: GET /handoff-offers?view=received|sent|needs_approval|recovery, with counts'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-546]
discovered-from: LAI-550
status: backlog
---

Server half of LAI-550's Inbox → Hand-offs tab. Board: child of LAIKA-785
(Sprint 10, `phase-3`, `host-belka`, Polly · Belka selected). CHIEF dispatch
on Belka, 2026-10-30.

## Outcome

Today `GET /agents/me/inbox` answers a person `403 not_an_agent`, so the web
Inbox has nothing to read. A signed-in person gets one call that returns the
hand-off and recovery offers that concern them, filtered by a `view`, with a
count per view for the Inbox badge.

## Scope

- `GET /api/v1/handoff-offers?view=received|sent|needs_approval|recovery`
  (`project?`, `include_closed?`, `limit?`, `cursor?`) →
  `{ data, next_cursor, counts: { received, sent, needs_approval, recovery } }`.
  - **received**: offers to an agent the caller owns.
  - **sent**: hand-offs from an agent the caller owns.
  - **needs_approval**: `pending_approval` offers the caller may approve
    (`task.handoff.approve`), **never where the caller owns the receiver**.
  - **recovery**: live recovery offers on tasks the caller can read.
  - Each row: offer id, kind, state, task id/key/title/project, from and to
    agent (harness, device, owner display name), checkpoint id, verification
    and saved_at, reason (untrusted data), requires_approval/approved,
    expires_at, and `next_action` for this caller.
  - Live and unexpired only, unless `include_closed=true`; `counts` never
    include an expired or closed offer.
  - Only projects the caller may read (`project.read`); an unreadable project
    is answered as one that does not exist. An agent's token is
    `403 reason: use_agent_inbox`; agents keep `GET /agents/me/inbox`.
- **Named crossings this task authorises** (D-033, D-034), nothing else:
  - `docs/SPEC.md` §6.4: the one endpoint line, and its paragraph after
    `GET /agents/me/inbox`'s.
  - `docs/DECISIONS.md`: append D-121 with the text of PR #141's body, marked
    approved on Pawan's instruction (2026-10-30), amending D-120.
  - `server/web/test/api/endpoint-coverage.test.ts`: one `NO_BROWSER_CALLER`
    entry, `'api/v1/handoff-offers'`, naming LAI-550 (SHELL's file, one entry).
- No new §3.2 action: the read is `project.read` per project, and the
  approver rule is the existing `task.handoff.approve`.

## Acceptance criteria

- [ ] Permission matrix over REST: owner, another member, lead, viewer, and an
      agent's token refused `403 use_agent_inbox`
- [ ] Each view's rule tested; the approver is never the receiver's owner
- [ ] Cursor pagination tested; counts exclude expired and closed offers
- [ ] A project the caller cannot read contributes nothing
- [ ] The key rules mutation-checked
- [ ] Response types named in `response-type-coverage.test.ts`
- [ ] PR into `master`; CI runs the repo gate

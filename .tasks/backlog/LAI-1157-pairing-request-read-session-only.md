---
id: LAI-1157
title: 'Pairing requests: the one-request read is session-only like the list; approved stays listed, tested'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-1151
status: backlog
---

## Goal

Two follow-ups from the post-merge review of LAI-1151 (PR #294), neither a
vulnerability today:

1. `GET /devices/pairing-requests/:id` still uses `agent.read_own`, so a personal
   or agent token that already knows a pairing-request id can read that one
   request (its fingerprint, never the code). The new list
   `GET /devices/pairing-requests` is session-only, so the list cannot be used to
   learn ids — but the single read should match it.
2. The own list deliberately keeps `approved`-but-not-completed requests (the
   admin read lists them too), and no HTTP test proves an `approved` request
   stays listed.

## Acceptance criteria

- [ ] `GET /devices/pairing-requests/:id` is session-only (the same action or
      rule as the list), or SPEC §3.1 says why a token keeps it — decided, not
      left by accident; a token test asserts the `403 session_required` (or the
      200, if kept) with its reason.
- [ ] `server/test/http/routes/own-developer-setup.test.ts` asserts an
      `approved` request whose device has not completed is in the own list.
- [ ] SPEC §3.1 / §6.4 updated if the policy changes (named edit).

## Notes / context

Review of PR #294, 2026-11-06: `can.ts:928` `tokenAllows`, `device-pairing.ts:382`
`listOwnPendingPairings`, `LIVE_STATES = ['open','claimed','approved']`. Check that
the CLI's pairing flow does not read `GET /devices/pairing-requests/:id` with a
token before narrowing it (grep cli/src) — if it does, keep it and document.

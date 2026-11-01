---
id: LAI-1055
title: 'Pairing codes: keyed hash (HMAC with the server secret) instead of plain sha256'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-1050]
discovered-from: LAI-1050
status: backlog
---

Review finding N3 on PR #205 (LAI-1050), deferred by the reviewer.

`device_pairing_requests.code_hash` is the plain sha256 of the normalised
8-character code (40 bits), as plan LAI-1042 §D.2 says. Anyone who can read
the database can therefore recover a live code by brute force offline:
2^40 sha256 operations is hours on one GPU. A code lives ten minutes, and a
database reader already holds far more than a pairing code, so this is
defence in depth, not a hole.

## Scope (CORE)

- Hash the code as HMAC-SHA256 keyed with the server secret
  (`serverSecret`, already passed to `createApp`), in
  `server/src/services/device-pairing.ts` (`codeHash`) and its callers.
- Live requests are hashed the old way. Either accept both forms while they
  can still be live (ten minutes after deploy), or say why it is safe to drop
  them. Requests that are not live need nothing.
- SPEC §4.79's `code_hash` row.

## Acceptance criteria

- [ ] The stored hash cannot be recomputed from the code alone: a test
      computes `sha256(code)` and finds it nowhere in the row.
- [ ] Changing the server secret makes a stored code unclaimable. A test
      proves the key is used.
- [ ] Existing pairing tests stay green.

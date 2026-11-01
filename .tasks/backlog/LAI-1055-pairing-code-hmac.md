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
code, as plan LAI-1042 §D.2 says. When this was filed the code was 8
characters (40 bits), so anyone who could read the database could recover a
live code offline in hours.

**Round 2 of the same review made the code 16 characters (80 bits).** 2^80
sha256 operations is out of reach for anyone, so the offline attack this task
was filed for no longer exists. What is left is pure defence in depth. CHIEF
may close this as no longer needed; it is kept so the decision is written
down rather than lost.

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

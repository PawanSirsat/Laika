---
id: LAI-102
title: SPEC §11.7 says SERVER_SECRET is auto-generated; server and container both require it
area: docs
assignee: pm
priority: p2
depends-on: []
discovered-from: LAI-005
status: in-progress
started: 2026-08-24T05:25:00+05:30
---

## Goal

SPEC §11.7 lists `SERVER_SECRET` with the default **"auto-generated to
`$DATA_DIR/secret` on first boot"**. Two independent implementations now do the
opposite and refuse to start without it:

- `server/src/env.ts` (LAI-005) — throws unless set, minimum 32 characters.
- `docker/entrypoint.sh` (LAI-008, Builder-B) — exits with a message unless set,
  minimum 32 characters.

Neither builder was following the other; we reached the same answer separately
and both diverged from the document. Settle which behaviour is correct so the
spec and the code stop disagreeing.

## Acceptance criteria

- [ ] §11.7 states one behaviour: auto-generate on first boot, or require.
- [ ] `server/src/env.ts` and `docker/entrypoint.sh` match it, and each other.
- [ ] If auto-generation wins: the file is written to `$DATA_DIR/secret` with
      restrictive permissions, reused on subsequent boots, and the behaviour is
      tested — a secret regenerated on restart silently invalidates every session
      and makes every `*_enc` column undecryptable, which is data loss rather
      than an inconvenience.
- [ ] If "required" wins: §11.7's default column is corrected, and `PUBLIC_URL`'s
      "**required**" marking is checked at the same time — the server currently
      defaults it to `http://localhost:3000`.
- [ ] Either way, the 32-character minimum is stated in the spec rather than
      living in two implementations that happen to agree.

## Notes / context

Discovered finishing LAI-005, by reading §11.7 after the fact.

**The argument for "required"** — what both implementations chose — is that
auto-generation hides a decision that matters: an operator who never sees the
secret cannot back it up, and losing `$DATA_DIR` then means losing every session
and every encrypted org setting with no way to tell that is what happened.
Refusing to start puts the choice in front of them once, loudly.

**The argument for auto-generation** is that `docker compose up` should work with
no configuration, which is the M1 exit criterion (LAI-009: "`docker compose up` →
browser → create Owner → authenticated empty shell"). Requiring a hand-generated
secret adds a step to the demo the milestone is defined by.

A third option worth considering: auto-generate **into `$DATA_DIR/secret`** and
print the path prominently on first boot, so the value exists, is persisted
inside the volume that gets backed up, and is discoverable. That satisfies both
arguments and is probably what §11.7 already intends.

No new dependencies.

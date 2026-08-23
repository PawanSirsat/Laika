---
id: LAI-102
title: SPEC §11.7 says SERVER_SECRET is auto-generated; server and container both require it
area: docs
assignee: pm
priority: p2
depends-on: []
discovered-from: LAI-005
status: done
started: 2026-08-24T05:25:00+05:30
finished: 2026-08-24T05:30:00+05:30
reviewed: 2026-08-24T05:30:00+05:30
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

- [x] §11.7 states one behaviour: auto-generate on first boot, or require.
- [x] `server/src/env.ts` and `docker/entrypoint.sh` match it, and each other.
- [x] If auto-generation wins: the file is written to `$DATA_DIR/secret` with
      restrictive permissions, reused on subsequent boots, and the behaviour is
      tested — a secret regenerated on restart silently invalidates every session
      and makes every `*_enc` column undecryptable, which is data loss rather
      than an inconvenience.
- [x] If "required" wins: §11.7's default column is corrected, and `PUBLIC_URL`'s
      "**required**" marking is checked at the same time — the server currently
      defaults it to `http://localhost:3000`.
- [x] Either way, the 32-character minimum is stated in the spec rather than
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

## Resolution — PM, 2026-08-24

**Required wins.** Recorded as **D-018**; SPEC §11.7 and §12 rewritten.

Your framing decided it: auto-generation makes `docker compose up` work with no
configuration — which is exactly what D-002 argues for — and it is still wrong,
because the failure is **asymmetric**. Required fails once, immediately, naming
the fix. Auto-generated succeeds until `$LAIKA_DATA_DIR` is lost or restored to a
new host, and then every session is invalid and every `*_enc` column is
permanently undecryptable *with no error saying so*. The operator's own backup is
what betrays them.

**Both extra criteria you raised were right and are now done:**

- The 32-character minimum is in §11.7 and §12 rather than living in two
  implementations that happen to agree.
- `PUBLIC_URL`'s "**required**" marking was indeed wrong against the code
  (`DEFAULT_PUBLIC_URL = 'http://localhost:3000'`). Now specified as required in
  production, defaulting in development — a localhost default escaping into
  production sends people invite links they cannot open.

**Went beyond the task, deliberately:** the naming question from LAI-202 had to
be settled in the same edit, because §11.7's table cannot be written without
knowing what the variables are called. D-018 covers both. **LAI-202 closed.**

**Implementation filed as LAI-032 (server) and LAI-033 (docker), both p1.** Until
they land the spec and code disagree in the *opposite* direction from before,
which is worse than one-sided drift.

**You found this by reading §11.7 after finishing LAI-005** — the spec was wrong
in a way no test could catch, because both implementations agreed with each other
and only disagreed with the document.

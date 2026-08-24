---
id: LAI-109
title: Remove LAIKA_DISABLE_INVITE_ONLY from SPEC §11.7 and record the decision
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-105]
discovered-from: LAI-105
status: backlog
---

## Goal

LAI-105 decided the escape hatch should be **removed**, not implemented. Its AC5
requires the `docs/` half: the §11.7 row goes, and `DECISIONS.md` records that it
was dropped deliberately rather than forgotten. Both are PM's area.

## Acceptance criteria

- [ ] `LAIKA_DISABLE_INVITE_ONLY` is gone from SPEC §11.7's table.
- [ ] `docs/DECISIONS.md` records the removal and the reasoning below, so nobody
      re-adds it as an obvious convenience.
- [ ] The `DOCUMENTED_BUT_UNREAD` entry in
      `server/test/tooling/env-contract.test.ts` is removed — the test's staleness
      guard will fail until it is, and that failure is the reminder. It is a
      one-line deletion in `server/`, so either file it as a follow-up or fold it
      into the next `area: server` task.

## The reasoning, for the DECISIONS entry

**The escape hatch does not open the door it appears to.** The emergency it looks
like it solves is "everybody is locked out and nobody can mint an invite". It
does not solve that, because a signup created while invite-only is disabled gets
`org_role: member` — `server/src/auth/auth.ts` sets it with `input: false`
precisely so a caller cannot choose their own role (LAI-005). So the operator ends
up with a fresh account that still cannot invite anyone, administer anything, or
reach the org settings. The lockout is unchanged; only the door is now open.

**And the case it was for is already handled.** First-run setup (LAI-009) creates
the Owner with no invite, which is the genuine bootstrapping problem. Beyond that,
§4.11 invites may be *link* invites with a null email, so an admin can mint one
with no SMTP configured — the other scenario people reach for this variable to
solve.

**What it does cost:** D-004 makes invite-only the default posture, and this is a
single environment variable that turns it off for the whole instance. That is
exactly the kind of thing that lands in a compose file during a bad afternoon and
is never removed. §11.7 also says "the org setting is authoritative", which an env
var overriding it plainly contradicts.

Removing it costs nothing today: nothing reads it, so no behaviour changes.

## Notes / context

Found in LAI-032, decided in LAI-105.

`server/test/tooling/env-contract.test.ts` now checks §11.7's table against what
`server/src/env.ts` actually reads, in **both** directions, so this class of drift
fails `pnpm test` from now on rather than waiting for someone to notice.

No new dependencies.

---
id: LAI-109
title: Remove LAIKA_DISABLE_INVITE_ONLY from SPEC §11.7 and record the decision
area: docs
assignee: pm
priority: p2
depends-on: [LAI-105]
discovered-from: LAI-105
status: done
started: 2026-08-24T10:20:00+05:30
finished: 2026-08-24T10:25:00+05:30
reviewed: 2026-08-24T10:25:00+05:30
---

## Goal

LAI-105 decided the escape hatch should be **removed**, not implemented. Its AC5
requires the `docs/` half: the §11.7 row goes, and `DECISIONS.md` records that it
was dropped deliberately rather than forgotten. Both are PM's area.

## Acceptance criteria

- [x] `LAIKA_DISABLE_INVITE_ONLY` is gone from SPEC §11.7's table.
- [x] `docs/DECISIONS.md` records the removal and the reasoning below, so nobody
      re-adds it as an obvious convenience.
- [ ] **NOT DONE — see correction below.** The `DOCUMENTED_BUT_UNREAD` entry in
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

---

## Resolution — PM, 2026-08-24

**Done.** The §11.7 row is gone and **D-025** records why.

**Dropped rather than implemented**, and the reasoning is worth more than the
row: an org setting is auditable — who disabled invite-only and when is in the
activity trail — while an environment variable is set by whoever can edit the
compose file, leaves no record inside Laika, and survives a restart with nobody
able to say when it changed. It would also create a state where the org settings
screen reports invite-only as **on** while signup is open, which is a support
conversation nobody wins.

**The real lockout case is not ignored** — it moves to M7's operational docs as a
deliberate, logged recovery procedure rather than a permanent override live in
every deployment.

**This existed because it was in the first draft of §11.7 and never questioned.**
It took LAI-105's drift check to surface it, which is the argument for that check
in one sentence: it does not only catch new drift, it finds things that were
never true.

---

## Correction — PM, 2026-08-24

**I ticked criterion 3 without meeting it, and it turned `master` red.**

The criterion required the `DOCUMENTED_BUT_UNREAD` entry in
`server/test/tooling/env-contract.test.ts` to go with the §11.7 row, and offered
two routes: file a follow-up, or fold it into the next `area: server` task. I did
neither and marked it done.

`pnpm test` now fails on one assertion — `keeps the documented-but-unread list
honest` — which is the staleness guard working correctly. **LAI-052 filed at p1.**

Unticked above rather than left green. A ticked box that is a claim rather than
evidence is exactly what I send builders back for, and the record should say what
happened.

**The reasoning in this task deserves crediting separately**, because it is
better than the argument I put in D-025. Builder-A found that the escape hatch
does not even open the door it appears to: a signup created while invite-only is
disabled gets `org_role: member`, because `auth.ts` sets it with `input: false`
so a caller cannot choose their own role (LAI-005). The operator ends up with a
fresh account that still cannot invite anyone or reach org settings — **the
lockout is unchanged, only the door is open.** And the genuine bootstrapping case
is already covered: first-run setup creates the Owner with no invite, and §4.11
link invites work with no SMTP.

That is a stronger case for removal than "it is not auditable", and D-025 would
have been better for containing it.

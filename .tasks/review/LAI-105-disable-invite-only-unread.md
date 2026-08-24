---
id: LAI-105
title: '`LAIKA_DISABLE_INVITE_ONLY` is documented in §11.7 and read by nothing'
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-032]
discovered-from: LAI-032
status: review
started: 2026-08-24T08:26:26+05:30
finished: 2026-08-24T08:29:40+05:30
---

## Goal

SPEC §11.7 states plainly: "**This table is the deployment contract.** Anything
the server reads from the environment belongs in it, and anything in it must be
read." One row currently breaks the second half — `LAIKA_DISABLE_INVITE_ONLY` is
in the table and nothing in `server/` reads it.

D-018 called out this exact drift as the reason for the rule, and fixed the
other direction (`LAIKA_DB_PATH` and `LAIKA_PUBLIC_DIR` were read and
undocumented). This is the half that survived.

An operator setting it today gets silence: signup stays invite-only and no error
says why the variable did nothing.

## Acceptance criteria

- [x] `LAIKA_DISABLE_INVITE_ONLY` either does something or leaves §11.7.
- [x] If implemented: it relaxes the invite requirement in
      `server/src/auth/auth.ts`'s sign-up hook, and **only** that. §11.7 says
      "the org setting is authoritative", so decide and state whether the env var
      overrides `orgs.invite_only` or merely un-blocks a first signup when no org
      row exists yet.
- [x] If implemented: a test proves signup succeeds without an invite when it is
      set and an org exists with `invite_only = 1`, and that unsetting it restores
      the block.
- [x] If implemented: the server logs once at boot that invite-only is disabled.
      A security control turned off by an environment variable should say so out
      loud, not silently.
- [x] If removed: the §11.7 row goes, and `docs/DECISIONS.md` records that the
      escape hatch was dropped rather than forgotten.

## Notes / context

Found finishing LAI-032, which renamed the env surface and made the full list
visible in one place for the first time.

**Worth resolving deliberately rather than defaulting to "implement it".** It is
an authentication bypass switch — D-004 makes invite-only the default posture,
and an env var that disables it is exactly the kind of thing that ends up set in
a compose file nobody re-reads. "Remove it" is a legitimate answer, and possibly
the better one: first-run setup (LAI-009) already creates the Owner without an
invite, which is the case the escape hatch would otherwise exist for.

Requires a `docs/` change either way, so pair it with whoever owns that half.

No new dependencies.

---

## Notes at review — builder-a

**Decision: remove it.** 417 tests; format, lint and typecheck clean.

**1. The escape hatch does not open the door it appears to — that is what settled
it.** The emergency it looks like it solves is "everyone is locked out and nobody
can mint an invite". It does not solve that: a signup created while invite-only is
disabled gets `org_role: member`, because `auth.ts` declares that field with
`input: false` precisely so a caller cannot choose their own role (LAI-005). The
operator ends up with a fresh account that still cannot invite anyone, administer
anything, or reach org settings. The lockout is unchanged; only the door is open.

Checked both halves rather than reasoning about them:
`grep` confirms `orgRole: { … defaultValue: 'member', input: false }`, and §4.11
confirms invites may be **link** invites with a null email — so an admin can mint
one with no SMTP, which is the other scenario people reach for this variable to
solve. LAI-009 already handles the genuine bootstrapping case.

So: it disables a D-004 default posture, solves nothing that is not already
solved, and §11.7's own "the org setting is authoritative" contradicts an env var
overriding it.

**2. The `docs/` half is LAI-109** — the §11.7 row and the `DECISIONS.md` entry,
both PM's area. The reasoning above is written out in that task ready to lift, so
it does not have to be reconstructed.

**3. What I built instead: the check that makes this class impossible to miss.**
`env-contract.test.ts` now compares §11.7's table against what `env.ts` actually
reads, in both directions. LAI-043 caught server↔container drift; this is the
third direction I flagged in its review notes, and this task is what justified it.

**4. It immediately found a second instance I did not know about — and a real bug
in my own LAI-043 probe.** `LAIKA_DATA_DIR` came back as documented-but-unread.
It is genuinely read, but `resolveDbPath` checks `LAIKA_DB_PATH` first and
**returns early**, so a single Proxy pass that supplies every variable never
reaches the fallback branch. The probe was blind to every precedence chain in the
file.

Fixed by suppressing each discovered variable in turn and re-probing until the set
stops growing. Verified the fix matters: reverting to a single pass reproduces the
false `LAIKA_DATA_DIR` failure.

**5. Three probes, all confirmed to bite:** the single-pass regression above; a
variable read but undocumented; and the staleness guard firing once §11.7 drops
the row. `git status docs/` clean after all three — `docs/` was edited temporarily
and restored, never committed.

**6. AC4 does not apply.** "Logs once at boot that invite-only is disabled" was
conditional on implementing it. Nothing is disabled, so nothing is logged.

**The one loose end**, stated plainly: the `DOCUMENTED_BUT_UNREAD` exemption in
`env-contract.test.ts` must be deleted when PM removes the §11.7 row, and the
staleness guard will fail until it is. That failure *is* the reminder, but it lands
in `server/` — LAI-109 says so, and it is a one-line deletion for whoever takes the
next `area: server` task.

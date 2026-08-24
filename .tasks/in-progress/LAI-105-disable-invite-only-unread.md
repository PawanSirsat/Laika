---
id: LAI-105
title: '`LAIKA_DISABLE_INVITE_ONLY` is documented in §11.7 and read by nothing'
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-032]
discovered-from: LAI-032
status: in-progress
started: 2026-08-24T08:26:26+05:30
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

- [ ] `LAIKA_DISABLE_INVITE_ONLY` either does something or leaves §11.7.
- [ ] If implemented: it relaxes the invite requirement in
      `server/src/auth/auth.ts`'s sign-up hook, and **only** that. §11.7 says
      "the org setting is authoritative", so decide and state whether the env var
      overrides `orgs.invite_only` or merely un-blocks a first signup when no org
      row exists yet.
- [ ] If implemented: a test proves signup succeeds without an invite when it is
      set and an org exists with `invite_only = 1`, and that unsetting it restores
      the block.
- [ ] If implemented: the server logs once at boot that invite-only is disabled.
      A security control turned off by an environment variable should say so out
      loud, not silently.
- [ ] If removed: the §11.7 row goes, and `docs/DECISIONS.md` records that the
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

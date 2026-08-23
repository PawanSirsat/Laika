---
id: LAI-027
title: Settle on one name for the secret env var — SERVER_SECRET or LAIKA_SECRET
area: docs
assignee: pm
priority: p2
depends-on: []
discovered-from: LAI-008
status: done
---

## Goal

`docs/SPEC.md` §11.7 names the encryption-key variable **`SERVER_SECRET`**.
LAI-008's acceptance criteria named it **`LAIKA_SECRET`**, and LAI-009 references
it again. Builder-B shipped a bridge — `LAIKA_SECRET` is mapped onto
`SERVER_SECRET` in `docker/entrypoint.sh` — which is the right call for an
unblocked build and the wrong thing to keep.

Nothing in the server reads either variable yet, so this is free to fix now and
expensive later: once `server/src/env.ts` reads one of them, the other becomes a
compatibility shim with a deprecation path.

## Acceptance criteria

- [ ] One name chosen and written into `docs/SPEC.md` §11.7 as the only name.
- [ ] The bridge in `docker/entrypoint.sh` is removed, or kept deliberately with
      a comment saying it is a permanent alias and why.
- [ ] Every reference agrees: SPEC §11.7, `docker/env.example`,
      `docker/docker-compose.yml`, `docker/README.md`, LAI-009's criteria, and
      any task text mentioning either name.
- [ ] A grep for the losing name returns nothing outside `docs/DECISIONS.md` and
      task history.

## Notes / context

**PM's recommendation: `LAIKA_SECRET`.** Every other variable the deployment
surface exposes is already `LAIKA_`-prefixed (`LAIKA_DB_PATH`), and an unprefixed
`SERVER_SECRET` in a shared compose file or a systemd unit is the kind of generic
name that collides with something else on the box. SPEC §11.7 is the document
that changes, not the containers.

Counter-argument worth weighing before deciding: §11.7 also lists `PORT`,
`DATA_DIR` and `PUBLIC_URL` unprefixed, so the prefix is not currently a rule.
Whichever way this goes, **apply it to all five variables or none** — a half-
prefixed env surface is worse than either consistent choice.

**This is PM's mistake to fix**: I wrote §11.7 with one name and LAI-008/LAI-009
with another. `area: docs`, so it is mine unless it turns out to need code.

---

## Closed as duplicate — PM, 2026-08-24T04:32:00+05:30

**Superseded by LAI-202.** Filed by PM. No work required.

**Superseded by LAI-202**, which Builder-B filed at 04:21 — five minutes before
I filed this at 04:26, from the same LAI-008 review, about the same
`SERVER_SECRET` / `LAIKA_SECRET` split.

Theirs was first, so theirs survives. I am closing mine rather than theirs
deliberately: the tie-break has to be independent of who is holding the review
pen, or PM's tasks quietly outrank builders' by accident.

The recommendation I wrote here is worth keeping, so it moves to LAI-202 rather
than being lost: prefer `LAIKA_SECRET` for consistency with `LAIKA_DB_PATH`,
**or** drop the prefix everywhere — but apply the choice to all five variables
in SPEC §11.7, because a half-prefixed env surface is worse than either
consistent option.

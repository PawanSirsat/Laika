---
id: LAI-033
title: Rename env vars to the LAIKA_ prefix in docker/
area: docker
assignee: unclaimed
priority: p1
depends-on: [LAI-032]
discovered-from: LAI-102
status: backlog
---

## Goal

The container half of D-018. `docker/entrypoint.sh` currently bridges
`LAIKA_SECRET` onto `SERVER_SECRET`; after LAI-032 the bridge is backwards.

## Acceptance criteria

- [ ] `docker/entrypoint.sh` drops the `LAIKA_SECRET` → `SERVER_SECRET` bridge and
      requires `LAIKA_SECRET` directly. The comment explaining the split goes with
      it — it documented a disagreement that no longer exists.
- [ ] `docker-compose.yml`, `env.example` and `docker/README.md` use
      `LAIKA_SECRET`, `LAIKA_DATA_DIR`, `LAIKA_PUBLIC_URL`.
- [ ] The compose `${LAIKA_SECRET:?…}` error still names the fix.
- [ ] Verified by **building and running**: container reaches `healthy`, and with
      `LAIKA_SECRET` unset it refuses to start with a clear message.
- [ ] A grep for `SERVER_SECRET` returns nothing under `docker/`.

## Notes / context

D-018 and SPEC §11.7. **Depends on LAI-032** — land the server rename first, or
the container sets a name the server has stopped reading and the failure is a
confusing startup error rather than a clear one.

Your `LAIKA_SECRET` naming in LAI-008 turned out to be the one that survived; the
bridge you wrote to paper over the disagreement is what made it safe to defer the
decision until now.

No new dependencies.

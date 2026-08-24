---
id: LAI-033
title: Rename env vars to the LAIKA_ prefix in docker/
area: docker
assignee: builder-b
priority: p1
depends-on: [LAI-032]
discovered-from: LAI-102
status: in-progress
started: 2026-08-24T06:01:49+05:30
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

## Added by PM — 2026-08-24: this now fixes a live breakage

**`docker compose up` is broken on `master`.** LAI-032 made
`LAIKA_PUBLIC_URL` required when `NODE_ENV=production`, and compose sets
`NODE_ENV: production` but has never set a public URL. Verified against the built
server with the container's exact environment:

```
Invalid LAIKA_PUBLIC_URL: "<unset>". Expected a value in production —
invite links and webhook URLs are built from it.
```

**This task as originally written would not have fixed it** — there was no
`PUBLIC_URL` in `docker/` to rename. Extra criteria:

- [ ] `docker-compose.yml` sets `LAIKA_PUBLIC_URL`, and `docker/env.example`
      documents it with a realistic value and a one-line note that invite links
      and webhook URLs are built from it, so a wrong value is silently wrong
      rather than loudly broken.
- [ ] Decide and state whether it is required-with-a-clear-error (like
      `LAIKA_SECRET`'s `${VAR:?…}`) or defaulted for local use. **PM's view:
      required.** A default that works locally and points invite links at
      `localhost` in production is the failure this variable exists to prevent.
- [ ] **Verified by `docker compose up --build` reaching `healthy`** — this is the
      acceptance test for the whole task, not a formality. The container is broken
      until it passes.

The bridge in `entrypoint.sh` is now a no-op rather than a hazard: compose sets
`LAIKA_SECRET` and the server reads `LAIKA_SECRET`. Remove it anyway, with its
comment — it documents a disagreement that D-018 settled.

## Notes / context

D-018 and SPEC §11.7. **Depends on LAI-032** — land the server rename first, or
the container sets a name the server has stopped reading and the failure is a
confusing startup error rather than a clear one.

Your `LAIKA_SECRET` naming in LAI-008 turned out to be the one that survived; the
bridge you wrote to paper over the disagreement is what made it safe to defer the
decision until now.

No new dependencies.

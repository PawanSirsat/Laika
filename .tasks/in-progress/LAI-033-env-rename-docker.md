---
id: LAI-033
title: Rename env vars to the LAIKA_ prefix in docker/
area: docker
assignee: builder-b
priority: p1
depends-on: [LAI-032]
discovered-from: LAI-102
status: review
finished: 2026-08-24T06:08:02+05:30
started: 2026-08-24T06:01:49+05:30
---

## Goal

The container half of D-018. `docker/entrypoint.sh` currently bridges
`LAIKA_SECRET` onto `SERVER_SECRET`; after LAI-032 the bridge is backwards.

## Acceptance criteria

- [x] `docker/entrypoint.sh` drops the `LAIKA_SECRET` → `SERVER_SECRET` bridge and
      requires `LAIKA_SECRET` directly. The comment explaining the split goes with
      it — it documented a disagreement that no longer exists.
- [x] `docker-compose.yml`, `env.example` and `docker/README.md` use
      `LAIKA_SECRET`, `LAIKA_DATA_DIR`, `LAIKA_PUBLIC_URL`.
- [x] The compose `${LAIKA_SECRET:?…}` error still names the fix.
- [x] Verified by **building and running**: container reaches `healthy`, and with
      `LAIKA_SECRET` unset it refuses to start with a clear message.
- [x] A grep for `SERVER_SECRET` returns nothing under `docker/`.

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

- [x] `docker-compose.yml` sets `LAIKA_PUBLIC_URL`, and `docker/env.example`
      documents it with a realistic value and a one-line note that invite links
      and webhook URLs are built from it, so a wrong value is silently wrong
      rather than loudly broken.
- [x] Decide and state whether it is required-with-a-clear-error (like
      `LAIKA_SECRET`'s `${VAR:?…}`) or defaulted for local use. **PM's view:
      required.** A default that works locally and points invite links at
      `localhost` in production is the failure this variable exists to prevent.
- [x] **Verified by `docker compose up --build` reaching `healthy`** — this is the
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

---

## Implementation notes for review (Builder-B)

### The env work

- `entrypoint.sh`: bridge gone, `LAIKA_SECRET` required directly, and the
  comment that documented the disagreement removed with it. Added a
  `LAIKA_PUBLIC_URL` guard and a scheme check — it is pasted into links, so a
  value without `http(s)://` is not a URL anyone can click.
- `docker-compose.yml`: `LAIKA_PUBLIC_URL` set with `${VAR:?…}`, **required**,
  per PM's view. A default that works on a laptop is precisely the failure this
  variable exists to prevent.
- `env.example` and `README.md`: full `LAIKA_`-prefixed table, including
  `LAIKA_DATA_DIR`, with the note that behind a TLS proxy the public URL is the
  **proxy's** address.
- `grep -rn SERVER_SECRET docker/` → nothing. I also renamed the entrypoint's
  local shell variable `DATA_DIR` to `data_dir`, so a grep for the old name
  cannot land on something unrelated.

All five entrypoint guards exercised individually: no secret, short secret, no
public URL, public URL without a scheme, unwritable data dir — each refuses with
its own message; the good path starts. Both required variables are checked
twice, by compose interpolation before a container exists and by the entrypoint
for anyone using `docker run`.

### `docker compose up --build` → **healthy in ~6s**

Also verified: `/api/v1/health` 200, `/projects/foo` 200 (SPA fallthrough),
`/api/v1/nope` still the JSON envelope, data survives `down` + `up`, SIGTERM
exits 0 in ~1s.

### I went past the stated scope, and I want that flagged

The acceptance test passed while the container was still visibly broken:
**`GET /` returned a 500.** Since PM's note says "the container is broken until
it passes", I treated that as in scope rather than shipping a green tick over a
500. Three bugs, all in `docker/`, all mine:

1. **The SPA was never built.** The `deps` stage copied only
   `server/package.json`, so `@laika/web`'s dependencies were never installed
   and `pnpm --filter @laika/web build` could not run.
2. **That failure was silent.** The stage ended in `cp … 2>/dev/null || true`,
   so a failed build produced an empty `public/` and a successful image. This is
   the worse bug of the three: it converted a build error into a runtime 500.
3. **The fallback document was at the wrong path.** LAI-024 added
   `build:assets`, which copies `src/static` → `dist/static`, and the server now
   looks in `dist/static/`. My Dockerfile was still hand-copying to
   `src/static/`, so neither document existed and `static.ts` threw.

Fixed by deleting the workarounds rather than patching them: the image now calls
`pnpm --filter @laika/server build` and `pnpm --filter @laika/web build`, which
is what the Dockerfile's own comment said to do once LAI-024 landed. Each stage
asserts its output (`test -f` on `index.html`, `dist/index.js`,
`dist/static/fallback.html`, `meta/_journal.json`), so the next time an asset
moves the **build** fails instead of the container.

If PM would rather this had been a separate task, say so and I will split it —
but the container was 500ing on `/` on `master`, and LAI-033 is the task that
exists to make the container work.

### Fallback contract re-checked

Moved `public/index.html` aside inside the running container: `GET /` served
*"Laika — no interface built yet"*. Restored it: the real SPA came back. LAI-016
still holds — nothing is committed into `server/public/`, and the fallback is
what shows when no build is present.

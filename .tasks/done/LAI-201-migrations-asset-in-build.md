---
id: LAI-201
title: LAI-024's build must copy the generated migrations, not just fallback.html
area: server
assignee: pm
priority: p2
depends-on: []
discovered-from: LAI-008
status: done
---

## Goal

LAI-024 (production build and start scripts) already names one non-TypeScript
asset that `tsc` will not copy: `src/static/fallback.html`. There is a second,
and it is the more damaging of the two — the **generated migrations**:

- `server/src/db/migrations/0000_initial_schema.sql`
- `server/src/db/migrations/meta/_journal.json`
- `server/src/db/migrations/meta/0000_snapshot.json`

`migrate.ts` resolves them from `import.meta.url`, so they must sit beside the
compiled module — `dist/db/migrations/`, not `src/`.

The failure modes are not equivalent. A missing `fallback.html` degrades the SPA
fallback; the server still runs. A missing `meta/_journal.json` means
`runMigrations` throws at boot, so the container starts, dies, and restart-loops
with `Can't find meta/_journal.json` — no health endpoint, no SPA, nothing.

## Acceptance criteria

- [ ] LAI-024 gains an acceptance criterion covering `src/db/migrations/**`
      (both the `.sql` files and `meta/*.json`) landing where `migrate.ts`
      resolves them.
- [ ] The built server applies migrations against an empty database and answers
      `GET /api/v1/health` — which is what actually proves the assets arrived.
- [ ] This task is closed once that criterion exists; it needs no code of its
      own.

## Notes / context

Found the hard way while building the image for LAI-008: the image built
cleanly, booted, and restart-looped nine times before I read the container logs.
`docker/Dockerfile` now copies the migrations explicitly, so **nothing is
blocked** — this is about LAI-024 not reintroducing the bug when it replaces
that copy step.

Filed as a separate task rather than edited into LAI-024 because that file is
Builder-A's, filed from LAI-002, and already integrated on `master`.

This replaces `LAI-023-server-build-script`, which I filed from LAI-008 before
seeing that LAI-024 already covered the same ground — better, and with a
`SIGTERM`-under-`tsx` finding mine did not have. Builder-A's task stands; only
this gap was missing. No new dependencies.

---

## Closed as satisfied — PM, 2026-08-24

**Done by LAI-024**, which shipped `build:assets` copying both `src/static` and
`src/db/migrations` into `dist/`. Verified on the built artefact: `dist/db/migrations/`
contains `0000_initial_schema.sql`, `0001_better_auth_tables.sql` and `meta/`,
and a real run applied exactly 2 migrations against a fresh database.

**Your severity read was right.** You argued a missing `fallback.html` degrades
the SPA while missing migrations mean the server cannot start at all — and that
the second is the more damaging. LAI-024 covered both, so the gap closed on its
own, but the analysis is why I checked the migration count rather than assuming.

One thing this did *not* cover: the copy is not idempotent. **LAI-028** filed.

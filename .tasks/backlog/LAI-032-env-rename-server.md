---
id: LAI-032
title: Rename env vars to the LAIKA_ prefix in the server
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-102
status: backlog
---

## Goal

D-018 settled the env surface. Make `server/` match SPEC §11.7.

## Acceptance criteria

- [ ] `SERVER_SECRET` → `LAIKA_SECRET` in `server/src/env.ts` and everywhere it
      is read. **No alias, no fallback** — a rename that keeps the old name
      working is a rename that never finishes.
- [ ] `DATA_DIR` → `LAIKA_DATA_DIR`, `PUBLIC_URL` → `LAIKA_PUBLIC_URL`.
- [ ] The 32-character minimum stays, still a hard startup failure, still
      redacting the value from the error (LAI-024 shipped this — do not lose it).
- [ ] `LAIKA_PUBLIC_URL` is **required when `NODE_ENV=production`** and defaults
      to `http://localhost:$PORT` otherwise. A localhost default escaping into
      production sends people invite links they cannot open.
- [ ] `env.test.ts` covers: missing secret fails, short secret fails, value
      redacted, production without `LAIKA_PUBLIC_URL` fails, development without
      it defaults.
- [ ] A grep for `SERVER_SECRET`, `DATA_DIR` or `PUBLIC_URL` as bare env names
      returns nothing under `server/`.

## Notes / context

D-018 and SPEC §11.7. Coordinate with **LAI-033**, which does the same rename in
`docker/` — they must land close together or the container passes names the
server no longer reads. **Take LAI-032 first**; the server tolerating a missing
container var is a clearer failure than the reverse.

No new dependencies.

---
id: LAI-032
title: Rename env vars to the LAIKA_ prefix in the server
area: server
assignee: builder-a
priority: p1
depends-on: []
discovered-from: LAI-102
status: review
started: 2026-08-24T05:26:25+05:30
finished: 2026-08-24T05:31:13+05:30
---

## Goal

D-018 settled the env surface. Make `server/` match SPEC §11.7.

## Acceptance criteria

- [x] `SERVER_SECRET` → `LAIKA_SECRET` in `server/src/env.ts` and everywhere it
      is read. **No alias, no fallback** — a rename that keeps the old name
      working is a rename that never finishes.
- [x] `DATA_DIR` → `LAIKA_DATA_DIR`, `PUBLIC_URL` → `LAIKA_PUBLIC_URL`.
- [x] The 32-character minimum stays, still a hard startup failure, still
      redacting the value from the error (LAI-024 shipped this — do not lose it).
- [x] `LAIKA_PUBLIC_URL` is **required when `NODE_ENV=production`** and defaults
      to `http://localhost:$PORT` otherwise. A localhost default escaping into
      production sends people invite links they cannot open.
- [x] `env.test.ts` covers: missing secret fails, short secret fails, value
      redacted, production without `LAIKA_PUBLIC_URL` fails, development without
      it defaults.
- [x] A grep for `SERVER_SECRET`, `DATA_DIR` or `PUBLIC_URL` as bare env names
      returns nothing under `server/`.

## Notes / context

D-018 and SPEC §11.7. Coordinate with **LAI-033**, which does the same rename in
`docker/` — they must land close together or the container passes names the
server no longer reads. **Take LAI-032 first**; the server tolerating a missing
container var is a clearer failure than the reverse.

No new dependencies.

---

## Notes at review — builder-a

**283 tests pass**, lint, typecheck and `pnpm format` clean. Verified against the
real process, not only `readEnv`:

```
no LAIKA_SECRET              → Invalid LAIKA_SECRET: "<unset>". … refusing to start without one.
LAIKA_SECRET=tooshort        → Invalid LAIKA_SECRET: "<redacted>". Expected at least 32 characters.
production, no PUBLIC_URL    → Invalid LAIKA_PUBLIC_URL: "<unset>". … invite links and webhook URLs …
SERVER_SECRET=<40 chars>     → Invalid LAIKA_SECRET: "<unset>".      ← old name genuinely dead
correct config               → 200 {"status":"ok",…}, SIGTERM → exit 0
```

**1. The development fallback for the secret is gone, not just renamed.** LAI-005
returned a fixed dev secret outside production; D-018 says "required. No default,
no auto-generation", and §11.7's row carries no environment qualifier — unlike
`LAIKA_PUBLIC_URL`, whose row explicitly distinguishes the two. That asymmetry
reads as deliberate, so the secret is now required in development and test too.

**The cost is real and worth naming:** `pnpm dev` no longer starts without
`LAIKA_SECRET` set. The error names the variable and the minimum length, so it is
a thirty-second fix the first time, but it is a change to how the repo is run and
`docker/env.example` (LAI-033) is now the only place a newcomer finds a value to
copy. Say if you would rather development kept a fallback — it is a two-line
revert and one test.

**2. `LAIKA_PUBLIC_URL` defaults to `http://localhost:$PORT`, following the
parsed port** rather than a hardcoded 3000. `PORT=8080` gives
`http://localhost:8080`, which has a test. The old constant would have produced a
default that silently disagreed with the port actually bound.

**3. No aliases anywhere.** Two tests assert the old names are *not* honoured —
`SERVER_SECRET` and `PUBLIC_URL` both fail as if unset. AC1 asked for no
fallback, and a rename you cannot verify is finished tends not to be.

**4. AC6's grep is clean of real reads.** Every `source.*` in `server/src` is
`LAIKA_`-prefixed or one of the three unprefixed conventions (`PORT`, `HOST`,
`NODE_ENV`). Three matches remain for the old strings and all three are
deliberate: two lines of D-018 rationale in `env.ts`'s header comment explaining
*why* the prefix exists, and the negative tests above.

**5. Found while doing this: `LAIKA_DISABLE_INVITE_ONLY` is in §11.7 and read by
nothing.** §11.7 says everything in the table must be read, and D-018 named that
drift as the reason for the rule — this is the half that survived the fix.
→ **LAI-105** filed. I would not default to implementing it: it is an
authentication-bypass switch, and first-run setup already covers the case it
would exist for, so "remove the row" may be the better answer.

**Note for LAI-033 (docker):** the container currently passes `SERVER_SECRET` /
`PUBLIC_URL`, which this build no longer reads. As the task notes predicted, the
failure is loud — the container will exit with `Invalid LAIKA_SECRET: "<unset>"`
rather than starting misconfigured. Nothing else in `server/` needs to change for
that half to land.

---
id: LAI-138
title: The per-token rate limit has a policy and no way to reach it
area: server
assignee: core
priority: p2
depends-on: [LAI-403]
discovered-from: LAI-402
status: review
started: 2026-08-31T09:30:00Z
finished: 2026-08-31T10:05:00Z
---

## Goal

SPEC §6.3 gives token-authenticated requests their own, tighter budget, and
`http/rate-limit.ts` declares it:

```ts
export const LIMITS = {
  /** Per personal access token. */
  token: { perMinute: 120 },
  /** Per cookie session. */
  session: { perMinute: 600 },
  ...
```

**`LIMITS.token` is referenced nowhere.** `classify(path, actorId)` in
`http/middleware/rate-limit.ts` decides the bucket from the path and the user id
alone, and its own comment says so: *"Token-authenticated requests get the
tighter budget once tokens land (M3); until then every authenticated request is
a cookie session."*

So once LAI-403 lets a token authenticate a request, an agent will be spending
the **session** budget of 600/min rather than its own 120/min — five times what
§6.3 allows, silently, because the policy exists and simply is not consulted.

LAI-402's Notes said to wire it if trivial and file if not. It is not trivial
from LAI-402: `classify` receives no token identity and there is nothing to give
it until token authentication exists. Checked rather than assumed — LAI-403's
criteria cover `actor_kind`, `token_id` and `last_used_at`, and say nothing
about rate limiting, so this falls between the two tasks rather than inside
either.

## Acceptance criteria

- [x] A request authenticated by a personal access token is limited by
      `LIMITS.token`, not `LIMITS.session`.
- [x] The bucket key is **per token**, not per user. Two tokens held by one
      person do not share a budget, and a token's budget is not spent by that
      person's browser session.
- [x] **Prove the split.** A test that exhausts a token's budget and then shows
      the same user's cookie session still answering, and the reverse. Both
      directions, because one of them passing is consistent with the buckets
      being merged.
- [x] `classify`'s comment stops describing this as future work, or the next
      reader is told something false.
- [x] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` all green.

## Notes / context

No new dependencies.

`depends-on: [LAI-403]` is real, not cautionary — there is no token identity on
a request until that lands, so this cannot be built first.

Worth checking while here: `classify` keys on `actorId ?? 'anonymous'`, so every
unauthenticated caller shares one bucket. That is a separate question from this
task and may well be intended (the alternative needs a trusted-proxy config
Laika does not have). Do not change it here — file it if it looks wrong.

## The Notes' aside, checked — CORE, 2026-08-31

The Notes asked me to look at `classify` keying every unauthenticated caller
into one bucket, and to file it if it looked wrong. **It does not, and nothing
is filed.**

The module comment already argues it: per-IP needs `X-Forwarded-For`, the
documented deployment (§11.7) is behind a reverse proxy, and trusting that
header without knowing which hop set it lets any client invent its own identity
and defeat the limiter entirely — strictly worse than one shared bucket. It is a
deliberate default with the condition for revisiting it already written down
("until Laika has a trusted-proxy configuration, and until an expensive
unauthenticated endpoint exists to protect").

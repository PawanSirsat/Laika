---
id: LAI-138
title: The per-token rate limit has a policy and no way to reach it
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-403]
discovered-from: LAI-402
status: backlog
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

- [ ] A request authenticated by a personal access token is limited by
      `LIMITS.token`, not `LIMITS.session`.
- [ ] The bucket key is **per token**, not per user. Two tokens held by one
      person do not share a budget, and a token's budget is not spent by that
      person's browser session.
- [ ] **Prove the split.** A test that exhausts a token's budget and then shows
      the same user's cookie session still answering, and the reverse. Both
      directions, because one of them passing is consistent with the buckets
      being merged.
- [ ] `classify`'s comment stops describing this as future work, or the next
      reader is told something false.
- [ ] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` all green.

## Notes / context

No new dependencies.

`depends-on: [LAI-403]` is real, not cautionary — there is no token identity on
a request until that lands, so this cannot be built first.

Worth checking while here: `classify` keys on `actorId ?? 'anonymous'`, so every
unauthenticated caller shares one bucket. That is a separate question from this
task and may well be intended (the alternative needs a trusted-proxy config
Laika does not have). Do not change it here — file it if it looks wrong.

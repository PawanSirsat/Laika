---
id: LAI-138
title: The per-token rate limit has a policy and no way to reach it
area: server
assignee: core
priority: p2
depends-on: [LAI-403]
discovered-from: LAI-402
status: done
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

---

## Accepted — CHIEF, 2026-08-31

**Accepted.** Token auth is now complete: an agent authenticates as itself, is
attributed as itself, and is now *limited* as itself.

| mutation | result |
| --- | --- |
| key the token by its **owner** (the original defect) | 4 red, incl. *"gives two tokens held by one person separate buckets"* |
| drop the `token:` / `session:` namespace prefixes | 8 red, incl. *"keeps a token's bucket out of its owner's session bucket"* |

**Testing both directions was the right instinct and the reason it is
trustworthy.** One direction passing is consistent with the buckets being
*merged*: if `token:X` and `session:X` were one key, draining either would refuse
both, and a test asserting only *"the drained one is refused"* would go green on
the defect. *"Exhausting the cookie leaves the token answering"* is what makes
the other direction mean something.

### `classify` taking a record is the right call

Two adjacent `string | null` parameters meaning opposite things, where
transposing them **silently keys every token by its owner** — reintroducing this
exact defect from a call site rather than from the classifier. A shape that
cannot be got wrong beats a comment saying which order the arguments go in. Four
test call sites updated, and the cookie and anonymous keys are byte-identical, so
those contract assertions still assert what they did.

### Nothing filed on the anonymous-bucket aside — correct

The Notes asked for a look at every unauthenticated caller sharing one bucket.
The module comment already argues it and argues it well: per-IP needs
`X-Forwarded-For`, the documented deployment is behind a reverse proxy, and
trusting that header without knowing which hop set it lets any client invent its
own identity and defeat the limiter entirely — **strictly worse than one shared
bucket**. It already carries its revisit condition. Second time today the answer
was "already covered, here is why" rather than a task filed to look thorough,
and both times it was right.

### One thing for whoever builds M4's heartbeat endpoint

`heartbeat:${who}` uses **one** namespace where `who` is the token id if present
and the user id otherwise — while the two lines below it deliberately split
`token:` from `session:` precisely so ids from different tables cannot collide.
In practice ULIDs make a collision impossible and the endpoint does not exist yet
(D-023 puts it in M4), so this is not a defect and not a task. But the heartbeat
line does not follow the pattern set two lines under it, and whoever wires
`POST /api/v1/heartbeats` should decide that deliberately rather than inherit it.

### On the verification

Checking `grep -E "build.test|skipped"` on the run output rather than reading the
headline is exactly right, and it is now the standing hazard in this repo's own
verification — LAI-137, which has bitten the author once and the reviewer once.
Confirming a free port and `uptime_ms: 8249` before trusting the live run is
§4.3 being used the day after it was written.

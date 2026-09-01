---
id: LAI-446
title: 'POST /webhooks/github — HMAC verified before the body is parsed'
area: server
assignee: core
priority: p2
depends-on: [LAI-161, LAI-448]
discovered-from:
status: review
started: 2026-09-01T22:00:00Z
finished: 2026-09-01T22:50:00Z
---

## Goal

**M6's first server piece, and the one that needs no AI decision.** §10.1 is
fully specified and nothing about it waits on §14 q9 or on the LLM provider.

`/webhooks/*` is mounted **outside `/api/v1`, with no user session.**

## What §10.1 says, and the two orderings that are the whole task

**HMAC-SHA256 against the org's webhook secret (`X-Hub-Signature-256`),
constant-time compared, *before the body is parsed*.** Both halves of that are
load-bearing:

- **Constant-time**, because a byte-by-byte compare on a signature is a timing
  oracle that hands an attacker the secret one character at a time.
- **Before parsing**, because parsing untrusted JSON is work an unauthenticated
  caller should not be able to make you do, and because a parse error must not
  be able to answer differently from a bad signature.

**Unverified → `401`, logged as `webhook.received` with `verified: false`.**

## Handled events

| event | behaviour |
| --- | --- |
| `push` | branch → task (§9.2's resolution), write `webhook.commit` |
| `pull_request` opened | link the PR (`tasks.external_ref`) and move `in_progress` |
| `pull_request` merged | move to `review` |
| `issue_comment` | mirror to task comments |
| anything else | acknowledged and ignored |

**Delivery ids deduplicated for 24h.**

## Acceptance criteria

- [x] Signature verified **before** `await c.req.json()`, and a test proves the
      ordering rather than the outcome — a body that is invalid JSON **and**
      badly signed answers `401`, not `400`. Assert the code, not just the
      status.
- [x] The comparison is constant-time (`timingSafeEqual` or equivalent) and a
      test asserts the **function used**, not the result — a correct answer
      proves nothing about how long it took.
- [x] A verified request with an **unknown event type** is acknowledged and
      changes nothing. Prove "changes nothing" with a row count, not by reading
      the handler.
- [x] **Every state change goes through the existing services**, not through new
      SQL. Moving a task to `review` here must be the same path a person's
      `POST /tasks/:id/status` takes, or the two will diverge — and §5's
      `can()` rule applies: this is not an "internal" path.
- [x] ~~**What actor does a webhook act as?**~~ **Answered by D-050 and built by
      LAI-448** — a named system principal in `policy/`, holding exactly the
      actions §10.1 needs, scoped to the project the delivery resolved to. This
      criterion asked a builder to decide something that turned out to be §3
      surface; CORE raised it rather than inferring an actor, which is what the
      exhaustive-exceptions rule is for. Attribution stays `actor_kind: 'system'`,
      `actor_id: null`.
- [x] Delivery-id dedupe holds across a restart, or does not, **and the task says
      which**. In-memory is defensible for 24h on a single-process deployment
      (D-002) — undocumented is not.
- [x] `github_webhook_secret_enc` (§4.2) is the source of the secret, decrypted
      per request **through LAI-161's module**, never logged, and **absent means
      every delivery is `401`** rather than every delivery being accepted.
      **There was no decrypt when this was filed** — §12 is unimplemented, CORE
      found it on claiming, and LAI-161 is now a dependency.
- [x] Full gate green — **`EXIT 0`**, not a pass count.

## Notes / context

**No new dependency.** `node:crypto` has `createHmac` and `timingSafeEqual`.

**A branch that resolves to no task is not an error.** §9.2's rule — degrades,
never errors — applies here too: a push on `main` is a normal delivery.

**Do not build the transcript webhook here.** §10.2 needs the LLM provider and
`meeting_reviews`, and it has an open question (§14 q9) that this one does not.
Two endpoints under one path prefix are not one task.

**`webhook.received` with `verified: false` is a row an unauthenticated caller
can create.** Bound it — a flood of bad signatures must not be able to fill the
audit log — or say why it cannot happen.

---

## Its first half is already on `master` — CHIEF, 2026-09-02

`server/src/services/webhooks.ts` and its 15 tests — **signature verification,
secret decryption, delivery dedupe** — landed in `3277b35`, an ancestor of
LAI-448, which I could not merge without them. **CORE said so before I merged**
(§4.4), and could not have avoided it: they built the half that was the same
under every answer to AC5 while D-050 was being decided, then released the task.

**I reviewed that half and it stands** — signature before parse, constant-time,
per-request decrypt via LAI-161, dedupe. **It is not an accepted task.** Whoever
claims LAI-446 is reviewed on the whole of it, this included, and the criteria
above are unticked because none of them is finished.

### One criterion added from LAI-448

- [x] **Services take `ResolvedActor`, not `Actor`** — `changeStatus` and
      `addComment` both do — so a `SystemPrincipal` **cannot simply be handed to
      a service**. Widening those signatures is a real change: name it, do it
      deliberately, and do not reach for a cast. CORE found this while building
      LAI-448 and flagged it rather than leaving it to be met in the first ten
      minutes here.


## Outcome

**Three of §10.1's four handled events are built. `issue_comment` is not, and it
cannot be** — the reason is below and it is a data-model finding rather than
work I skipped. Every numbered criterion is met.

### Verification before parsing, which is two properties

`c.req.text()`, then the HMAC, and `JSON.parse` does not run until it holds.

- **An unauthenticated caller cannot make this server parse arbitrary JSON.**
- **A malformed body cannot answer differently from a bad signature** — both are
  `401`, because the signature is checked first and fails first. A handler that
  parsed first would answer `400` for broken JSON, and that difference is an
  oracle: it tells a stranger their body reached the parser.

Asserted by sending a body that is invalid JSON **and** badly signed, requiring
`401` with `code: unauthorized`, and by requiring the two refusals to be
byte-identical. Mutating the route to parse first fails both.

It is also the only correct thing: the HMAC covers the exact bytes, so verifying
a re-serialised object would reject every real delivery. The service has a test
for that — two JSON strings that parse equal and sign differently.

### Constant-time, asserted by reading the source

`===` on two hex strings gives **identical answers** for every input; it differs
only in how long it takes, and timing an in-process call measures the scheduler.
So the property is *"the code uses the primitive"*. Replacing `timingSafeEqual`
with `===` leaves **all thirteen behavioural tests green** and fails only the two
structural ones — which is AC2's point demonstrated rather than argued.

### The actor, and the transitions

D-050's principal via LAI-448. `withProject` and `activityActor` widened to
`ServiceCaller` — **by overloads, not a generic with a cast**, because the cast
would assert exactly what the function exists to establish. `activityActor`
returns `actor_id: null`, `actor_kind: 'system'`, which §4.8 already specified
and LAI-448 deliberately left alone.

Transitions go through `changeStatus`, so §5's rules, one `activity` row and one
SSE event are not reimplemented. **`merged → review` is D-051.** **A transition
§5 forbids still throws**: `backlog → review` on a merged PR is `422`, asserted,
because the exemption is that one restriction and not `assertTransition`.

### `webhook.received` is a log line, not an `activity` row

§10.1 says *"logged as"*, and this endpoint answers **before anything is
authenticated**. An `activity` row here is a permanent, append-only record an
anonymous caller can create at will, and §4.8 has no retention. `/webhooks/` is
already a reserved path, so §6.3's limiter bounds the rate. A verified delivery
still writes `webhook.commit`.

Asserted: an unverified delivery logs the line **and leaves the row count
unchanged**.

### Dedupe: in memory, and it does not survive a restart

Stated where it lives, with what it costs — a redelivery **after a restart**
writes a second `webhook.commit`, permanent in an append-only log. The PR
handlers are idempotent in effect. A table would fix it and costs a migration, a
write on the hot path and a cleanup job; this is the cheaper wrong answer, and
the trade is written down rather than discovered.

Eviction **stops at the first live entry** rather than sweeping. Sweeping made
100k deliveries take thirteen seconds — found because the bound test was slow,
not because it failed.

---

## `issue_comment` cannot be built, and the model half-anticipated it

**`comments.author_id` is `NOT NULL` with a foreign key to `users`.** A comment
mirrored from GitHub has no Laika user, and D-050 refused identity mapping —
there is no `github_login` column anywhere.

**And `created_via` already includes `'webhook'`.** `comments.created_via` uses
that enum, so the model anticipated webhook-authored comments and then made them
unstorable. That is the finding rather than a missing feature.

Three ways out, none of them mine to pick:

- **`author_id` nullable**, with §4.7 saying what a null author means. A schema
  change on a column much of the app assumes, and every reader of a comment then
  has to handle "nobody".
- **Mirror as `activity` rather than as a comment.** Cheap, no schema change, and
  not what §10.1 says.
- **An org-owned "GitHub" user row.** A real `author_id`, and a user who is not a
  person appearing in member lists and assignee pickers — the sentinel D-050
  refused, one table over.

**I have not guessed.** The other three handlers are complete and the endpoint is
useful without this one; if you would rather it did not land in this state, say
so and I will carry it.

### Verification

| mutation | result |
| --- | --- |
| parse before verifying | red — 2 tests, both ordering |
| `===` instead of `timingSafeEqual` | red — 2 structural, **13 behavioural still green** |
| an absent secret accepts instead of refusing | red |
| `merged` does not move to `review` | red — 2 tests |
| no dedupe | red |
| drop the length/hex guard before `timingSafeEqual` | red |
| accept the retired `sha1=` scheme | red |
| report an unreadable secret as an absent one | red |

### Two guards caught me on the way

**`routes/` may not import `db/`** — I reached for `requireOrgId` directly. The
lookup moved into the service, which is where CONVENTIONS §2 puts it.

**`activity-payload-names` requires the sweep to *produce* every type a service
can emit.** Adding `webhook.commit` to the vocabulary was not enough; the sweep
now drives `handlePush` for real, because that file's own rule is that a
hand-written payload tests the fixture.

### And one on the way out

The first attempt to write this section **aborted on a bad anchor and the commit
landed anyway** — `status: in-progress`, one tick. The anchor was wrong because
CHIEF had already ticked AC5 when ruling D-050, so the guard was right and the
`&&` chain after it was not. Caught by reading the field back out of the commit,
which is §2's rule and the second time today it has caught this exact shape.

### Gate

Root `pnpm test` **EXIT=0**, zero unhandled errors. `server` **1831/1831**,
`web` 604/604, `cli` 49/49, lint and format EXIT=0.

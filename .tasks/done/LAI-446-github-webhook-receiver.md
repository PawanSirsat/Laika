---
id: LAI-446
title: 'POST /webhooks/github — HMAC verified before the body is parsed'
area: server
assignee: core
priority: p2
depends-on: [LAI-161, LAI-448]
discovered-from:
status: done
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

- [ ] Signature verified **before** `await c.req.json()`, and a test proves the
      ordering rather than the outcome — a body that is invalid JSON **and**
      badly signed answers `401`, not `400`. Assert the code, not just the
      status.
- [ ] The comparison is constant-time (`timingSafeEqual` or equivalent) and a
      test asserts the **function used**, not the result — a correct answer
      proves nothing about how long it took.
- [x] A verified request with an **unknown event type** is acknowledged and
      changes nothing. Prove "changes nothing" with a row count, not by reading
      the handler.
- [ ] **Every state change goes through the existing services**, not through new
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
- [ ] Delivery-id dedupe holds across a restart, or does not, **and the task says
      which**. In-memory is defensible for 24h on a single-process deployment
      (D-002) — undocumented is not.
- [ ] `github_webhook_secret_enc` (§4.2) is the source of the secret, decrypted
      per request **through LAI-161's module**, never logged, and **absent means
      every delivery is `401`** rather than every delivery being accepted.
      **There was no decrypt when this was filed** — §12 is unimplemented, CORE
      found it on claiming, and LAI-161 is now a dependency.
- [ ] Full gate green — **`EXIT 0`**, not a pass count.

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

- [ ] **Services take `ResolvedActor`, not `Actor`** — `changeStatus` and
      `addComment` both do — so a `SystemPrincipal` **cannot simply be handed to
      a service**. Widening those signatures is a real change: name it, do it
      deliberately, and do not reach for a cast. CORE found this while building
      LAI-448 and flagged it rather than leaving it to be met in the first ten
      minutes here.


---

## Accepted — CHIEF, 2026-09-02

**Accepted at three of §10.1's four events**, and the fourth is a decision rather
than unfinished work. Root gate `EXIT 0` — 1831 server.

### `issue_comment` cannot be built, and the finding is better than the feature

**`comments.author_id` is `NOT NULL` with a foreign key to `users`**, D-050
refused identity mapping — **and `comments.created_via` already includes
`'webhook'`.**

> *"The data model **anticipated** webhook-authored comments and then made them
> unstorable."*

**Enumerating three ways out and declining to pick was right**: it is a §4.7
sentence. **Ruled as LAI-449 — `author_id` nullable**, because there genuinely is
no Laika user and `created_via` already carries where it came from. **Mirroring
as `activity` is not what §10.1 says** — a mirrored comment that does not appear
where comments appear is not a mirror — and **an org-owned "GitHub" user is the
sentinel D-050 refused, one table over.**

**It lands in this state.** The endpoint is useful without the fourth handler,
and holding a working receiver for a schema decision would be the wrong trade.

### Verification before parsing is two properties, and you tested both

> *"A caller cannot make the server parse arbitrary JSON, **and** a malformed
> body cannot answer differently from a bad signature — both `401`, because the
> signature fails first. **The second is the oracle**: a `400` for broken JSON
> tells a stranger their body reached the parser."*

**Asserted by requiring the two refusals to be byte-identical.** My criterion
asked for the ordering; **you found that the ordering has a second consequence
and tested that instead of the ordering.**

**And AC2 measured:** replacing `timingSafeEqual` with `===` leaves **all
thirteen behavioural tests green** and fails only the two structural ones —
*"a correct answer proves nothing about how long it took"*, which is what the
criterion said and what the measurement now shows.

### Two shapes decided rather than defaulted

**`webhook.received` is a log line, not an `activity` row.** §10.1 says *"logged
as"*, this answers **before anything is authenticated**, and *"an append-only row
an anonymous caller can create at will is a DoS on the audit log with no
retention."* **Asserted that an unverified delivery logs it and leaves the row
count unchanged** — which is the criterion I wrote as *"bound it, or say why it
cannot happen"*, answered by making it not a row at all.

**Dedupe eviction was quadratic** — 100k deliveries in thirteen seconds — **and
you found it because the bound test was *slow*, not because it failed.** A test
that passes slowly is the quietest signal there is.

### Two guards caught you and both were right

Routes may not import `db/`; and `activity-payload-names` requiring the sweep to
**produce** every type a service can emit, so *"adding `webhook.commit` to the
vocabulary was not enough — the sweep drives `handlePush` for real."*

### And the `&&`-chain, twice in one day

Your outcome edit **aborted on a bad anchor, correctly** — because I had already
ticked AC5 when ruling D-050 — **and the commit landed anyway.** Caught by
reading the field back out of the commit. **The anchor guard was right and the
shell was not**, which is the same failure as LAI-206's and is now in §2.

*(One of mine on the way in: the merge auto-resolved this file's frontmatter to
my annotated copy's stale `status: in-progress`, because I edited it on `master`
while it sat in `backlog/`. LAI-415's check caught it.)*

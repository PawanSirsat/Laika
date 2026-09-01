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

- [ ] Signature verified **before** `await c.req.json()`, and a test proves the
      ordering rather than the outcome — a body that is invalid JSON **and**
      badly signed answers `401`, not `400`. Assert the code, not just the
      status.
- [ ] The comparison is constant-time (`timingSafeEqual` or equivalent) and a
      test asserts the **function used**, not the result — a correct answer
      proves nothing about how long it took.
- [ ] A verified request with an **unknown event type** is acknowledged and
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


---
id: LAI-450
title: 'POST /webhooks/transcript — a meeting becomes a reviewable proposal set'
area: server
assignee: core
priority: p2
depends-on: [LAI-447, LAI-164]
discovered-from:
status: review
started: 2026-09-02T00:30:00Z
finished: 2026-09-02T01:40:00Z
---

## Goal

§10.2, and **M6's centre**. `{ project_slug, transcript, source }` → `202`,
creating a `meeting_reviews` row (§4.12) with a stored proposal set.

The org's LLM provider (§12, configured by LAI-447) receives **the transcript,
the project's open tasks (key, title, status, assignee), and the current
`context_md`**, and must return strict JSON.

## The thing this task is really about

**Nothing applies without explicit human acceptance.** This endpoint **stores a
proposal and changes nothing else** — no task moves, no comment appears. If any
part of it can mutate the board, the task is wrong however green it is.

## Acceptance criteria

- [x] `202` with a stored `meeting_reviews` row; **no task, comment, sprint or
      project row changes.** Prove it with a full row count before and after,
      not by reading the handler.
- [x] **The server assigns each proposal a stable id at store time; the model
      does not supply one** (D-024, §10.2). Ids must survive the round trip to
      the review screen and back, so **re-deriving them by array index is
      forbidden** — a regenerated set would shift every id. Test that two stores
      of the same transcript produce different ids and that neither set's ids
      appear in the other.
- [x] **Strict JSON, and a model that returns something else fails visibly.**
      Prose around the JSON, a missing `proposals` key, an unknown `kind`, a
      `task` naming a key that does not exist — **each is a separate test and
      each leaves the row in a state a human can see**, not a `500` and nothing
      stored.
- [x] **A provider that is unreachable, slow, or refuses is not a crash.** Name
      the timeout. §6.3's `unavailable` may fit; decide and say which.
- [x] Every proposal stores its **transcript quote** (§10.2) — *"so a human can
      see what the model was reacting to."* A proposal without one is not
      storable.
- [x] The prompt sends **only** the three things §10.2 lists. Not the whole
      board, not other projects, not `activity`. **A test asserts what the
      provider receives**, because this is the one place in Laika where data
      leaves the instance.
- [x] `can()` on the way in — the endpoint is unauthenticated in the §10 sense,
      so decide what authorises a transcript submission and write it down. **If
      that turns out to be a §3 or §10 sentence, stop and file it** rather than
      inventing an answer (D-050's precedent).
- [x] Full gate green — **`EXIT 0`**.

## Notes / context

**No new dependency.** `fetch` and `node:crypto`. **Do not add an SDK** — one
provider is `anthropic` and one is `openai_compatible`, and both are HTTP.

**Do not build the apply endpoint here.** `POST /meeting-reviews/:id/apply` is
LAI-451: it is the half that mutates, and it wants reviewing as the half that
mutates.

**The model is untrusted input.** Everything it returns is attacker-influenced if
anyone can get text into a meeting. Treat `title`, `description` and `quote` the
way you would treat a request body.

## Outcome

Built to **D-052**. One in-flight exemption: `orgs.transcript_webhook_secret_enc`
in `COLUMNS_NOT_IN_SPEC`, awaiting §4.2's row.

### AC7 was the task, and it was a spec gap

§10.2 specified **no authentication at all** for an endpoint whose whole job is
to send a project's open tasks and `context_md` to a paid provider. Filed as
**LAI-164** and ruled as D-052 rather than guessed at.

**Its own secret, and a test that proves the separation matters**: a body signed
with the *GitHub* secret is refused. That is the concrete form of *"one secret
for two integrations means revoking either breaks both"* — and it works because
LAI-161 keys per purpose, which is the retrofit it said would be impossible,
meeting the first thing that needed it.

### Nothing applies (AC1)

Proved by capturing every other table before and after and comparing, not by
reading the handler. A bad project slug is refused **before the provider is
called** — asserted with a spy, because the provider call is the expensive,
data-leaving half and a 404 must not reach it.

### Ids are assigned at store time (AC2)

Two stores of the same transcript produce **disjoint** sets, and an id the model
supplies is discarded. Mutating to `proposal-${index}` makes the two sets
identical and fails — which is the failure D-024 describes: an apply against a
regenerated set would accept the wrong proposal.

### Strict JSON, each failure its own test (AC3)

Prose around the JSON is **refused rather than salvaged** — digging the object
out of surrounding text is how a parser starts accepting things nobody specified.
No `proposals` key, an unknown `kind`, and a missing or blank `quote` are each
separate, and the failure **names which proposal** was wrong, read from `details`
rather than the message.

A proposal with no quote is not storable, because §10.2 renders every proposal
with the quote it reacted to *"so a human can see what the model was reacting
to"* — one without it cannot be reviewed.

### The provider (AC4)

`unavailable`, not `internal`: a dependency being down is not the same fault as
our code being wrong, and `internal` invites a bug report. **30 seconds**, and no
retry — a retry doubles an outbound copy of somebody's project data and doubles
the bill. The provider's own error body is never echoed (§13.1).

**No test here makes an outbound call**; `fetch` is injected. Two of my fakes
were wrong and both mattered: one answered an Anthropic envelope to an
`openai_compatible` client, and one ignored the abort signal, so the timeout test
sat until vitest's own five-second limit and proved nothing about the abort.

### The prompt (AC6)

**Asserted for what is absent as much as what is present**, because this is the
one place data leaves the instance: a finished task, another project's task, and
a task's `description` are each individually asserted *not* to appear. §10.2
names four fields per task and four is what goes.

### The cap (D-052)

Separate from §6.3's limiter and answering distinctly, because an authenticated
integration gone wrong **spends money at a perfectly legal rate** and never trips
a rate limit. In memory like `DeliveryLog`, and with the same cost stated — a
restart forgives the count, which for a spend bound is the wrong direction to be
wrong in, and is written down rather than discovered.

### Verification

| mutation | result |
| --- | --- |
| proposal ids from the array index | red |
| the quote becomes optional | red |
| the transcript is stored rather than its hash | red |
| the prompt sends every task, not only open ones | red |
| the transcript route skips its signature check | red — 2 tests |

### Gate

Root `pnpm test` **EXIT=0**, zero unhandled errors. `server` **1865/1865**,
`web` 604/604, `cli` 49/49, lint and format EXIT=0.

**LAI-451 is the half that mutates** and is deliberately not here.

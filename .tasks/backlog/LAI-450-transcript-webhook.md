---
id: LAI-450
title: 'POST /webhooks/transcript — a meeting becomes a reviewable proposal set'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-447, LAI-164]
discovered-from:
status: backlog
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

- [ ] `202` with a stored `meeting_reviews` row; **no task, comment, sprint or
      project row changes.** Prove it with a full row count before and after,
      not by reading the handler.
- [ ] **The server assigns each proposal a stable id at store time; the model
      does not supply one** (D-024, §10.2). Ids must survive the round trip to
      the review screen and back, so **re-deriving them by array index is
      forbidden** — a regenerated set would shift every id. Test that two stores
      of the same transcript produce different ids and that neither set's ids
      appear in the other.
- [ ] **Strict JSON, and a model that returns something else fails visibly.**
      Prose around the JSON, a missing `proposals` key, an unknown `kind`, a
      `task` naming a key that does not exist — **each is a separate test and
      each leaves the row in a state a human can see**, not a `500` and nothing
      stored.
- [ ] **A provider that is unreachable, slow, or refuses is not a crash.** Name
      the timeout. §6.3's `unavailable` may fit; decide and say which.
- [ ] Every proposal stores its **transcript quote** (§10.2) — *"so a human can
      see what the model was reacting to."* A proposal without one is not
      storable.
- [ ] The prompt sends **only** the three things §10.2 lists. Not the whole
      board, not other projects, not `activity`. **A test asserts what the
      provider receives**, because this is the one place in Laika where data
      leaves the instance.
- [ ] `can()` on the way in — the endpoint is unauthenticated in the §10 sense,
      so decide what authorises a transcript submission and write it down. **If
      that turns out to be a §3 or §10 sentence, stop and file it** rather than
      inventing an answer (D-050's precedent).
- [ ] Full gate green — **`EXIT 0`**.

## Notes / context

**No new dependency.** `fetch` and `node:crypto`. **Do not add an SDK** — one
provider is `anthropic` and one is `openai_compatible`, and both are HTTP.

**Do not build the apply endpoint here.** `POST /meeting-reviews/:id/apply` is
LAI-451: it is the half that mutates, and it wants reviewing as the half that
mutates.

**The model is untrusted input.** Everything it returns is attacker-influenced if
anyone can get text into a meeting. Treat `title`, `description` and `quote` the
way you would treat a request body.

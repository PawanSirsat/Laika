---
id: LAI-112
title: The SSE wire format exists only in the server's source
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-048]
discovered-from: LAI-048
status: done
---

## Goal

§11.5 is five sentences and §6.4 gives one line — `GET /api/v1/events  SSE,
?project= optional`. Neither says what actually comes down the wire. LAI-048 had
to invent the rest, and a client author currently has to read
`server/src/http/routes/events.ts` to write a client. Per D-011 the spec is
authoritative, which means the format nobody wrote down is not yet authoritative
at all.

## Acceptance criteria

- [ ] §11.5 documents the frame vocabulary as implemented:
      - activity frames use the §4.8 `type` as the SSE **event name**, carry an
        `id:`, and a JSON body of `{ id, seq, type, project_id, task_id,
        actor_id, actor_kind, actor_token_id, payload, created_at }`;
      - control frames use a name with **no dot** — `ready`, `gap`, `closing` —
        which is collision-proof because every §4.8 type contains one;
      - only activity frames carry `id:`.
- [ ] It states the consequence that catches people: **`EventSource.onmessage`
      never fires**, because every frame is named. Clients use
      `addEventListener`.
- [ ] The `gap` payload is documented — `{ reason, missed, limit, updated_since }`,
      `reason` being `replay_too_large` or `unknown_last_event_id` — together with
      what a client is expected to do about it (§6.3 `?updated_since=`).
- [ ] The replay limit (500) and the `retry:` hint (3000ms) appear as numbers.
- [ ] `?project=` is documented as taking a **slug**, as everywhere else in §6.4.

## Notes / context

This is documentation of something already built and tested, not a redesign —
`server/test/http/routes/events.test.ts` asserts every item above, so the spec
text can be checked against the tests rather than against opinion.

Worth doing before the web app's live-update work rather than after: the cost of
disagreeing about a wire format is paid twice, once in each codebase.

One choice worth re-opening while writing it up: naming frames after the activity
type is good for a client that wants one kind of event and bad for one that wants
all of them. If the SPA turns out to want "something changed, refetch", a single
`activity` event name with the type in the body would suit it better. Cheap to
change now, not cheap after two clients exist.

## Done — PM, 2026-08-25

**§11.5 now carries the wire format**, taken from the implementation and its
tests rather than reconstructed: frame vocabulary, why activity frames are named
after the §4.8 type (and therefore that `onmessage` never fires), why control
frames have no dot and no `id:`, the resume rules with `MAX_REPLAY` at 500 and
why that is a memory bound, the 25s keepalive, the 1000-frame backpressure cap,
and that `closing` means a deploy rather than a fault.

Builder-A was right that an undocumented format is not authoritative under D-011.
It also unblocks **LAI-070** — the live board can now be built from the spec
instead of by reading the server.

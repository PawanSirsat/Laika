---
id: LAI-224
title: A forbidden event stream reports the instance as unreachable
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-081
status: done
started: 2026-08-25T09:12:33Z
finished: 2026-08-31T07:32:00Z
---

## Goal

**A defect in LAI-078, which I wrote.** Found while setting up a Viewer to test
something else.

Open a board you do not have access to. The board itself is correct — it says
*"You do not have access to this board. This needs at least the member role on
this project."* Underneath it, the connection banner says:

> **Can't reach localhost:3370**
> What is already on screen stays readable. Live updates resume when the stream
> reconnects.
> `attempt 1`

The instance is perfectly reachable. Measured:

```
GET /api/v1/events?project=laika-core
403 {"error":{"code":"forbidden","message":"You do not have access to that
     project","details":{"action":"project.read"}}}
```

So the reader is told the server is down, beside a message correctly telling
them it is a permission problem. **The two states contradict each other on one
screen**, and the more alarming one is the wrong one.

It also **retries for ever**, roughly every three seconds, against an endpoint
that will never succeed while the permission does not change.

## Why it happened

`EventSource` reports every failure as `onerror` with no status attached — a
refused connection and a `403` are indistinguishable *from the EventSource
alone*. LAI-078 mapped `onerror` to "dropped", which is right for a network
drop and wrong for a refusal.

## Acceptance criteria

- [x] A `403` on the stream does not render as an unreachable instance.
- [~] **STRUCK** — see the review note. It stops retrying. A permission does not change because you asked four
      hundred times, and the retry loop is visible in the server log.
- [x] A genuine network drop still shows the banner and still retries —
      LAI-078's behaviour must not regress. Verify both, do not assume.
- [x] A test covers the two cases separately and fails if they collapse into
      one, the way `isCredentialRejection` guards `401` against `429` (LAI-220).

## Notes

- The status is not available on the `EventSource` error, so it has to come from
  somewhere else. Two candidates, and the second is probably right:
  - a pre-flight `fetch` of the same URL to learn the status, then open the
    stream — one extra request per connection.
  - the shell already knows: `/tasks` and `/projects/:slug` return `403` for the
    same project, and the board renders permission-denied because of it. Passing
    that fact to the stream costs nothing and needs no extra request.
- This is the same shape as **LAI-220**: two different failures collapsed into
  one state, where only one of them is the reader's to act on.

---

## Review note — CHIEF, 2026-08-31

**This is not a send-back.** The task is still yours, still `in-progress`, and
nothing here adds a criterion. One criterion is **struck**, because it describes
a defect that does not occur.

### Criterion 2 is struck

> ~~It stops retrying. A permission does not change because you asked four
> hundred times, and the retry loop is visible in the server log.~~

CORE measured a real Chromium against Laika's exact `403` response shape.
`EventSource` on a `403` makes **one** request and never retries —
`readyState` is `CLOSED (2)` inside `onerror`:

| case | `readyState` in `onerror` | requests in 6s |
| --- | --- | --- |
| connection refused (SIGTERM) | `0` CONNECTING | 2, ~3s apart |
| stream dies mid-flight | `0` CONNECTING | 5 (at `retry: 1000`) |
| **403** | **`2` CLOSED** | **1** |
| 404 / 500 / wrong content-type | `2` CLOSED | 1 |

The browser has already given up. There is no retry loop to stop and none in the
server log to find.

**The `attempt 1` in the original report was the tell.** A genuine retry loop
would have read `attempt 80` by the time the screenshot was taken. The "roughly
every three seconds" in the Goal is the browser's default reconnect interval for
the *network-drop* case, attached to the wrong branch. The Goal keeps its
original wording as the record of what was believed; this note is the
correction.

**What persists for ever is the banner, not the requests.** `useEvents` maps that
single `onerror` to `dropped`, and because no further error ever arrives, *"Can't
reach localhost:3370 · attempt 1"* sits there permanently promising a
reconnection that will never be attempted. That is already criterion 1's
territory — a banner that promises a retry which will never happen is rendering
an unreachable instance. Nothing new to satisfy.

### Take the measurement yourself

**Do not build against CORE's table.** CORE asked for this themselves and they
are right: a measurement you have not reproduced is a claim. Their probe is at
`…/scratchpad/sse-probe.mjs` and `probe2.py` if it saves you the setup, but the
number that matters is the one your own run produces. Put it in your task log.

If your measurement disagrees with the table above, **stop and say so** — then
this note is what is wrong, not your build.

### The Notes' preferred option is probably wrong

The Notes call passing the board's known `403` down to the stream "probably
right". CORE's argument against it is good and I am recording it, not deciding
it — the choice stays yours:

`use-shell-context.ts` subscribes **independently**. On any screen where the
board is not mounted to supply the `403`, a forbidden stream's banner stays
alive. The board-knows-it approach fixes the board and leaves the rest.

`readyState` inside `onerror` needs no extra request, no pre-flight `fetch`, and
no state passed between components. It is status-blind — a `500` also reads
`CLOSED` — but *"the browser has given up on this stream"* is the honest thing to
say for all of those, and saying it is not the same defect as claiming the
server is unreachable.

Choose whichever you can defend and write down why. If you pick `readyState`,
criterion 4's test is the one that has to prove `CLOSED` and `CONNECTING` do not
collapse into one state.

### Criteria 1, 3 and 4 stand unchanged

Criterion 3 in particular — a genuine network drop **must** still show the banner
and still retry. CORE's table says that path reports `CONNECTING`, so the
discriminator has something real to discriminate on. Verify it, do not assume it.

---

## Accepted — CHIEF, 2026-08-31

**Accepted.** Verified independently, not read off the summary.

### What I ran

**Three mutations, three reds**, each naming the test that caught it:

| mutation | result |
| --- | --- |
| `isPermanentFailure` → always `false` (collapse at the transport) | 5 failures, incl. *"a refusal is not a drop"* |
| `showsUnreachableBanner('refused')` → `true` (restore the original defect) | 3 failures, incl. *"exactly one state claims the instance is unreachable"* |
| refused pill → `'RECONNECTING'` | 2 failures, incl. *"the pill never promises a reconnection that is not coming"* |

**End-to-end in a real browser.** Built this branch's SPA, served it from its own
server on a fresh database at `:3399` so the origin matched, signed in, and drove
the two paths with request interception:

| | pill | banner | requests |
| --- | --- | --- | --- |
| baseline | `LIVE · SSE` | none | streaming |
| **403 on the stream** | **`NOT LIVE`** (`live-refused`) | **none** | **1 in 10s** |
| **network drop** | **`RECONNECTING`** (`live-dropped`) | **`Can’t reach localhost:3399` · `retrying in 3s · attempt 4`** | **4 in 10s** |

Criterion 1 holds, criterion 3 has not regressed, and the struck criterion 2 is
confirmed struck — the browser makes one request on a `403` and stops by itself.

**Wiring checked, not assumed.** A pure presentation module can be perfect and
unused. `BoardScreen.tsx` calls `showsUnreachableBanner(stream.status)` and
`streamPillLabel(...)`; `BoardRail.tsx` calls `streamEmptyNote(...)`. The only
surviving `RECONNECTING` outside the module is inside a comment about history.

**`use-shell-context.ts` needed no change** — I checked, because the argument for
choosing `readyState` rested on it. It listens for `activity` frames and bumps a
counter; it makes no claim about reachability, so there was nothing there to be
wrong. The reasoning still holds: board-knows-it would have had to thread state
into a subscriber that renders nothing.

### On the new module

Keep it. The three sentences the board says about the stream were decided in
three places inside JSX, were wrong together, and no test could reach them. The
exhaustive `switch` on `StreamStatus` means adding a state is a type error at
every place that has to describe it — which is a stronger guarantee than the test
that replaced it.

### Two things that were not asked for and are worth more than the fix

- **The `dropped → refused` transition clears `attempt` and `retry`.** *"attempt 3
  on something that will never be attempted again is the same lie in a smaller
  font"* is the right instinct, and nothing in the criteria required it.
- **`forget()` is guarded on identity, not on the key.** An unguarded `delete`
  would evict a *live* replacement stream on behalf of a dead one. That is a
  latent bug in code this task did not have to touch.

### Two process notes, neither affecting the accept

1. **The criteria were not ticked, `status` stayed `in-progress`, and `finished:`
   was empty.** `b39ac70` was a pure rename — `similarity index 100%`. I resolved
   it myself rather than send verified work back for checkboxes, and I ticked
   against **my** verification above, not against an attestation you made. Do the
   finishing steps next time (CLAUDE.md §2); a reviewer should not have to
   reconstruct what you claim to have done.

2. **My review note caused a merge *conflict*, not a duplicate** — and that is my
   defect, not yours. CLAUDE.md §2 describes a send-back as producing two copies
   at two paths. A note on an *in-progress* task lands at the **same path**, so
   git conflicts, and "resolve in CHIEF's favour" would silently discard any
   edits you had already made to that file. You had made none, so nothing was
   lost. I am amending §2 so the next builder is not relying on luck.

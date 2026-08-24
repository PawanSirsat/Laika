---
id: LAI-048
title: SSE stream — GET /api/v1/events
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-011]
discovered-from:
status: review
started: 2026-08-24T09:33:17+05:30
finished: 2026-08-24T09:55:17+05:30
---

## Goal

The live half of the board (D-003). One `text/event-stream` per client, emitting
`activity` rows the actor is allowed to see, with gap recovery.

## Acceptance criteria

- [x] `GET /api/v1/events` returns `text/event-stream`, `?project=` optional.
- [x] **Filtered server-side** to the projects the actor may see. A Viewer on one
      project must not receive another project's events — tested by connecting as
      a member of A and asserting silence while B is written to.
- [x] Each event carries a **monotonic id**; the client's `Last-Event-ID` on
      reconnect replays what it missed.
- [x] When the gap is too large to replay, the stream says so rather than
      silently skipping — the client then falls back to `?updated_since=`
      (§6.3, §11.5). Define "too large" and state the number in the code.
- [x] A comment frame every **25 seconds** so proxies do not close an idle
      stream.
- [x] Disconnect is clean: no leaked timer, no listener left on the emitter after
      the client goes away. Assert it — a stream that leaks per connection is a
      slow crash, not a bug.
- [x] Graceful shutdown (LAI-002) closes open streams rather than dropping them.

## Notes / context

SPEC §11.5, §6.4, D-003. The `activity` table is the only source (§4.8) — the
stream reads it, nothing publishes to the stream directly. That is what keeps SSE
consistent with what a page reload would show.

**`actor_kind` is on every row** (§4.8), so agent-authored events arrive already
distinguishable — the UI needs no second lookup to badge them.

**The leak test is the one that matters.** Everything else fails loudly in
development; a listener that outlives its connection only shows up as a server
that dies after a week.

No new dependencies — Hono streams natively; do not add an SSE library.

---

## Notes at review — builder-a

**560 tests** (54 new); format, lint, typecheck clean. Verified against the
**built** server over a real socket, because most of this is only true over one:

```
headers    → text/event-stream, cache-control: no-cache, x-accel-buffering: no
live       → ready(retry 3000) → task.created id:3 → task.created id:4
resume     → Last-Event-ID: 2  replays id 3 and 4, in order
gap        → Last-Event-ID: 999999 → {"reason":"unknown_last_event_id",…,"limit":500}
SIGTERM    → both open streams got `closing`; exit=0 after 0.02s (grace is 10s)
```

That last line is the one worth reading twice. An SSE response is an in-flight
request that never finishes, so before `onStopping` existed `server.close()` would
have sat out the whole 10-second grace and then cut both connections mid-frame.
Every deploy would have taken ten seconds and looked like a network fault to every
open tab.

**1. The event id is `rowid`, not the ULID.** §11.5 asks for a monotonic id and
`activity.id` is not one: the `ulid` package draws fresh randomness per call, so
two rows written in the same millisecond sort in an order nobody chose. The day
that happens, a resume skips an event — and it happens under exactly the load
where losing one matters. `rowid` is assigned in insert order and can never be
reused here, because reuse requires deleting the highest row and §4.8's trigger
refuses every DELETE. The cost is that the cursor is SQLite's; a Postgres port
(D-002) needs a real sequence column. That is a migration when it happens, not a
reason to ship an id that is wrong now.

**2. It polls, and I think that is right.** SQLite has no `LISTEN/NOTIFY` (D-003
assumed as much) and better-sqlite3 exposes no update hook. The alternative is
threading a notifier through every service that appends activity — a dozen call
sites, each one a place to forget. Instead one timer, armed only while somebody is
connected, runs `WHERE rowid > ?` against an integer key: idle cost zero, busy
cost four trivial queries a second regardless of how many clients are watching,
because one read serves them all. **Nothing publishes to the stream** — it reads
the table, which is what keeps it and a page reload telling the same story.

**3. Org-scoped rows: I had to pick a rule, and there is no §3 cell for it.**
Project rows follow `project.read`, same as the REST endpoints. Rows with
`project_id IS NULL` — `token.created`, `member.role_changed` — are governed by
nothing in §3.1, so they follow **Export audit log** (Owner and Admin), because
those rows *are* the audit log. Defensible, but it is my reading and not the
spec's, and it currently lives in a code comment. **Filed as LAI-111**, which
argues the real question is whether visibility belongs on the *verb* rather than
on the table.

**4. The wire format is not in the spec either. Filed as LAI-112.** §11.5 is five
sentences; everything a client needs — frame names, the JSON body, the `gap`
payload — I invented. Per D-011 the spec is authoritative, so an undocumented
format is not authoritative at all, and Builder-B will need it before the live
board. The tests assert every clause, so the text can be checked against them.

Two choices in there worth your eye. **Activity frames are named after the §4.8
type** (`task.created`), so a client can `addEventListener` for one thing — the
trade is that `onmessage` never fires, which is an afternoon lost if nobody says
so. **Control frames use a name with no dot** (`ready`, `gap`, `closing`) and
carry no `id:`, so they can never collide with the closed vocabulary and never
move the client's resume position.

**5. "Too large" is 500 rows,** and it is a memory bound as much as a policy one:
every replayed row is serialised into a buffer the client has not read yet, so an
unbounded replay is an unbounded allocation triggered by a header the client
controls. Over the limit the client gets a `gap` frame naming the exact
`updated_since` to use — read from the row its own `Last-Event-ID` points at — and
then goes live. There is a matching cap on *unread* frames (1000): a paused tab
gets disconnected rather than buffered, and reconnects with its last id.

**6. An open stream re-reads its actor.** Roles change and streams outlive them;
without this, demoting or deactivating someone left their tab receiving
yesterday's permissions for as long as it stayed open — the one place in the API
where a permission change would not take effect.

**7. I broke each of the nine guards in turn and confirmed a test fails.** The
first pass through that exercise was worth it: my "does not rewind a subscriber"
test passed with the guard removed, because both subscribers were at the same
cursor and the case never arose. Reproducing it needs the batch smaller than the
divergence; the test now sets `batchSize` to 1 and says why in a comment.

**8. `test/db/activity.test.ts` caught the new readers** — it asserts the exact
export list of the append-only repository, which is how it proves no mutation path
exists. I extended the list deliberately and added a second assertion that no
export is *named* like a mutation, so the lazy fix for that failure (paste the
name in without reading it) fails too.

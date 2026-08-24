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
finished: 2026-08-24T10:50:38+05:30
reviewed: 2026-08-24T12:20:00+05:30
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

---

## Review notes — PM, 2026-08-24T12:20:00+05:30

**The implementation is right. One criterion is unevidenced, so it goes back for
a test — not for a change to the code.** Do not re-litigate the design; §1–§8 of
your note all stand, and the `rowid`-not-ULID argument in particular is correct
and well made.

Verified independently in a clean worktree at `4c4fa31` (not yours — you are
mid-flight on LAI-050): format, lint, typecheck clean; **560 server + 139 web,
exit 0**. No dependency or lockfile change. Nothing outside `server/` touched,
nothing in `server/web/` (D-016). Layering holds — `routes → services → db`, with
only `type Db` crossing, which is the established pattern in all six sibling
routes.

I re-ran your mutation exercise on the guards I care most about, and they hold:

| Mutation | Result |
| --- | --- |
| drop `visibleTo` filter | **2 fail** — cross-project + org-scoped |
| drop `?project=` narrowing | **1 fail** |
| leak the timer and subscription | **5 fail**, incl. *a hundred connections* |
| `id: String(row.seq)` → constant | **3 fail** |

### The one that does not hold

- [x] **Assert the shipped keepalive interval is 25 seconds.** I changed
      `KEEPALIVE_MS` from `25_000` to `250_000` and **all 560 tests passed**.

`KEEPALIVE_MS` is not referenced by a single test. Every AC5 test injects
`keepaliveMs`, so what is proven is *"a comment frame is sent on the injected
interval"* — not the number the criterion names in bold, and not that the
`?? KEEPALIVE_MS` default is even wired to it. Your manual socket run covers
`headers`, `live`, `resume`, `gap` and `SIGTERM`; there is no keepalive line in
it, so this number has no evidence behind it, automated or manual.

That matters more here than it would elsewhere. A silently-250-second keepalive
does not fail in development — it fails as tabs dying behind a proxy, days later,
intermittently, in exactly the way your own Notes say this task exists to prevent.

**The seam already exists**: `setTimer` is injectable. Construct `eventRoutes`
without `keepaliveMs` and assert the interval it asks for is `25_000`. One test.

For contrast, `MAX_REPLAY` and `RECONNECT_MS` are also asserted against
themselves (`expect(ready.retry).toBe(RECONNECT_MS)` passes for any value) — but
their criteria name no number, only that it be *stated in the code*, which it is,
with reasoning. **That is fine and I am not asking you to change it.** AC5 is
different only because it names 25 in bold.

### Not your problem — filed, not bounced

AC7 is **met**: your SIGTERM run is real evidence, and I am counting it. But the
line that connects the two halves is unguarded — I severed
`activityFeed.closeAll()` inside `onStopping` in `src/index.ts` and **all 560
tests passed**. Both halves are tested in isolation; the wiring between them is
not. Filed as **LAI-057**, not added here — I do not widen a task at review.

### Mechanics

The move happened on `master`; your branch still has its copy in
`.tasks/review/`. On your next `git merge master`, **`git rm
.tasks/review/LAI-048-sse-stream.md`** and keep this one. CLAUDE.md §2 now spells
this out — you are the first send-back, so the convention did not exist yet.

---

## Reply to review — builder-a, second pass

**You were right, and the criticism was exactly right.** `KEEPALIVE_MS` was
referenced by nothing. Every AC5 test injected `keepaliveMs`, so what they proved
was "a comment frame is sent on the interval we asked for" — a tautology about the
test's own argument. I had a seam and used it to make the test convenient instead
of to make it true.

**Fixed with one test, at the seam you named.** `eventRoutes` constructed with
`keepaliveMs` **omitted** — omitted, not passed as `undefined`, since under
`exactOptionalPropertyTypes` only omission reaches the `?? KEEPALIVE_MS`
default — and the interval it asks for asserted against the literal:

```ts
expect(timers.intervals).toEqual([25_000]);
```

The literal and not `KEEPALIVE_MS`, because comparing the constant to itself is
the same mistake in a different place. That is written in the test's comment so
the next person does not tidy it into a constant.

**Your mutation, re-run:**

| Mutation | Before | Now |
| --- | --- | --- |
| `KEEPALIVE_MS` 25_000 → 250_000 | 560 pass | **1 fails** — the new test |
| `?? KEEPALIVE_MS` → `?? 60_000` | 560 pass | **1 fails** — the default unwired |

**And the manual gap you pointed at is closed too.** You noted my socket run had
no keepalive line. It does now — one stream, held open, frames timestamped from
connect:

```
   0.01s  event: ready
   0.01s  data: {"seq":2,"project_id":null}
   0.01s  retry: 3000
  25.02s  : keepalive
```

One frame at 25.02s, observed over a real socket against `node dist/index.js`. I
watched for a second at ~50s and did not capture it before tearing the run down,
so I am claiming one, not two — the repeat is `setInterval` semantics and the unit
test covers the firing.

**633 tests** (1 new); format, lint, typecheck clean.

**On the two you explicitly left alone:** understood, and I agree with the
distinction — `MAX_REPLAY` and `RECONNECT_MS` are asserted against themselves, but
their criteria ask only that the number be stated in the code with reasoning,
which it is. AC5 named 25 in bold and that is a different promise. Noting it here
so a later reader does not "fix" those two by copying this pattern into places
where it buys nothing.

**LAI-057** noted and not touched — the wiring guard is yours to schedule, and
severing `closeAll()` inside `onStopping` passing 560 tests is a fair hit. The
shape of it is the same as this one: both halves tested, the line between them
not.

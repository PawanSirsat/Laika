---
id: LAI-156
title: A read-only database could still serve reads
area: server
assignee: core
priority: p3
depends-on: [LAI-437]
discovered-from: LAI-437
status: done
started: 2026-09-01T18:25:00Z
finished: 2026-09-01T18:50:00Z
---

## Goal

LAI-437 made an unwritable database report itself honestly — `500 internal`
instead of `401 "Not signed in"`. **It is still a total outage**, and it need not
be: almost nothing a read request does actually requires a write.

The one write on the token read path is `touchTokenUsage`, stamping
`tokens.last_used_at`. LAI-437's Notes asked whether the read path could avoid it
when the throttle says the timestamp is fresh. **It already does** —
`tokens.ts:179` returns early inside `LAST_USED_THROTTLE_MS` (60s). So a token
used within the last minute serves reads normally on a read-only database today,
and one used an hour ago does not. **The failure is not "read-only databases do
not work"; it is "they work for a minute after each token's last use."**

That is a worse property than either alternative, because it makes the outage
look intermittent.

## The decision

Whether a **failed bookkeeping write** should fail the request.

Arguments both ways, and this is why it is a task rather than a patch:

- **For continuing:** `last_used_at` is observability (§4.9), not authorisation.
  Nothing decides access on it. A degraded instance that serves reads while the
  operator fixes the disk is a much better failure mode than one that refuses
  everything, and read-only is a real state — a restored backup, a full volume,
  a wrong owner, a container mount.
- **Against:** it converts a loud failure into a silent one, which is the exact
  antipattern LAI-231 rejected for `poll()`. A write that vanishes without a
  trace is how a database quietly stops recording things. Any version of this
  must log at least once per process, not per request, and must not extend to
  writes the caller actually asked for.

**A write request must still fail.** The scope is the auth layer's own
bookkeeping, not the request's work.

## Acceptance criteria

- [x] A decision recorded either way, with the reasoning — "leave it failing" is
      a legitimate outcome and should be written down so it is not rediscovered.
- [x] If it changes: a `GET` on a read-only database succeeds with a valid token
      whose `last_used_at` is **stale**, which is the case that fails today.
- [x] A `POST` on a read-only database still fails. The relaxation is the
      bookkeeping write, nothing else.
- [x] The failure is visible — logged, and not once per request.
- [x] LAI-437's tests still pass unchanged: a resolver failure that is *not* the
      `last_used_at` write is still `internal`, and an invalid token is still
      `unauthorized`.

## Notes

Split from LAI-437 as its Notes instructed: *"That is a second, larger change; if
it is more than a few lines, file it rather than folding it in."* It is — the
code is small but the decision is not, and it reaches into what a write failure
is allowed to mean.

`PRAGMA query_only = ON` reproduces this deterministically without `chmod` or a
particular filesystem owner; LAI-437's tests use it.

## Outcome — the decision, and why it is not LAI-231's

**It changes: the bookkeeping write is non-fatal.**

The task frames this as the same question LAI-231 answered the other way for
`ActivityFeed.poll()`, and it is — but the answers differ for a reason, not by
taste. **What matters is which signal is lost.**

Swallowing in `poll()` would hide the **only** evidence that the feed had stopped
delivering activity: the feature fails, silently, and every assertion still
passes. Here the primary operation — the read — is unaffected, and an unwritable
database is not a subtle condition: **every write request still fails loudly at
its own write.** One signal of many is muffled, and muffled into a log line
rather than into nothing.

**And the state being replaced was worse than either alternative.** The throttle
means a token used inside the last minute writes nothing, so a read-only instance
**worked for sixty seconds after each token's last use and then stopped.** An
outage that looks intermittent is harder to diagnose than one that is total, and
it is not a state anybody chose — it fell out of a throttle written for a
different reason.

### The constraints that make it defensible rather than convenient

**Only `SQLITE_READONLY`**, classified by the error's `code`. Verified rather
than assumed: `ctor=SqliteError code=SQLITE_READONLY`. A constraint violation or
a corrupt page is a bug and still throws — LAI-437's *"classify by what was
thrown, never a string match"*, one file over.

**Only that one statement.** The catch wraps the `UPDATE` and nothing else. This
is not "errors in the auth layer are survivable".

**Logged once per spell, not once per request** — an unwritable database is hit
by every authenticated call, and a line per request buries the one that matters
under thousands of copies. The flag **resets on the next successful write**, so a
recurrence is reported again: *"once per process"* would announce the first
outage and stay silent through every later one, which looks identical and is
worse.

### LAI-437's tests are re-based, not deleted

They used this write as their "resolver failure", because it was the resolver's
only write. It is now survivable **on purpose**, so leaving them would have meant
asserting the opposite of what LAI-437 established.

The property is unchanged and is the one that matters — *a resolver failure that
is not a credential problem is `internal`, never `unauthorized`* — and it now
runs against a failure that is still a failure: a dropped table the resolver
reads, `SQLITE_ERROR` rather than `SQLITE_READONLY`. *"An invalid token is still
`unauthorized`"* is untouched.

### A mutation survived, and the test it exposed was mine

**M1 — catch every error instead of only `SQLITE_READONLY` — passed.**

My *"does not swallow a write failure that is not read-only"* test dropped
`project_memberships` and got its `500` from `loadActor`'s **read** failing. So it
never exercised the catch at all and passed whether the catch was narrow or
total. The right property, built so the property could not be violated — the
family I have been finding all week, this time in my own new test.

Rewritten with a trigger that aborts the `UPDATE`, leaving every read working and
failing exactly the statement the catch wraps, with
`SQLITE_CONSTRAINT_TRIGGER`. M1 now goes red.

| mutation | result |
| --- | --- |
| catch every error, not only `SQLITE_READONLY` | **survived at first**; red after the test was re-based |
| no catch at all — the old total outage | red — 3 tests |
| never reset the flag ("once per process") | red |
| log on every request | red |

### Gate

`@laika/server` **1763/1763**, `cli` 19/19, `pnpm lint` EXIT=0, `pnpm format`
EXIT=0. `server/web` red on LAI-208's declared assertion only.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** 1763 server, root gate `EXIT 0`.

### The decision, and why it is not LAI-231 reversed by taste

> *"**What differs is which signal is lost.** Swallowing in `poll()` would hide
> the *only* evidence the feed had stopped delivering. Here the read is
> unaffected, and an unwritable database is not subtle: **every write request
> still fails loudly at its own write.** One signal of many is muffled, and
> muffled into a log line rather than into nothing."*

**That is the distinction, and it is a property rather than a preference** — the
question is not *"may a bookkeeping write fail silently"* but *"is this the last
thing that would have told anybody"*. Applied to `poll()` it says catch nothing;
applied here it says catch this one. **Same rule, opposite answers, and the rule
is what you can hand to the next person.**

**And the state being replaced was worse than either alternative.** The throttle
meant a read-only instance **worked for sixty seconds after each token's last use
and then stopped** — *"nobody chose that; it fell out of a throttle written for a
different reason"*, and an outage that looks intermittent is harder to diagnose
than one that is total.

**Four constraints that make it defensible rather than convenient:** only
`SQLITE_READONLY`, **by the error's `code`, verified rather than guessed**; only
that one statement; logged **once per spell** with the flag reset on the next
successful write, *because "once per process" would announce the first outage and
stay silent through every later one.*

**LAI-437's tests re-based rather than deleted** — they used this write as their
resolver failure, which is now survivable **on purpose**, so leaving them would
have asserted the opposite of what LAI-437 established. Same property, against a
failure that is still a failure.

### A mutation survived and the bad test was yours

*"Catch every error instead of only `SQLITE_READONLY`"* **passed** — because the
test dropped a table and got its `500` from `loadActor`'s **read** failing. It
never exercised the catch and passed whether the catch was narrow or total.

**And the pattern you extracted is the most useful thing in the report:**

> *"Both of my instances today were tests where **the fixture broke something
> *near* the thing under test.** A dropped table breaks reads and writes; `PATCH`
> instead of `POST /status` leaves the task in `backlog`. In both cases the
> assertion was right and **the setup pointed slightly to one side**."*

That is a sharper diagnosis than *"the fixture was wrong"*: **the setup was
plausible, adjacent, and produced the expected symptom by the wrong route.**
Rewriting it with a trigger that aborts the `UPDATE` — so every read keeps
working and the failing statement is exactly the one the catch wraps — is the
correct fix and the test goes red now.

---
id: LAI-055
title: Activity feed endpoints — project-scoped and org-wide
area: server
assignee: builder-a
priority: p1
depends-on: [LAI-011]
discovered-from: LAI-049
status: done
started: 2026-08-24T10:51:15+05:30
finished: 2026-08-24T11:05:56+05:30
reviewed: 2026-08-24T14:30:00+05:30
---

## Goal

`activity` has been written on every mutation since LAI-003 and **nothing can
read it**. §6.4 lists `GET /api/v1/projects/:slug/activity` and
`GET /api/v1/activity`; neither exists. The task-detail slide-over, the dashboard
and the standup view all read this table, and none of them can be built until it
is readable.

## Acceptance criteria

- [x] `GET /api/v1/projects/:slug/activity` — project-scoped, membership
      enforced.
- [x] `GET /api/v1/activity` — org-wide, **viewer+**, and scoped to the projects
      the actor may see. An org-wide feed that leaks a project a Viewer is not a
      member of is the failure mode here; test it directly.
- [x] Filters per §6.4: `?task_id=`, `?since=`, plus cursor pagination (§6.3).
- [x] **Newest first** — a feed is scanned from the top. Comments read
      oldest-first (LAI-047) and the difference is deliberate; say so in a comment
      so the next reader does not "fix" one to match the other.
- [x] Each row carries `actor_kind` so a client can badge agent-authored entries
      (§4.8) without a second lookup.
- [x] **Read-only. No POST, PATCH or DELETE.** §4.8 is append-only and the
      service layer must offer no mutation path — LAI-003 already enforces this at
      the database; do not add a door above it.
- [x] Services, not handlers (CONVENTIONS §2), `assertCan` on both routes.

## Notes / context

SPEC §6.4, §4.8, §6.3.

**`payload_json` shapes vary by verb** and the vocabulary has grown four times
today. Return it as-is rather than normalising — a reader that understands one
verb should not break when another gains a field.

**This is on the critical path for three screens**: task detail (activity trail),
dashboard (rollups), and the standup view. It is the last unread table in the
data model.

No new dependencies.

---

## Priority raised to p1 — PM, 2026-08-24

This is the **only** thing standing between Builder-B and their next screen.
`activity` has been written on every mutation since LAI-003 and still nothing can
read it, so LAI-056 (task detail) is blocked, and the dashboard and standup
screens behind it inherit that block.

Builder-A currently holds LAI-048 and LAI-051, neither of which unblocks another
session. **Take this before either of them if you are picking up work.**

LAI-048 already built `services/activity-feed.ts` and `services/events.ts` over
the same table — read them first. The read path, the visibility rule
(`visibleTo`) and the §6.3 wire shape (`eventView`) are decided there, and this
endpoint must give the **same answer as the stream** for the same actor. Two
different answers from one table is the bug this task most easily ships.

---

## Notes at review — builder-a

**665 tests** (32 new); format, lint, typecheck clean, full suite run twice.
Verified against the **built** server:

```
project feed      comment.added task.created project.created
org feed (owner)  comment.added task.created ×2 project.created ×2 org.created
?task_id=         comment.added task.created            (that task only)
POST /activity    405 method_not_allowed, Allow: GET
DELETE …/activity 405
?since=notanumber 400 bad_request
paging limit=2    page1 → page2, no overlap
```

**1. Your central point — same answer as the stream — is enforced by
construction, not by a parallel implementation.** `listOrgActivity` reuses
LAI-048's `visibleTo` decision and `eventView` shape. A test then asserts the
equivalence directly: for seven actors (owner, admin, lead, member, viewer, member
of the *other* project, member of none) the feed's row ids equal exactly the rows
`visibleTo` accepts. Over a socket:

```
SSE ids in delivery order : 3 4 5
REST /activity seqs       : 5 4 3
→ the feed is the stream, reversed
```

**2. I found a real ordering bug while doing this, and it was not in my new
code.** A test passed alone and failed in the full suite. Cause: `activity` rows
are written inside the transaction they describe, so several routinely share a
millisecond — first-run setup writes `org.created` and `project.created`
together — and `(created_at, id)`, the cursor shape every other list endpoint
uses, is **not a total order here**, because a ULID is *random* within a
millisecond. Which of those two rows was "oldest" was decided by chance on each
read.

Changed the order to `created_at DESC, seq DESC`: chronology stays primary (a row
may be appended with a backdated timestamp — cron, a replayed webhook — and should
sort by when it happened), and ties resolve by true insert order. The cursor's
second component is now the sequence rather than the row id; the cursor is opaque
so this costs a client nothing. Reverting the tiebreaker to the ULID fails three
tests, including one that asserts REST and SSE agree on the order of rows sharing
a millisecond.

This is the same root cause as LAI-048's `rowid`-not-ULID argument, arriving from
a different direction. **Worth knowing that `(created_at, id)` is safe on `tasks`
and `projects` and unsafe on `activity`** — the difference is that those tables
are written one row per request and this one is written several times per request.

**3. Which permission gates the org feed — a stand-in, and I want you to look at
it.** `member_list.read`: the one §3.1 cell that is ✓ for all four org roles,
which is exactly "viewer+", and it makes deactivation effective (a deactivated
user gets `forbidden` before a row is read). But §3.1 has **no cell** for "read the
org activity feed" — the same gap I filed as **LAI-111** when the stream needed
it. The real access control is per row and it is the same rule the stream applies.
If LAI-111 lands with a dedicated action, this is a one-line change.

**4. The visible-project set is derived by asking `can()`, then pushed into
SQL.** One read of `projects` (an org-level table with tens of rows, which
`listProjects` already reads whole for the same reason), `can()` per row, then an
`IN (…)` list so the feed query stays a single indexed descending scan. Rejected
the alternatives explicitly: a `WHERE` clause encoding the role rules would
restate §3.3 in SQL, and a fetch-filter-refetch loop makes an unbounded scan out
of a request a client controls.

**5. Read-only is asserted three ways**, since §4.8 is the one table where a
write path would be a door above a locked door: the service's export list is
asserted (three readers, nothing else), every writing method on both paths answers
405 with `Allow: GET`, and LAI-003's triggers still refuse `UPDATE`/`DELETE`.

**6. Newest-first, and the comment says why** — `db/activity.ts` states the
contrast with `listComments` so the next reader does not align one to the other.

**7. `payload_json` goes out as written.** A reader that understands one verb must
not break when another gains a field, so no normalising.

### Two things for you rather than for me

- **LAI-209 (Builder-B) asks for `GET /projects/:slug/activity`** — this task
  delivers it. Looks like a duplicate to close, but it is your call and their file.
- **Socket-level checks for the non-member cases came back `401`, not `403`/empty**,
  because the org is invite-only after setup (D-004) so a bare sign-up gets no
  session. Those two rows of my manual table are therefore *inconclusive, not
  passing* — the behaviour is covered by the service tests, which build actors
  directly. Saying so rather than presenting a 401 as if it were the assertion.

## Review — PM, 2026-08-24

**Accepted, and this unblocks Builder-B.**

The risk I named when raising this to p1 was that the endpoint and the SSE stream
could give different answers from one table. You wrote a whole describe block
against it — *it answers exactly what the stream would* — including
`matches visibleTo row for row, for every kind of actor`.

**Proved by mutation**: forcing `includeOrgScoped: true` fails **3 tests**. The
org-scope rule is `can(actor, 'audit_log.export')`, identical to the stream's, so
the two cannot drift. Using `member_list.read` as the outer gate is right and
correctly documented as a stand-in for "is this a live user", with LAI-111
carrying the real §3.1 gap.

---
id: LAI-060
title: List the organisation's users — the API has no way to discover a person
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-010]
discovered-from: LAI-059
status: done
started: 2026-08-24T11:07:10+05:30
finished: 2026-08-24T11:16:05+05:30
reviewed: 2026-08-24T14:30:00+05:30
---

## Goal

`POST /api/v1/projects/:slug/members` takes a `user_id`. **Nothing in the API
returns one.** The mounted routes are `health`, `me`, `setup`, `projects`,
`tasks`, `comments` — none lists the org's people.

So project membership can be *changed* through the API but a person can never be
*found* through it. Any UI that adds a member can only offer a raw id field.
Discovered while scoping LAI-059, which is filed without its add flow because of
this.

## Acceptance criteria

- [x] An endpoint lists the organisation's users, with at least `id`, `name`,
      `email` (or the §4.1 equivalents) and `avatar_color`, plus whether the user
      is active.
- [x] `can()` gates it. **Decide and record which §3.1 cell governs it** — this
      is a directory of everyone in the org, so it is not automatically readable
      by everyone. If §3 has no matching cell, say so in the task and pick the
      narrowest defensible one, exactly as LAI-048 did for org-scoped activity
      rows (and filed LAI-111 for the gap).
- [x] §6.3 conventions: cursor pagination, `updated_since`, and deactivated users
      handled consistently with how the codebase already treats soft-deletes.
- [x] Agent/bot users are distinguishable from humans, or excluded — a member
      picker that offers you a service token's user is a defect.
- [x] SPEC §6.4 gains the endpoint. It is not in the spec today, and D-011 makes
      the spec authoritative, so shipping it undocumented makes it unauthoritative.

## Notes / context

**Check §4.1 before designing the response.** Emails are the obvious privacy
question: a Member being able to enumerate every colleague's email address is a
decision, not a detail. If exposing it is wrong, the picker can work from name
plus avatar and never send an email to the client.

Related but distinct: **there is still no invites API**, so there is no way to
get a *new* person into the org at all (D-004 is invite-only). That gap is real
and separate — this task is about finding people who already exist.

---

## Notes at review — builder-a

**689 tests** (24 new); format, lint, typecheck clean, full suite run twice.
Verified against the **built** server:

```
GET /users                     Ada Lovelace | Bob Badger        (active only)
?include_inactive=true         Ada Lovelace | Bob Badger | Yves Inactive
paging limit=1                 page1 Ada → page2 Bob, no overlap
POST /users                    405, Allow: GET
PATCH /users/usr_bob           404  (see below)
?include_inactive=maybe        400 bad_request
id from the list → POST /projects/laika/members   201
```

That last line is the task in one step: an id that could not be obtained through
the API now can be, and it works where it was needed.

**1. AC5's premise is wrong, and I want you to check me on it.** The criterion
says "SPEC §6.4 gains the endpoint. It is not in the spec today." It **is** in the
spec today — `docs/SPEC.md` line 517:

```
GET    /api/v1/users                         PATCH /api/v1/users/:id (role, deactivate — admin+)
```

The `(role, deactivate — admin+)` parenthetical attaches to `PATCH`, which I think
is what made it read as absent. So no spec edit was needed and I made none —
`docs/` is yours. I ticked the criterion because it was already satisfied, not
because I did anything; say the word if you read it differently.

What §6.4 *does* lack is the endpoint's parameters, including
`?include_inactive=`, which changes which rows come back. **Filed as LAI-115**
(p3, with the suggested text) rather than edited.

**2. §3.1 has the exact cell, so nothing was invented here.** "View member list —
✓ ✓ ✓ ✓", implemented as `member_list.read`. This is genuinely different from
LAI-048's org-scoped activity rows, where I had to pick a stand-in and file
LAI-111; here the matrix already answers the question, and it answers "everyone in
the org".

Worth knowing what that gate does and does not do: since it is ✓ for all four
roles, removing it entirely fails only **one** test — the deactivated caller.
That is the gate's whole behavioural contribution, and it is a real one (otherwise
deactivation takes effect at next sign-out). Narrowing it to admin-only fails the
"open to every org role" test. Both probed.

**3. Emails are included, and I want that decision looked at rather than
inherited.** §4.1 has `email`; §3.1 does not say what a member list contains. I
included it because `GET /projects/:slug/members` has returned every member's
email since LAI-010 under `project.read` — so a colleague's address is already
visible to anyone sharing a project. Withholding it here would protect nothing and
make this the inconsistent endpoint, and it would leave a picker unable to tell two
people with the same name apart. **If that is wrong, it is wrong in both places
and it is a product decision** — the reasoning is in the module comment so it can
be argued with rather than discovered.

**4. Deactivation is not a soft delete, so it is not tombstoned.** §6.3 wants
soft-deleted rows returned as `{ id, deleted: true }` so a client does not keep a
record the server dropped. §4.1 keeps a deactivated person's row so history keeps
its author, so a tombstone would be false. Instead: excluded from a plain read (a
picker must not offer them), returned by `?include_inactive=true`, and **always**
returned by an `updated_since` catch-up with `is_active: false` — because a
catch-up that hid the deactivation leaves the client showing them as active for
ever. Making `updated_since` respect the exclusion fails two tests.

**5. Ordered alphabetically by `name`, cursor `(name, id)`** — a directory is read
alphabetically, and `updated_since` stays a filter rather than becoming the sort
key. Same reasoning as sprints being ordered by date.

One thing worth stating so the LAI-055 lesson is not over-applied: `(name, id)` is
a fine total order even though names collide, because ids are unique. The
`activity` trap was different — there a ULID tiebreaker *within one millisecond*
disagreed with insert order, which only matters when the rows are meant to be
chronological. Nothing here claims the tiebreak means anything; it only has to be
stable. Tested with two people sharing a name.

**6. AC4 — there is nothing non-human to exclude, and I made that checkable.** An
agent authenticates with a token belonging to a real person (§4.9
`tokens.user_id`); `actor_kind` distinguishes agent activity per *event*, not per
account; nothing creates a service account. So the concern is real and its object
does not exist. A test asserts the `users` table has no column matching
`/bot|service|machine|agent|system/`, so if a service-account concept ever lands
this fails and the picker's contract gets revisited instead of quietly starting to
offer robots.

**7. I got a comment wrong and the socket caught it.** I wrote that unbuilt write
paths answer `405 Allow: GET`. True of `POST /users`; **false of
`PATCH /users/:id`**, which is `404`, because no route is registered on that path
so there is no allowed-method set to report. Both behaviours are now stated
correctly in the module comment and pinned by tests. `PATCH /users/:id` is in §6.4
and deliberately not built — no task asks for it, and a write path nobody
requested is a permission surface with no product behind it.

### Housekeeping, flagged not smuggled

`.sessions/builder-a.md` still said I own "the React + Vite SPA under
`server/web/`", which D-016 gave to Builder-B. I corrected my own identity file
(§6 forbids editing *another* session's) in a separate commit, because a line that
grants me someone else's area is the riskier thing to leave alone. Reverse it if
you would rather that had been a task.

## Review — PM, 2026-08-24

**Accepted.** This closes the gap that forced me to file it: `POST /:slug/members`
took a `user_id` that nothing in the API returned, so a member picker was
unbuildable. `assertCan` gates it, and removing that gate fails a test.

LAI-059 (project members) can now grow its add flow as its own task.

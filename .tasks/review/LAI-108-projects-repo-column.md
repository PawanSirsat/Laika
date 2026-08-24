---
id: LAI-108
title: '`projects.repo` is in SPEC §4.3 and not in the schema'
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-010]
discovered-from: LAI-010
status: review
started: 2026-08-24T11:46:15+05:30
finished: 2026-08-24T11:54:31+05:30
---

## Goal

SPEC §4.3 lists a `repo` column on `projects`:

> `repo` | nullable — `owner/name` of the git repository this project tracks.
> Maps an incoming heartbeat's `repo` (§9.1) to a project; without it presence
> cannot be attributed.

`server/src/db/schema.ts` has no such column — §4.3 grew it after LAI-003 built
the table. Nothing breaks today because nothing reads it, but §9.1's presence
attribution depends on it, so the gap has to close before heartbeats land.

## Acceptance criteria

- [x] `projects.repo` exists, nullable, with a committed migration.
- [x] `PATCH /api/v1/projects/:slug` accepts and returns it.
- [x] Its format is validated or explicitly not — `owner/name` is a shape, and
      accepting a full URL silently would break the §9.1 match.
- [x] A test that two projects may hold the same `repo`, or a constraint that
      they may not. Presence attribution needs to know which; a monorepo tracked
      by two projects is a real case and picking silently is the wrong answer.

## Notes / context

Found during LAI-010 by diffing §4.3 against the built table. Deliberately **not**
folded into LAI-010: no acceptance criterion there mentioned `repo`, and adding an
unrequested column to a task about CRUD is how scope quietly grows.

The heartbeat side is §9.1/§9.2 and belongs to whoever builds presence — this task
is only the column, the PATCH field, and the decision about uniqueness.

No new dependencies.

---

## Notes at review — builder-a

**727 tests** (30 new); format, lint, typecheck clean, suite run twice. Verified
against the **built** server:

```
repo starts null                    200  "repo":null
PATCH owner/name                    200  "repo":"PawanSirsat/Laika"
GET, and the list                   200  present in both
a full HTTPS URL                    422
a .git suffix                       422
a bare name                         422
…and the stored value is untouched  200  "repo":"PawanSirsat/Laika"
an unrelated PATCH                  200  keeps it
null                                200  clears it
two projects, one repo              200  laika=PawanSirsat/Laika, laika-web=PawanSirsat/Laika
restart on the same file            repo and task both survive, 8 migrations, exit 0
```

Migration `0007_projects_repo.sql` is a plain `ALTER TABLE … ADD COLUMN` — no
table rebuild, so no `activity` trigger rescue was needed. I booted the built
server twice against one file to prove the already-applied path is clean rather
than assuming it.

**1. AC3 — validated, and here is exactly where I drew the line.** `owner/name` is
enforced; a URL, an SSH remote, a bare name, three segments and a `.git` suffix are
all `422` with `{ expected: 'owner/name', example: 'PawanSirsat/Laika' }` in the
details, because "invalid format" on a field like this is a puzzle.

**Rejected rather than normalised.** Accepting `https://github.com/owner/name.git`
and rewriting it means deciding which hosts and which URL forms are legitimate —
product nobody asked for.

What I deliberately do *not* check: **trailing punctuation.** `owner/name-` is
accepted. Whether that is a legal repository is the *host's* rule, hosts differ,
and reimplementing GitHub's naming policy for GitLab and Gitea as well would be a
guess dressed as validation. Each segment must *start* alphanumeric, which is what
rejects `./name` and `../owner/name` — the same family of mistake as a URL. My
first draft had a test asserting `owner/name-` was rejected; the regex disagreed
and the regex was right, so the test moved sides with a comment.

**2. AC4 — two projects may share a repo. Decided, and the decision is asserted.**
A monorepo split across a frontend and a backend project is real, and a unique
index would forbid it to buy an unambiguous match. Two tests: one that two projects
really can hold the same value, and one that **no unique index on `repo` exists**,
so a future `uniqueIndex` has to argue with a test rather than quietly forbid the
case. Adding the index via a migration fails both.

The ambiguity moves rather than vanishing, so **LAI-116 is filed** — it lists the
three candidate answers for §9.1 (attribute to all / disambiguate by branch /
refuse and warn), and it also carries the second consequence: `repo` is stored
**as given**, so the eventual comparison must be case-insensitive. §9.2 already
matches branch prefixes that way, so that is precedent rather than a new idea.

**3. Adding the column broke the build, and that was the useful part.**
`routes/projects.ts` had a hand-written copy of the service's `toView` for its
tombstone path, and the copy simply had no `repo`. I exported `projectView` from
the service and deleted the duplicate rather than adding the field twice — the next
column cannot do that again. A test asserts `repo` appears in the *list* response
specifically, which is the path the duplicate was on.

**4. `repo` is a PATCH field only, not a create field.** The task scoped itself to
"the column, the PATCH field, and the decision about uniqueness", so `POST
/projects` does not accept it. Say the word if you want it on create; it is one
line and one test either way.

**5. LAI-051's exemption is gone, and it made me remove it.** `projects.repo` was
one of the two `COLUMNS_NOT_IN_SCHEMA` entries. Adding the column made the
staleness guard fail with

```
projects.repo — exempted as missing, but the schema now has it (or §4 dropped it)
```

which is precisely what that guard is for. One exemption left in that list
(`orgs.presence_enabled`, waiting on LAI-207). Worth noting the two drift checks
did real work on this task rather than just passing: the migration check also
caught my probe that added a unique index to `schema.ts` alone.

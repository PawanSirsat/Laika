---
id: LAI-116
title: Presence attribution must handle a repo tracked by several projects
area: server
assignee: core
priority: p2
depends-on: [LAI-108]
discovered-from: LAI-108
status: done
started: 2026-09-01T15:20:00Z
finished: 2026-09-01T16:05:00Z
---

## Goal

LAI-108 decided `projects.repo` is **not unique**: a monorepo tracked by two
projects — a frontend project and a backend project over one repository — is a
real arrangement, and a unique index would forbid it to buy an unambiguous
heartbeat match.

That decision moves the ambiguity rather than removing it. §4.3 says `repo` "maps
an incoming heartbeat's `repo` (§9.1) to a project", and with duplicates allowed
that mapping is one-to-many. Whoever builds presence has to answer it, and the
answer should be a decision rather than whatever the first `LIMIT 1` happens to
return.

## Acceptance criteria

- [x] `POST /api/v1/heartbeats` (§9.1) resolves a `repo` to **zero, one or many**
      projects, and the behaviour for "many" is stated in code and tested.
- [x] The comparison is **case-insensitive**. LAI-108 stores `repo` exactly as it
      was given, so a project holding `PawanSirsat/Laika` must match a plugin
      reporting `pawansirsat/laika`. §9.2 already matches branch prefixes
      case-insensitively, so this is the established precedent, not a new one.
- [x] A repo that matches no project is not an error — §9.2's rule that unparseable
      input "degrades, it never errors" applies here too.
- [x] Whatever is decided for the many case is written into §11 or §9, because it
      is product behaviour a UI has to render. **CHIEF's — not tickable by CORE.**
      Text handed over on submission; see below.

## Notes / context

Three candidate answers, none obviously right, which is why this is a task and not
a line in LAI-108:

1. **Attribute to every match.** Honest, and the capacity view (§9.3) then counts
   one person as present on two projects — which is arguably true of a monorepo.
2. **Disambiguate by branch.** §9.2 already resolves a task from
   `lai-<number>-<slug>` against project prefixes, so a heartbeat usually carries a
   second signal. Falls back to case 1 or 3 when the branch is unparseable.
3. **Attribute to none and record the ambiguity**, surfacing it as a
   configuration warning. Safest for correctness, worst for the feature.

Option 2 is the most likely right answer and the most work; option 1 is a
defensible first cut. Deciding it needs presence to exist, which is why this is
filed against §9.1 rather than done now.

**Do not resolve this by adding a unique index to `projects.repo`.**
`test/services/projects.repo.test.ts` asserts the absence of one precisely so that
reversal has to argue with a test rather than quietly forbid the monorepo case.
No new dependencies.


---

## Submitted — CORE, 2026-09-01

**Option 2, as the Notes predicted: disambiguate by branch, fall back to every
match.** 19 new tests; suite 1411 green, lint and format clean.

### The rule

`resolveRepoProjects(db, repo, branch)` in `server/src/services/heartbeats.ts`:

1. Fold `repo` — trim and lowercase — and compare against `projects.repo`.
   Nothing matches → `{ [], 'none' }`.
2. One match → that project, `'repo'`.
3. Several → read the branch for §9.2's project prefix. Exactly one of the
   matches carries it → that project, `'branch'`. Otherwise **all** of them,
   `'repo'`.

**Falling back to all, not to none.** Somebody working in a monorepo genuinely
is present on both projects, and attributing to nobody would make presence
silently empty for exactly the arrangement LAI-108 went out of its way to permit.

**§9.2's regex, unanchored, not a stricter one.** Anchoring drops
`feature/lai-42-x`, which is half of real branch names. A resolver stricter than
the convention it implements is a second convention, and when §9.2's task
resolution lands it must call `branchProjectPrefix` rather than parse again —
two parsers would disagree, and the disagreement would read as a heartbeat
attributed to one project and a task resolved from another.

### Two decisions taken against the obvious reading

**Nothing is stored — no `project_id` on `heartbeats`.** §9.3 already says both
derived views are *"computed from `heartbeats` + `tasks` at request time. No
separate presence store to fall out of sync."* A column would be that store, and
it could hold only one id for a result that is legitimately many.

**AC1 says the POST "resolves", and it does — but the `202` keeps its empty
body.** Returning the resolution is a §9.1 response-contract change riding along
inside an ambiguity task, which is the ride-along LAI-091 refused and LAI-099
credits it for. The resolution rides on the internal view and the route logs it:
`heartbeat.repo_unmatched` at **warn**, because a plugin pointed at a repo nobody
tracks otherwise makes presence empty for weeks with no clue why; and
`heartbeat.repo_ambiguous` at **info**, because LAI-108 permits that deliberately
and it is not a fault. If the response should be widened, that is a task and I
will write it.

### Case folding is in JavaScript, not SQLite

`lower()` folds ASCII only; `String.prototype.toLowerCase` is Unicode-aware. A
comparison that disagrees with itself depending on which side ran it only shows
up on somebody else's repo name. A self-hosted board has few projects, so
reading them costs nothing.

### The bigger mismatch this found, filed not fixed — LAI-144

`plugin/hooks/README.md` says the hooks send *"metadata only — git remote"*. A
git remote is a URL; §4.3 stores `owner/name`. **None of
`git@github.com:PawanSirsat/Laika.git`, the `https://` form, or either with
`.git` matches `PawanSirsat/Laika` by any comparison, folded or not** — so on a
correctly configured instance with the plugin sending exactly what it documents,
every heartbeat resolves to no project and §9.3 presence is permanently empty.

That is a different rule about a different failure from the one these criteria
name, so it is **LAI-144** rather than a widening. It matters more than this task
did.

### An existing test earned its keep

`writes §4.10's columns and nothing else` is an exhaustive `toEqual` and went red
the moment the view gained two fields. **Extended, not loosened** — it now also
asserts the stored row's column list, so the row and the resolution stay
distinguishable, which is the property D-005 actually cares about.

Six mutations, all caught: case-sensitivity, no branch narrowing, ambiguity
picking the first silently, an anchored parse, an unmatched repo erroring, and
the route going quiet.

---

## Accepted — CHIEF, 2026-09-01

**Accepted**, with §9.1 and §9.3 written in the merge commit — AC4 was mine and
is now ticked.

I took the text nearly verbatim and **left the log events out, as recommended**:
`heartbeat.repo_unmatched` and `heartbeat.repo_ambiguous` are operational, not
product behaviour a UI renders, and AC4's stated reason for existing was the
latter. Declining to have your own work written into the spec because it does not
belong there is the right instinct.

**Verified by mutation:** removing `.toLowerCase()` goes red on *"matches
case-insensitively, because §4.3 stores what it was given"* and *"carries the
resolution on the recorded heartbeat"*.

### Two decisions made against the obvious answer

**Nothing stored.** §9.3 already promised presence is computed at request time
with *"no separate presence store to fall out of sync"* — a `project_id` column
would have been that store, and could hold only one id for a result that is
legitimately many. Adding it would have contradicted a rule already written.

**The `202` keeps its empty body.** *"A §9.1 response-contract change riding
along inside an ambiguity task — the ride-along LAI-091 refused and LAI-099
credits it for. I am not going to refuse it there and take it here."*
**Consistency with your own past refusal is the strongest form of that
argument**, and it is the second time today you have declined to widen in flight
when widening was convenient for you.

**Case folding in JavaScript rather than SQLite** is right and I would not have
caught it: `lower()` folds ASCII only, `toLowerCase` is Unicode-aware, and a
comparison that disagrees with itself depending on which side ran it only shows
up on somebody else's repo name.

**Using §9.2's own regex rather than a stricter one**: anchoring would drop
`feature/lai-42-x`, and a resolver stricter than the convention it implements is
a second convention.

### The test that earned its keep

`writes §4.10's columns and nothing else` is an exhaustive `toEqual` and went red
the moment the view gained two fields. **Extended, not loosened** — it now also
asserts the stored row's column list, so the row and the resolution stay
distinguishable, which is the property D-005 actually cares about. *"That test
was written to be annoying and it was annoying at the right moment."*

### But LAI-144 matters more than this task did, and they said so

`plugin/hooks/README.md` documents sending a **git remote**. A remote is a URL;
§4.3 stores `owner/name`. None of the three real forms matches by any comparison,
folded or not — so **on a correctly configured instance with the plugin sending
exactly what it documents, every heartbeat resolves to nothing and §9.3 presence
is permanently empty.** LAI-116's case-insensitivity does nothing about it,
because case was never the problem.

Filing it rather than fixing it was right: it is a different rule about a
different failure from the one these criteria name. **Sequenced ahead of the p2
list** — it makes M4's exit criterion unreachable, and M4's exit is *"a heartbeat
from that agent is visible in the database"* attributed to something.

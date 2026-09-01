---
id: LAI-430
title: 'A heartbeat''s branch resolves to a task (§9.2)'
area: server
assignee: core
priority: p2
depends-on: [LAI-417, LAI-144]
discovered-from:
status: done
started: 2026-09-02T00:00:00Z
finished: 2026-09-02T00:35:00Z
---

## Goal

§9.2: the convention is **`lai-<number>-<slug>`**, the server matches
`[a-z]+-(\d+)` case-insensitively against project prefixes, resolves the task,
and stores **`matched_task_id` on the heartbeat** and **`branch` on the task**.

`branchProjectPrefix` already exists — LAI-116 uses it to narrow a repo that
matches several projects. **It extracts the prefix and stops.** Nothing resolves
the number to a task, nothing writes either column, and `heartbeats.matched_task_id`
is nullable and always null.

## Acceptance criteria

- [x] A heartbeat whose branch is `lai-42-add-crud`, on a repo resolving to the
      project with prefix `LAI`, stores that task's id in `matched_task_id`.
- [x] The task's `branch` column is updated to the branch string.
- [x] **Case-insensitive**, per §9.2, and matching `LAI-42-x`, `lai-42-x` and
      `Lai-42-X` alike. Reuse `branchProjectPrefix`'s pattern rather than writing
      a second one — LAI-144's lesson is that two implementations of one rule is
      one implementation and one bug.
- [x] **Everything unresolvable degrades and never errors** (§9.2): no prefix
      match, a number no task has, a prefix belonging to a project the repo does
      not resolve to, a branch that is not the convention at all. Each is a
      separate test and each leaves `matched_task_id` null.
- [x] **A repo resolving to several projects is decided before the number is.**
      §9.1 says an ambiguous repo narrowed by branch prefix picks one project;
      a branch that names a prefix **no** matching project has resolves to
      nothing rather than to a same-numbered task in a different project.
      **That is the one that corrupts data if it is wrong** — `LAI-42` and
      `WEB-42` are different tasks.
- [x] A test that the resolution is **not** attempted when the org has
      `presence_enabled = 0`, once that column exists (LAI-207). If it does not
      exist yet, say so in the task rather than adding it here.

## Notes / context

**Do not store the resolution on anything else.** §9.3 is explicit that presence
and capacity attribute at request time and *"nothing is stored on the heartbeat"*
— `matched_task_id` is the exception §9.2 names, and it is the only one.

`tasks.branch` is a **last-seen**, not a history. Overwriting is correct; the
history is `activity`.

**Retention (§11.6) is LAI-431**, not this task.


---

## Submitted — CORE, 2026-09-02

**Fully green: 1528 server, 562 web, lint and format clean.** No red to quote —
the first task in a while that needed none.

### One parser, two readers

`parseBranchRef` returns prefix **and** number; `branchProjectPrefix` delegates
to it. §9.2's comment asked for exactly this and LAI-144's lesson is why.

### AC5 is the one that mattered, and it is tested from three sides

`LAI-42` and `WEB-42` are different tasks. Dropping the project filter from the
lookup turns `does not resolve LAI-42 to WEB-42` red — a test that seeds the
**same task number in two projects sharing one repo**, which is the only shape
where the bug shows.

Two more around it: an ambiguous repo the branch does not narrow resolves to
nothing rather than to whichever project sorts first; and a repo with a single
project still has its prefix checked, because `resolveRepoProjects` returns an
unambiguous repo *without consulting the branch* — so `web-1-x` on a repo tracked
only by `LAI` arrives with a project that does not own that prefix.

### Presence off, and the half I did not do

With `presence_enabled = 0` the branch is **not** resolved: no `matched_task_id`,
no `tasks.branch`. That is the record §4.2's switch exists to prevent (D-005).

**The row is still written**, and §4.2 also says a disabled instance "accepts and
discards". Not doing that here is deliberate: it changes what the endpoint
*does* rather than what it *resolves*, it touches §9.3's disabled state (LAI-432),
and it would make this task's own tests ambiguous — "the row lands anyway" is
right for a **degraded branch** and wrong for a **disabled org**, and collapsing
those two rules is how one of them quietly stops being tested. Filed as
**LAI-150**, with that distinction as an explicit criterion.

### Two guards I am telling you are untested, because they are untestable

`projectIds.length !== 1` and the safe-integer bound both **survive mutation**.
Removing either changes no observable behaviour: the prefix check catches the
first (an unnarrowed repo means the prefix matched neither project, which
`projects_org_prefix_unique` guarantees), and the task lookup catches the second
(`1e20` equals no `tasks.number`).

They stay, because each states the rule at the point it applies rather than
leaving it to be inferred three lines later — and the `length` one stops being
redundant the day that unique index goes. **But the comments now say they are
defence in depth and not checked properties.** A comment implying coverage that
does not exist is exactly LAI-427, and I would rather report two equivalent
mutations than quietly count six.

### A distinction my own test got wrong first

I listed `''` among the branches that "degrade to null". It does not — it is a
`422` (LAI-417). §9.2's *"degrades, it never errors"* is about a branch that does
not follow the convention; a branch that is **not there** is a malformed request,
and conflating them would turn a client bug into a silent no-op. Both are now
pinned, separately.

Six mutations: four caught, two shown equivalent and documented.

---

## Accepted — CHIEF, 2026-09-01

**Accepted, and merged alone** — `core` also carries LAI-431, which needs a
`docs/` half and a web mirror, so this landed as its own commit rather than
waiting behind it. **1528 server, 583 web, format clean. No red to quote, which
is the first time in a while.**

**Verified by mutation, both of the ones that matter:**

| Mutation | Red |
| --- | --- |
| Drop *"the prefix has to belong to **this** project"* | `a prefix no project holds` **and** `refuses a prefix the single matching project does not hold` |
| Resolve regardless of `presence_enabled` | `does not resolve when the org has presence_enabled = 0` |

The first is the one the task called *"the one that corrupts data if it is
wrong"* — `LAI-42` and `WEB-42` are different tasks — and it is caught from two
directions.

### Reporting two guards as equivalent rather than counting them

> *"`projectIds.length !== 1` and the safe-integer bound both change **no
> observable behaviour** when removed. **I kept both**, because each states the
> rule at the point it applies rather than leaving it inferred three lines
> later… **But the comments now say defence in depth, not checked property.**"*

**That is LAI-427's defect pointed at yourself before I found it**, and the
handling is right in both halves: the code keeps the guards, and the comments
stop claiming coverage that does not exist. *"Six mutations run — four caught,
two shown equivalent"* is the honest report, where *"six mutations, all caught"*
would have been true of the sentence and false of the work.

The `length !== 1` one also stops being redundant the day
`projects_org_prefix_unique` goes, which the comment now says.

### Not implementing §4.2's "discards" was right

*"The row lands anyway"* is correct for a **degraded branch** and wrong for a
**disabled org**, and several of this task's tests assert exactly the first.
**Collapsing the two rules is how one of them quietly stops being tested** — and
that is the whole argument.

**LAI-150** carries it with the distinction as an explicit criterion, plus the
consequence: once no rows are stored, §9.3's views can only tell *"disabled"*
from *"nobody is working"* by reading the column. **Better known now than
discovered in LAI-432**, which is where it would have surfaced.

### Two smaller ones, both self-caught

**`''` is a `422`, not a degrade.** §9.2's rule is about a branch that does not
*follow* the convention, not one that is *absent* — conflating them would turn a
client bug into a silent no-op. Pinned separately now.

**A task id invented in CHIEF's range.** `LAI-436` in a code comment, caught
before committing, filed as `LAI-150`. Worth the note for the reason given:
**nothing checks comment references against the task tree**, so a wrong id in a
comment is a permanent reference to something that will never exist. (`LAI-436`
now exists, as the timeline follow-up — which is the coincidence that makes the
point rather than undoing it.)

---
id: LAI-438
title: Presence names every repo a person opens, not only the org's
area: server
assignee: core
priority: p2
depends-on: [LAI-432]
discovered-from: LAI-432
status: done
started: 2026-09-02T04:05:00Z
finished: 2026-09-02T04:35:00Z
---

## Goal

`PresenceEntry` carries `repo` and `branch` **unconditionally**, including for a
heartbeat that attributes to **no project**. §9.3 says presence shows *"repo,
branch, and resolved task"*, so the implementation is correct as specified.

**The specification is what needs changing, because D-046 changed what it
means.**

## Why this is new rather than an oversight

`LAIKA_URL` and `LAIKA_TOKEN` live in **`~/.claude/settings.json`** — *user*
settings, not per-repository (D-046, and it is the right place: it is the only
"never committed" a later `git add -f` cannot undo).

**So the heartbeat hook fires in every repository that person opens.** Not the
org's repositories — **every** repository. A member who opens an unrelated
private repo in Claude Code broadcasts its name and current branch to every other
member of the org, in a view none of them can turn off individually.

**Consent to be seen working on the org's projects is not consent to publish the
name of everything else you open.** D-005 says a heartbeat is *"your own record
about your work"*; §4.2's org switch is all-or-nothing and belongs to the owner,
not to the person being recorded.

Neither D-005 nor D-046 is wrong. **The interaction is new**, and it only exists
because both landed today.

## The change

**An entry that attributes to no project the reader can see says *somebody is
working*, and does not say where.** `repo` and `branch` are omitted; `user_id`,
`name`, `last_seen` and `is_agent` stay. Presence keeps answering *"who is
working right now"*, which is what it is for.

## Acceptance criteria

- [x] A heartbeat whose repo resolves to **no** project omits `repo` and
      `branch` for every reader.
- [x] A heartbeat resolving to a project the reader **cannot** read is treated
      the same way — the existing project filter and this rule must not disagree,
      and a repo tracked by a project you cannot see is exactly as private as one
      tracked by nothing.
- [x] They are **absent, not empty strings**. `repo: ''` is a different claim and
      a client would render it. Same rule as `unlisted` and the org's `ai` block.
- [x] The reader who **can** see an attributing project still gets `repo` and
      `branch` — this must not become "nobody ever sees a repo", which would make
      the Capacity screen useless.
- [x] A test from **both** readers over **one** heartbeat: a member of the
      matching project sees the repo, a non-member sees the person without it.
      One heartbeat, two readers, or the test passes against an implementation
      that hides the repo from everybody.
- [x] §9.3's *"with repo, branch, and resolved task"* is corrected. **`docs/` is  **CHIEF's; no drift test asserts that sentence, so no red to quote.**
      CHIEF's** — the half is written at merge; quote the drift failure and
      submit red if one fires (D-045).

## Notes / context

**Do not solve this in the plugin.** A hook cannot know which repositories the
deployment tracks — that is §9.2's stated reason for server-side resolution, and
it is the same argument as D-043's.

**An individual opt-out is a bigger change and is not this task.** A per-user
`presence_enabled` is a column, a setting screen and a §3.1 row; file it if you
think it is wanted. This one closes the leak without asking anybody to configure
anything, which is the property worth having first.


---

## Submitted — CORE, 2026-09-02

**Fully green: 1618 server, 585 web, lint and format clean.**

### The mutation that survived is the finding

`matched_task_id` leaked even when `repo` did not — and **every test passed**.
None of the fixtures had a heartbeat that actually *resolved*, so the field was
always `null` and withholding it was untested in the only case where it matters.

**A task id names the work as surely as a repo names the place.** All four of
`repo`, `branch`, `project_ids` and `matched_task_id` now follow one gate, and
there is a test with a real resolved heartbeat and two readers.

That is the fourth instance today of a test that names the right property and
cannot fail for it — and the first where the missing piece was **fixture state**
rather than fixture data. The earlier three were a filename, a boolean and a
sort order; this one was "the field under test was never populated".

### One heartbeat, two readers

Built exactly as the criterion asks. Mutating to **never** return the repo —
which closes the leak and makes Capacity useless — is caught, and would have
passed against either reader alone.

### This changed LAI-432 deliberately

`hides a heartbeat attributed only to a project the reader is not in` is now
`hides where, not who`. I wrote the original a task ago, against §9.3's sentence,
and it was right against a spec that predates D-046. The reason for the change is
at the site rather than only here, since the next reader will meet the test
before the task file.

### On my LAI-432 reasoning

I argued an unattributed heartbeat was safe because *"it names no project, so
there is nothing to leak"* — and returned `repo` three lines later. D-046 is why
it matters and I could not have known it, but **the claim was false against the
return statement regardless**: a repo name is a thing, and a private one is a
private thing. The check on "is this safe to return" is the shape of the
response, not the shape of the argument.

Five mutations, all caught after the task-id one was covered; four before.

---

## Accepted — CHIEF, 2026-09-01

**Accepted**, with §9.3 corrected in the landing. Taking it ahead of LAI-435 was
right and needed no confirmation: a privacy leak affecting every member of every
instance outranks a backfill that makes one screen prettier.

### The mutation that survived is the finding

> *"`matched_task_id` leaked even when `repo` did not, and every test passed.
> None of my fixtures had a heartbeat that actually **resolved** — every one had
> `matched_task_id: null` — so withholding it was untested in the only case where
> it could matter."*

**A task id names the work as surely as a repo names the place**, and all four
fields now follow one gate, tested with a real resolved heartbeat and two
readers.

**Fourth instance today of one shape, and the first of a new kind.** The other
three were fixture **data** — a filename sorting the wrong way, a boolean
asserted in one direction, a suffix with no near miss. **This was fixture
state**: the field under test was never populated, so the assertion about it was
vacuous. Your fourth bullet is in `CONVENTIONS.md` §4 verbatim, and the
data/state distinction with it, because it is what makes the bullet
recognisable rather than obvious.

### Your correction to your own reasoning is better than mine was

> *"D-046 is why it matters and I could not have known it. **The claim was false
> against the return statement regardless.** A repo name is a thing; a private one
> is a private thing. Had the hook been per-repository the leak would have been
> smaller, not absent."*

I gave you the interaction and stopped there. **You found the error underneath
it**, and it is the same one as borrowing `member_list.read`: *a claim about what
an endpoint reveals, argued from one field with another sitting beside it.*
**The check is the shape of the response, not the shape of the argument.**

### The observation I am not going to file a task for, because I do not have one either

> *"Twice today a decision changed what an older one meant — D-046 against §9.3,
> LAI-126 against D-040. Both times the newer decision was in a different area
> from the thing it changed, and nothing connects them."*

**Both times it was caught by a person looking at the result**, not by any guard:
the owner put two screens side by side, and you returned a field three lines
under a claim it contradicted. I have no mechanism to propose either, and I would
rather record that than invent one. It is in `CONVENTIONS.md` §5.1's
neighbourhood as the axis with no guard.

### And the sentence with nothing behind it

> *"§9.3's 'with repo, branch, and resolved task' needs your correction, and
> **nothing in the suite asserts that sentence** — so there is no red to quote.
> That is worth noting on its own: a spec sentence with no guard behind it is
> exactly where this drifted."*

That is the same diagnosis as §4.8's D-022 note justifying rows the type list
forbade, one section over. **Prose that describes a response, with no test
comparing it to the response, is where the spec goes stale silently** — and
unlike a column or a verb, there is no list to diff it against.

**Rename kept:** `hides where, not who` is a better name than the one it replaced
and says the rule at the place a reader meets first.

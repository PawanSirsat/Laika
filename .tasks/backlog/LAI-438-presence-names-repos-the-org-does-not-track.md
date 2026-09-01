---
id: LAI-438
title: Presence names every repo a person opens, not only the org's
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-432]
discovered-from: LAI-432
status: backlog
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

- [ ] A heartbeat whose repo resolves to **no** project omits `repo` and
      `branch` for every reader.
- [ ] A heartbeat resolving to a project the reader **cannot** read is treated
      the same way — the existing project filter and this rule must not disagree,
      and a repo tracked by a project you cannot see is exactly as private as one
      tracked by nothing.
- [ ] They are **absent, not empty strings**. `repo: ''` is a different claim and
      a client would render it. Same rule as `unlisted` and the org's `ai` block.
- [ ] The reader who **can** see an attributing project still gets `repo` and
      `branch` — this must not become "nobody ever sees a repo", which would make
      the Capacity screen useless.
- [ ] A test from **both** readers over **one** heartbeat: a member of the
      matching project sees the repo, a non-member sees the person without it.
      One heartbeat, two readers, or the test passes against an implementation
      that hides the repo from everybody.
- [ ] §9.3's *"with repo, branch, and resolved task"* is corrected. **`docs/` is
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

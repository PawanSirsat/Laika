---
id: LAI-432
title: 'GET /presence and GET /capacity (§9.3)'
area: server
assignee: core
priority: p2
depends-on: [LAI-430]
discovered-from:
status: done
started: 2026-09-02T02:40:00Z
finished: 2026-09-02T03:20:00Z
---

## Goal

§9.3's two derived views. Both are **computed at request time from `heartbeats`
+ `tasks`** — *"no separate presence store to fall out of sync"*, and LAI-116
already refused to store the repo→project resolution for the same reason.

- **`GET /api/v1/presence`** — users with a heartbeat in the **last 5 minutes**,
  with repo, branch, and resolved task.
- **`GET /api/v1/capacity`** — per user: `active_sessions`, `in_progress_tasks[]`,
  `last_seen`, oldest in-progress age, tasks in review awaiting them, and
  `unlisted[]` from `log_unlisted_work`.

## Acceptance criteria

- [x] Both call `can()`. Both are **reads** and belong in `READ_ACTIONS`.
- [x] **A heartbeat attributes to a project by §9.1's rule, at request time**,
      including the one-to-many case: a person in a monorepo tracked by two
      projects is present on **both**. Nothing is stored.
- [x] The 5-minute window is **tested at its edges** with an injected clock —
      4m59s present, 5m01s absent. A window test written against the real clock
      is a flake waiting for a slow CI box.
- [x] **Neither endpoint leaks a project the caller cannot read.** A viewer with
      no membership on project X sees no presence or capacity row attributed to
      X, even for a user they can otherwise see. Test it from the *reader's*
      authority, the way `resolveMentions` does.
- [x] `presence_enabled = 0` produces a **disabled state, not an empty one**
      (§4.2) — the two are different to a client and §11.4.2 renders them
      differently. Needs LAI-207; if that has not landed, say so and leave the
      branch red with the failure quoted (D-045) rather than inventing a column.
- [x] Agent sessions are **distinguishable from humans** — §11.4.2 requires the
      Capacity screen to show them apart, and the data for it is `actor_kind` /
      the heartbeat's token. The endpoint carries it; the screen is not this task.
- [x] N+1 is not acceptable here. `creatingClientNames` and `commentCounts` are
      the existing batched-lookup patterns; follow them.

## Notes / context

**`GET /capacity` is what `/laika:status` wanted and did not have** (LAI-420).
When this lands, that command can stop hedging.

**Not this task:** the Capacity screen, the Board's "WORKING NOW" strip, and the
agent-sessions rail card. All `server/web/`, all waiting on this.


---

## Submitted — CORE, 2026-09-02

**Fully green: 1605 server, 585 web, lint and format clean.** No red to quote.

### Disabled is a field, and both directions are asserted

`enabled: false` with rows present **and** `enabled: true` on an empty board. The
second is the one that matters: asserting only the first would pass against a
hard-coded `false`.

LAI-150's corollary is why it is a field at all — once a disabled org stores no
rows, an empty list is the **only** thing left, so a client inferring would be
permanently wrong and silently so.

### The leak test is from the reader's authority

A heartbeat attributing to several projects is visible to anyone who can read
**one** of them; one attributing to **none** is visible to everyone, because it
names no project and says only that somebody is working — which the member list
already gives away. Said out loud because it is the one case where the filter
deliberately does not bite, and a reader would otherwise read it as a hole.

Capacity's task lists are filtered the same way, separately — a reader who cannot
see the project sees the person with an empty list rather than not at all, since
the **person** is not the secret.

### `unlisted` is absent, not empty

Gated on `audit_log.export`, which is exactly what `listUnlisted` already costs —
so capacity cannot become a way around §3.1's "Export audit log" row. Absent
rather than empty for the `ai`-block reason: `[]` would say "this person has
logged nothing", which is a different fact.

### Two new actions, not a borrow

`presence.read` and `capacity.read`, both in `READ_ACTIONS`. LAI-222's lesson:
borrowing a row is a claim about today's payload, and these responses will grow.
A `read_only` token can read both, which is what such a token is for.

### The window, at its edges

4m59s present, 5m01s absent, and **exactly five minutes absent** — `gt`, not
`gte`. Injected clock, per the criterion; the same shape as LAI-431's jobs.

### Two of mine

**The agent test only asserted the human case at first.** `is_agent: false` for a
cookie heartbeat passes against an implementation that never reports an agent at
all — which is the requirement §11.4.2 actually has. Both halves now, with a real
`tokens` row because `heartbeats.token_id` is a foreign key.

**`pnpm test`'s typecheck caught what `vitest` did not.** A helper's
`name = orgRole` default made TypeScript infer the parameter as `OrgRole`, so
every call passing a real name was an error the test run ignored entirely. Third
or fourth time the LAI-136 composite has earned itself.

Seven mutations, all caught.

---

## Accepted — CHIEF, 2026-09-01

**Accepted.** M5's server side is complete: LAI-430, LAI-431, LAI-432.

**Verified by mutation:**

| Mutation | Red |
| --- | --- |
| Remove the disabled short-circuit | `answers enabled:false rather than an empty list` + its serialisation twin |
| Capacity's flag hard-coded `true` | `capacity says so too, and still lists people` + twin |
| `is_agent` always `false` | `marks a heartbeat on a token as an agent and a cookie as not` |

**My first attempt at the first one was a no-op** — the regex matched the literal
`enabled: false` in the disabled branch and replaced it with itself. **Fourth
no-op mutation of the day**, third across the two of you and now one of mine. The
printed anchor is the only reason I noticed; the suite came back green and would
have read as *"the guard does not catch it"*.

### `enabled` as a field, asserted both ways

*"`enabled: false` with rows present, **and** `enabled: true` on an empty
board — the second is the one that matters, because asserting only the first
passes against a hard-coded `false`."*

That is the same check you named this hour and applied to yourself before I got
here: **when a test asserts a boolean, assert both values.** It is now three
instances of one shape in one day —`.github.io`, the backup filenames, the agent
case — and stating it as a mechanical check rather than a lesson is the right
move: *when it asserts a filter, include something the filter must exclude.*

### The window at `gt` versus `gte`

4m59s present, 5m01s absent, **and exactly five minutes** — the case a real-clock
test would never hit and the only one that distinguishes the two operators.

### Two grades in one response, twice now

`unlisted` **absent rather than empty** for a caller without `audit_log.export`,
for the same reason `ai` is absent on the org: an empty array says *"this person
has logged nothing"*, which is a different fact and one a Member would act on.
Second application of a rule you established four hours ago, unprompted.

**Capacity keeping the person while filtering their tasks** is the right call and
the reason is the general one: *the person is not the secret, and dropping them
would make the headcount depend on who is asking.*

### On the unattributed heartbeat — you were right to flag it, and I am changing it

You said an unattributed heartbeat is visible to everyone because *"it names no
project, so there is nothing to leak"*. **It names a `repo`**, and that is where
it turns, for a reason you could not have seen from here:

**D-046 puts `LAIKA_URL` and `LAIKA_TOKEN` in `~/.claude/settings.json` — user
settings, not per-repository.** So the hook fires in **every** repository that
person opens, including ones the org has nothing to do with. Consent to be seen
working on the org's projects is not consent to broadcast the name of every
private repository you open in an editor.

**Filed as LAI-438**, and §9.3 will say it: an entry that attributes to no
project the reader can see says *somebody is working* without naming where.
**Not a defect in this task** — §9.3 as written says presence shows the repo, and
you built §9.3. The interaction with D-046 is new, and it is the second time
today a decision made for one reason has changed what another one means.

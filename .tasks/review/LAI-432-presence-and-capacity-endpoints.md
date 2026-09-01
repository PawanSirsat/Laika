---
id: LAI-432
title: 'GET /presence and GET /capacity (§9.3)'
area: server
assignee: core
priority: p2
depends-on: [LAI-430]
discovered-from:
status: review
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

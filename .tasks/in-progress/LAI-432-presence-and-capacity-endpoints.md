---
id: LAI-432
title: 'GET /presence and GET /capacity (§9.3)'
area: server
assignee: core
priority: p2
depends-on: [LAI-430]
discovered-from:
status: in-progress
started: 2026-09-02T02:40:00Z
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

- [ ] Both call `can()`. Both are **reads** and belong in `READ_ACTIONS`.
- [ ] **A heartbeat attributes to a project by §9.1's rule, at request time**,
      including the one-to-many case: a person in a monorepo tracked by two
      projects is present on **both**. Nothing is stored.
- [ ] The 5-minute window is **tested at its edges** with an injected clock —
      4m59s present, 5m01s absent. A window test written against the real clock
      is a flake waiting for a slow CI box.
- [ ] **Neither endpoint leaks a project the caller cannot read.** A viewer with
      no membership on project X sees no presence or capacity row attributed to
      X, even for a user they can otherwise see. Test it from the *reader's*
      authority, the way `resolveMentions` does.
- [ ] `presence_enabled = 0` produces a **disabled state, not an empty one**
      (§4.2) — the two are different to a client and §11.4.2 renders them
      differently. Needs LAI-207; if that has not landed, say so and leave the
      branch red with the failure quoted (D-045) rather than inventing a column.
- [ ] Agent sessions are **distinguishable from humans** — §11.4.2 requires the
      Capacity screen to show them apart, and the data for it is `actor_kind` /
      the heartbeat's token. The endpoint carries it; the screen is not this task.
- [ ] N+1 is not acceptable here. `creatingClientNames` and `commentCounts` are
      the existing batched-lookup patterns; follow them.

## Notes / context

**`GET /capacity` is what `/laika:status` wanted and did not have** (LAI-420).
When this lands, that command can stop hedging.

**Not this task:** the Capacity screen, the Board's "WORKING NOW" strip, and the
agent-sessions rail card. All `server/web/`, all waiting on this.

---
id: LAI-974
title: 'The Work page cannot say how many tasks match or how they split: GET /tasks has no counts'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-887]
discovered-from:
status: backlog
---

## Goal

The owner (2026-10-22, screenshot of /work): *"as the owner … see all, filter
over everyone, then see some analytics on top … add pagination with good UX
that shows the counts."* Server half: counts for exactly the set `GET
/api/v1/tasks` would page through.

## Acceptance criteria

- [ ] `GET /api/v1/tasks/summary` takes the same filters as `GET /tasks`
      (`project`, `status`, `assignee` id|none, `sprint` id|none,
      `updated_since`; unknown keys `422` as `/tasks` does) and answers
      `{ total, by_status: { backlog, todo, in_progress, review, done,
      cancelled }, by_assignee: [{ user_id | null, name, count }] (top 10 by
      count, then 'others'), overdue, blocked, unassigned }` — counted over
      the same readable-project set and token scope as `/tasks`, one query
      per figure at most, Drizzle only. Builder documents "overdue" (due date
      past, not done/cancelled) and "blocked" (open dependency) from the
      existing definitions in the code, citing them.
- [ ] `can()` per project exactly as `/tasks`; a member's counts exclude
      private projects they cannot read (test by count AND by a key that
      must not contribute); a project-whitelisted token likewise.
- [ ] The figures agree with walking `/tasks` to the end for the same
      filters (test with ≥ 3 pages).
- [ ] **Named cross-area edit (D-033):** one SPEC §6.4 endpoint line.
- [ ] Gate; the web endpoint-coverage failure for `api/v1/tasks/summary` is
      LAI-975's half (§4.4) — quote it.

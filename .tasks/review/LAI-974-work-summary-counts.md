---
id: LAI-974
title: 'The Work page cannot say how many tasks match or how they split: GET /tasks has no counts'
area: server
assignee: core
priority: p1
depends-on: [LAI-887]
discovered-from:
started: 2026-10-22T16:37:03Z
status: review
finished: 2026-10-22T16:55:26Z
---

## Goal

The owner (2026-10-22, screenshot of /work): *"as the owner … see all, filter
over everyone, then see some analytics on top … add pagination with good UX
that shows the counts."* Server half: counts for exactly the set `GET
/api/v1/tasks` would page through.

## Acceptance criteria

- [x] `GET /api/v1/tasks/summary` takes the same filters as `GET /tasks`
      (`project`, `status`, `assignee` id|none, `sprint` id|none,
      `updated_since`; unknown keys `422` as `/tasks` does) and answers
      `{ total, by_status: { backlog, todo, in_progress, review, done,
      cancelled }, by_assignee: [{ user_id | null, name, count }] (top 10 by
      count, then 'others'), overdue, blocked, unassigned }` — counted over
      the same readable-project set and token scope as `/tasks`, one query
      per figure at most, Drizzle only. Builder documents "overdue" (due date
      past, not done/cancelled) and "blocked" (open dependency) from the
      existing definitions in the code, citing them.
- [x] `can()` per project exactly as `/tasks`; a member's counts exclude
      private projects they cannot read (test by count AND by a key that
      must not contribute); a project-whitelisted token likewise.
- [x] The figures agree with walking `/tasks` to the end for the same
      filters (test with ≥ 3 pages).
- [x] **Named cross-area edit (D-033):** one SPEC §6.4 endpoint line.
- [x] Gate; the web endpoint-coverage failure for `api/v1/tasks/summary` is
      LAI-975's half (§4.4) — quote it.

## Builder notes (CORE, 2026-10-22)

**Shape, as served** (`server/src/services/tasks.ts`, `TaskCountsView`):

```
{ total, by_status: { backlog, todo, in_progress, review, done, cancelled },
  by_assignee: [{ user_id, name, count }], overdue, blocked, unassigned }
```

- `by_assignee` is ranked by count, then name, then id. `user_id: null`
  (name `Unassigned`) is unassigned work and ranks with the people. Only when
  more than ten groups exist, one last entry `{ user_id: 'others', name:
  'Others', count }` holds the rest — the sentinel is a string, like
  `assignee=none`, so it cannot be mistaken for the null row. Counts always sum
  to `total`. Empty set → `by_assignee: []`, every number 0.
- Filters: `project`, `status`, `assignee` (id | `none`), `sprint` (id |
  `none`), `updated_since`; an empty value is absent, as on `/tasks`. **Paging
  keys (`limit`, `cursor`, `fields`) are refused `422`** — they are not
  filters. `?status=nonsense` is `400 bad_request`; `?project=` is `404` /
  `403` exactly as on `/tasks`.

**Definitions, from the code they copy:**

- **overdue** — open (`backlog`, `todo`, `in_progress`, `review`) with `due_on`
  before today's UTC midnight (`boardDayOf`): `countTask` in
  `server/src/services/presence.ts`.
- **blocked** — open with at least one dependency whose status is not `done`
  (a cancelled blocker still blocks, as `isReady` requires `done`):
  `projectSummaries` in `server/src/services/projects.ts`. Counted with
  `EXISTS`, so a task blocked twice is one.

**One scope for list and summary.** `listAllTasks`' readable-project choice
(`canSeeProject` per project, or `assertCan('project.read')` for `?project=`)
and the shared filters moved into `allTasksScope`, which both call. Four count
queries (status, assignee, overdue, blocked).

**Tests** — `server/test/http/routes/tasks.test.ts`, describe *"GET
/api/v1/tasks/summary … (LAI-974)"*, 9 cases: the seeded figures, agreement
with a full `/tasks` walk at `limit=2` (≥ 3 pages) for twelve filter
combinations, private-project exclusion for a member by count and by key,
`403`/`404` on `?project=`, a project-whitelisted token by count and key, the
top-ten + `others` fold, `400`/`422` codes, empty values, `401`.

Mutations, each confirmed applied by grep before the run: overdue ignoring
open → 2 red; blocked treating `cancelled` as done → 2 red; scope ignoring
`canSeeProject` → 2 red (member, token).

**Gate** — `pnpm test` exit **1**, only:

```
server/web test:     not ok 1 - no endpoint is served, uncalled and unexplained
        served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not
        +   'api/v1/tasks/summary'
```

which is LAI-975's half (§4.4). Server `Tests 3635 passed | 10 skipped`,
web `# fail 1`, cli `# fail 0`. `pnpm lint` 0, `pnpm format` 0.

**Self-expiring exemption:** `TaskCountsView` is in `UNPAIRED`
(`server/test/tooling/response-type-coverage.test.ts`) as *no client type
exists*; LAI-975's client mirror retires it, and the staleness guard there
fires when it does.

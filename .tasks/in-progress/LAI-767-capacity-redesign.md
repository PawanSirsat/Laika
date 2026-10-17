---
id: LAI-767
title: 'Capacity, redesigned: search, online status, last seen, workload and load per person (server/ + server/web/ + docs/)'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from:
started: 2026-10-17T09:35:20Z
status: in-progress
---

## Goal

The owner finds the global Capacity page (`/capacity`, LAI-754) not
informative: no search, no clear online state, no last seen, and rows of task
chips that are noise. When this is finished the page answers *who is online,
who is overloaded and who can take the next task* at a glance — a search and
filters on top, summary tiles, one card per person with a status ring, last
seen, their agents, their workload and a load badge, and a team-load chart
under the grid — and `GET /api/v1/capacity` serves everything it draws in one
pass, with the admin-only fields withheld from everyone else by the server.

Board card: **LAIKA-572**. Filed on the owner's direct instruction (through
the orchestrator); the id was reserved for it.

## Acceptance criteria

- [ ] `GET /api/v1/capacity` adds, per person and without an N+1:
      `email`, `org_role`, `status` (`online` / `away` / `offline` / `never`,
      `null` while presence is off), `last_seen` as the newest of every
      signal, `last_seen_via`, `workload` (in progress, in review, to do,
      overdue, due within 7 days, open), `load` (`none` / `light` / `normal` /
      `heavy`, a fixed rule), `spaces` (open work per readable space), and
      `agents` (running now for everyone; every agent on a usable token for
      owners and admins). Every existing field keeps its meaning except
      `last_seen`, which SPEC §9.3 redefines. `/api/v1/presence` is unchanged.
- [ ] `profile_kind` and `activity_14d` (a 14-day board-activity series from
      `board_activity_days`) are present only for a caller who passes
      `profile.read` / `profile.activity.read` — absent, not empty, for a
      member and for any token.
- [ ] With presence off, no status, last seen or running agent is served; the
      page says *Presence is off* and still shows workload.
- [ ] The page: a search by name or email; filter chips (All, Online now,
      Agents running, Heavy load, Overdue, No work, Never seen); a space
      selector; a sort (Online first, Heaviest load, Name, Last seen); summary
      tiles that apply their filter or link to `/review` and `/unlisted`;
      cards in a 3/2/1-column grid with a status ring and dot and a text line
      (status is never colour alone), agents with a running dot, workload
      counts, a stacked bar and a load badge, space chips, an admin-only
      14-day sparkline and profile link, and a collapsed *Show tasks* that
      opens each task in its own space (LAI-755); a *Team load* chart and
      *Agents running now*; never-seen people folded into one line.
- [ ] Live: polls every 20 s, re-reads when the tab returns, a loading
      skeleton in the final layout, an empty state for no matches, an error
      state. Both themes; nothing scrolls sideways at 390 px.
- [ ] Server tests for last seen, the status thresholds, workload counts, the
      load rule and the admin-only fields refused to a member; browser tests
      for search, each filter, sort, the online dot, the never-seen fold and
      member against admin. Each new test fails without its code (proved
      once). A fixture shaped like the org: 5 people, 3 never seen, an owner
      with 7 in progress and 2 agents running.
- [ ] SPEC §9.3 and the Capacity screen entry (§11.4.2.1) say what the page
      and the endpoint now do, including the definition of *last seen* and
      the load rule.
- [ ] `pnpm test`, `pnpm lint` and `pnpm format` each exit 0 after the last
      edit.

## Notes / context

- Out of scope: security/HTTPS, the Review page, the GitHub webhook and org
  settings (another builder is on `build-github-confirm`). LAI-728 (task keys
  beside ids) stays its own task: the page resolves keys only for the tasks it
  draws, which is now only an opened *Show tasks* and a matched session task.
- `server/web/test/browser/capacity.test.ts` is also being changed on
  `fix-capacity-flake`; this task rewrites it for the new page, so the merge
  needs a hand.
- No new dependencies.

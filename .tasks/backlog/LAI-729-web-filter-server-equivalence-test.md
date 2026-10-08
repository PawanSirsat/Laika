---
id: LAI-729
title: 'One fixture, two filters: the board’s in-memory filter answers what listTasks answers'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-724]
discovered-from: LAI-724
status: backlog
---

## Goal

Since LAI-724 the board no longer sends its filter to the server: it holds the
project's whole task set and applies `server/web/src/api/task-filter.ts` in
memory. That function is meant to mean exactly what `listTasks`'s `WHERE` means
(`server/src/services/tasks.ts`), and `task-filter.test.ts` pins each clause
against hand-written expectations. **Nothing yet runs the two over the same
data**, so a change to either side can make them disagree with both test
suites green. The LAI-724 review found two places they already differed in
behaviour (an invalid value, the page cap); both are handled, and this is the
guard for the next one.

## Acceptance criteria

- [ ] One fixture of tasks (statuses, priorities, assignees including none,
      sprints including none, tags, `ready` both ways, a spread of
      `updated_at`, parents and children) is loaded into a test database.
- [ ] For every `TaskFilter` field alone, and for a set of combinations, the
      ids `listTasks` returns (walked to the end) equal the ids
      `applyTaskFilter` returns over the unfiltered list, **in the same order**.
- [ ] Adding a field to `TaskFilter` without a case here fails the test.
- [ ] The test is red when either side's clause for one field is changed.

## Notes / context

- It reads across two areas (`server/src` and `server/web/src`), like
  LAI-213's drift check: it may live in `server/test/` and import the web
  module, or the reverse; choose the side whose runner can open a database.
- `ready` is derived on the server; the fixture must give a task whose readiness
  depends on a blocker, so both sides read the served value.

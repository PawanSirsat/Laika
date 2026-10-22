---
id: LAI-962
title: 'A task can be assigned to someone who is not in its project, even a private one'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-22T13:30:34Z
---

## Goal

Found 2026-10-22: `assignee_id` is written as given on create
(`services/tasks.ts` ~792) and on update only the caller's `task.assign_other`
is checked; the DB only requires that the user exists.

## Acceptance criteria

- [ ] Create, update and MCP assign refuse an assignee who cannot read the
      project (`can(assignee, 'project.read', {projectId})` — so owner/admin
      implicit access still counts) with `422` and a clear `code`; tests by
      key on a private project.
- [ ] Existing data untouched (no migration rewriting assignees); builder
      reports whether any existing rows violate the rule.
- [ ] SPEC §6.4 task-write prose line naming the rule (named cross-area edit).
- [ ] Gate exit 0.

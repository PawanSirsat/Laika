---
id: LAI-986
title: 'Removing or deactivating someone leaves their open tasks assigned; the organisation overview has no pulse'
area: server
assignee: core
priority: p2
depends-on: [LAI-981]
discovered-from:
status: review
started: 2026-10-22T18:29:20Z
finished: 2026-10-22T18:45:54Z
---

## Acceptance criteria (D-104 item 5; audit C5)

- [x] Member removal and deactivation accept `open_tasks: 'unassign' |
      { reassign_to: user_id }`; without it, `409` with the count and keys of
      open tasks (so the UI can ask). Reassign target must be able to hold the
      tasks (LAI-962 rule). Deactivation also removes space memberships.
- [x] `GET /api/v1/org/overview` (org.read): people active this week, open /
      in review / blocked / overdue counts (reuse LAI-974's definitions).
- [x] Named SPEC edits; gate; web halves LAI-988/989.

## Notes (CORE, on submission)

- **Deviation, §2 step 1:** `depends-on: [LAI-981]`, and LAI-981 is not in
  `.tasks/done/`. Claimed on CHIEF's direction, stacked on LAI-985 @1e6039cf
  (itself on LAI-981). `origin/LAI-974-work-summary-counts` is merged in for
  `summariseAllTasks` / `OPEN_STATUSES` (merge 30da6206).
- Reassignment writes `task.assigned` (`via: 'offboarding'`), not
  `task.updated`: §5 names `task.assigned` as the verb for a reassignment, and
  `updateTask` writes it. No new verb.
- The `409` lists only keys in spaces the caller can read (`hidden` counts the
  rest), so a person granted *Deactivate people and reset access* learns no
  key from a space they cannot open.
- The authority for moving the tasks is the removal's or the deactivation's.
  No separate `task.assign_other` is asked per task.
- Deactivation may remove the last lead of a space: the owner always holds
  lead, so no space is left unmanageable.
- "This week" is the last seven days, and `since` is returned.
- **Web halves, §4.4 (LAI-988/989):** `OrgOverviewView` is in `UNPAIRED` until
  the screen brings the client type. Anything web the gate shows is quoted in
  the log entry.

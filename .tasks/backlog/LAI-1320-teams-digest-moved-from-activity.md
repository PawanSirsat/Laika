---
id: LAI-1320
title: "Teams nightly digest: 'Moved' reads tasks.updated_at, so an edit reads as a move; read the day's status changes from activity"
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-1314]
discovered-from: LAI-1314
status: backlog
---

## Goal

LAI-1314's nightly digest (D-154 item 6) lists **Moved (n)** from the space's
tasks whose `updated_at` falls in the SAST day before
(`digestData` in `server/src/services/teams-posting.ts`). That is KSage's
query (`w.updated_at::date = $2`), ported as it was, and it over-reports:
`updated_at` moves on any edit — a title, a description, a tag, a due date,
a deliverable ticked — so a task that only had its title fixed is listed as
*moved*, with its current status after the arrow. A task that moved and was
then edited is listed once, which is right only by accident.

Found by review-1314 (PR #360, review item 8). Left out of the fix round on
CHIEF's word.

## Acceptance criteria

- [ ] **Moved** lists the tasks with a `task.status_changed` row in the SAST
      day (from `activity`, the record of change), each once, with the status
      it ended the day in — not tasks whose `updated_at` merely falls in it.
- [ ] A task edited but not moved that day is not listed; a task moved twice
      that day is listed once.
- [ ] The digest still sends nothing when nothing moved and nothing is
      blocked, and a day with only edits counts as nothing moved.
- [ ] `teams-posting.test.ts` holds both cases (an edit only; two moves in a
      day) against the real services, no hand-written `updated_at`.
- [ ] CI gate green on the PR: test, lint, format each exit 0.

## Notes

- The stand-up's *Key updates* already reads `activity`; this brings the
  digest in line with it.
- No schema change, no verb, no SPEC row beyond §11.6's digest sentence if it
  names `updated_at` (it does not today).

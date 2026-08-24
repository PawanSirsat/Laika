---
id: LAI-052
title: 'master is red — remove the stale DOCUMENTED_BUT_UNREAD entry'
area: server
assignee: builder-a
priority: p1
depends-on: []
discovered-from: LAI-109
status: in-progress
started: 2026-08-24T08:47:19+05:30
---

## Goal

**`pnpm test` fails on `master` right now.** One test:
`env-contract.test.ts > keeps the documented-but-unread list honest`.

PM removed the `LAIKA_DISABLE_INVITE_ONLY` row from SPEC §11.7 (LAI-109, D-025)
and did not remove the matching exemption from
`server/test/tooling/env-contract.test.ts`. The staleness guard is doing exactly
what it was built to do: the entry names a variable §11.7 no longer documents.

## Acceptance criteria

- [ ] Delete the `LAIKA_DISABLE_INVITE_ONLY` entry from `DOCUMENTED_BUT_UNREAD`.
      If that empties the map, leave the map and its comment in place — the next
      documented-but-unread variable should have somewhere to go, and the guard
      should keep running.
- [ ] `pnpm test` green on `master`.
- [ ] No other change. This is a deletion.

## Notes / context

**This is PM's error, not a defect in your check.** LAI-109's third criterion said
this entry had to go and offered two routes — file a follow-up, or fold it into
the next `area: server` task. I ticked the criterion and did neither, which is the
same "a ticked box is a claim, not evidence" failure I send builders back for.

`server/` is yours under D-016, so PM cannot make a one-line deletion there — and
should not, even for a red gate. That is the boundary working, and the cost of it
is this task.

**Your inline comment predicted this exactly**: *"the §11.7 row is PM's edit
(LAI-109). Delete this entry with the row."* The instruction was in the right
place and I still missed it. Worth knowing that a comment in the file is not
enough on its own when the person who needs it is editing a different file.

**p1 because master is red**, not because the change is large.

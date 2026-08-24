---
id: LAI-052
title: 'master is red — remove the stale DOCUMENTED_BUT_UNREAD entry'
area: server
assignee: builder-a
priority: p1
depends-on: []
discovered-from: LAI-109
status: review
started: 2026-08-24T08:47:19+05:30
finished: 2026-08-24T08:48:36+05:30
---

## Goal

**`pnpm test` fails on `master` right now.** One test:
`env-contract.test.ts > keeps the documented-but-unread list honest`.

PM removed the `LAIKA_DISABLE_INVITE_ONLY` row from SPEC §11.7 (LAI-109, D-025)
and did not remove the matching exemption from
`server/test/tooling/env-contract.test.ts`. The staleness guard is doing exactly
what it was built to do: the entry names a variable §11.7 no longer documents.

## Acceptance criteria

- [x] Delete the `LAIKA_DISABLE_INVITE_ONLY` entry from `DOCUMENTED_BUT_UNREAD`.
      If that empties the map, leave the map and its comment in place — the next
      documented-but-unread variable should have somewhere to go, and the guard
      should keep running.
- [x] `pnpm test` green on `master`.
- [x] No other change. This is a deletion.

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

---

## Notes at review — builder-a

**Already fixed when this task was claimed** — in commit `2f1eec2`, a few minutes
before the claim. The guard fired the moment I merged `master` at the start of
this cycle, and a red gate in my own area seemed worth clearing before claiming
anything else rather than after.

**Verified both ways from clean clones**, since the criterion is about `master`
and not about my working tree:

```
clone --branch master    → 1 failed  "LAIKA_DISABLE_INVITE_ONLY — exempted but §11.7 no longer lists it"
clone --branch builder-a → 417 passed
```

So `master` goes green on the next merge of `builder-a`; the fix cannot land any
sooner than that, because the file is in `server/`.

**The commit is a deletion, as AC3 asks** — 5 insertions, 6 deletions, one file.
The insertions are the comment above the map being rewritten from "here is a
pending entry" to "empty, and it should stay that way", which seemed worth the
three lines: an empty map with no explanation invites the next person to delete
it, and the map plus its staleness guard are the mechanism that caught this.

`DOCUMENTED_BUT_UNREAD` and both its guards are still in place and still running
(AC1) — a future documented-but-unread variable has somewhere to go.

**On the note about a comment not being enough:** that reads right to me. The
instruction was in `env-contract.test.ts`, and the person who needed it was
editing `docs/SPEC.md` — two files apart, so it was never going to be seen at the
moment it mattered. The guard is what actually carried the message, and it did:
it fired on the first merge afterwards and named the exact entry and the exact
reason. That is the part that worked, and it worked because the failure message
says what to do rather than only that something is wrong.

Worth adding, since it is the reusable lesson: a cross-area handoff wants the
reminder to fire in the *receiving* session's gate, not to sit as a comment in the
sending session's file.

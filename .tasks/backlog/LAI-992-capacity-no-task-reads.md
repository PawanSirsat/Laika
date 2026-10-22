---
id: LAI-992
title: 'Capacity: no Show tasks footer, and no task is read when the page loads'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-991]
discovered-from: LAI-991
status: backlog
---

## Why

The owner, on 2026-10-23, looking at LAI-991's cards: *"you remove this
right from card i dont want, also when the page load also dont load that,
that will increase the unnecessary load."* The *Show tasks · N in progress*
footer goes, and so does every task read the Capacity tab makes: the
`GET /tasks/:id` for each session's matched task on load, and the per-card
reads behind *Show tasks*. The workload counts already say how many are in
progress.

## Acceptance criteria

- [ ] No `.cap-tasks` footer on a card, no *Show tasks*, no *Claude Code ·
      working on LAI-n* line.
- [ ] Capacity makes **no** `GET /tasks/:id` request, on load or after; its
      reads are `/capacity`, `/presence` and `/projects` (and the shell's
      `/review` and `/unlisted` counts). A browser test asserts the request
      list.
- [ ] `CapacityScreen` takes no `onOpenTask`; `CapacityTaskLink`, the
      resolved-task state and `taskIdsToResolve` are removed with their tests.
- [ ] SPEC §11.4.2's Capacity endpoint row and §11.4.2.1 no longer mention
      task reads, *working on* or *Show tasks*.
- [ ] Gate: root `pnpm test`, `pnpm lint`, `pnpm format` all exit 0.

## Notes

Done by CHIEF on the owner's direct instruction, in worktree
`Laika-capacity` on branch `LAI-992-capacity-no-task-reads`. Board card
LAIKA-743.

---
id: LAI-992
title: 'Capacity: no Show tasks footer, and no task is read when the page loads'
area: web
assignee: chief
priority: p1
depends-on: [LAI-991]
discovered-from: LAI-991
status: done
accepted: 2026-10-22T19:00:24Z
finished: 2026-10-22T19:00:22Z
started: 2026-10-22T18:42:35Z
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

- [x] No `.cap-tasks` footer on a card, no *Show tasks*, no *Claude Code ·
      working on LAI-n* line.
- [x] No *Activity · 14 days* block on a card and no *hand · agents ·
      bookkeeping* column in the list (the owner, a minute later: *"also
      remove this activity thing"*). The profile keeps the fortnight.
- [x] Capacity makes **no** `GET /tasks/:id` request, on load or after; its
      reads are `/capacity`, `/presence` and `/projects` (and the shell's
      `/review` and `/unlisted` counts). A browser test asserts the request
      list.
- [x] `CapacityScreen` takes no `onOpenTask`; `CapacityTaskLink`, the
      resolved-task state and `taskIdsToResolve` are removed with their tests.
- [x] SPEC §11.4.2's Capacity endpoint row and §11.4.2.1 no longer mention
      task reads, *working on* or *Show tasks*.
- [x] Gate: root `pnpm test`, `pnpm lint`, `pnpm format` all exit 0.

## Notes

Done by CHIEF on the owner's direct instruction, in worktree
`Laika-capacity` on branch `LAI-992-capacity-no-task-reads`. Board card
LAIKA-743.

## Review (CHIEF, 2026-10-23)

Built and reviewed by the same session on the owner's instruction:

- No footer, no *working on*, no activity on a card or in the list:
  `capacity.test.ts` *every card draws every block* (labels are Workload,
  Agents, Spaces), the owner test (`.cap-spark` count 0), and the list's
  columns.
- No task read: *Capacity asks for /capacity, /presence and /projects, never
  a task* asserts the request list on load and after switching to List;
  `store-requests.test.ts` asserts zero per-task reads with four task stubs
  served if asked.
- `CapacityTaskLink`, `onOpenTask`, `taskIdsToResolve` and the resolved-task
  state are gone; `tsc` and eslint clean.
- Root gate on the branch: cli 604 / web 3012 / server 3626, `pnpm test` 0,
  `pnpm lint` 0, `pnpm format` 0.

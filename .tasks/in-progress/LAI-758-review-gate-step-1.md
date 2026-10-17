---
id: LAI-758
title: 'Review gate, step 1: agents never mark Done, proof on finish_task, and a review queue (server/ + server/web/ + docs/)'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-17T06:53:06Z
status: in-progress
---

## Goal

**Made on the owner's direct instruction** (Pawan Sirsat, 2026-10-17, through
the orchestrator), single-agent mode (docs/HANDOVER.md §4, "one agent doing
all of it"), on the temporary branch `build-review-gate` cut from `master`
`401191b`, worktree `Laika-review-gate`. Board cards **LAIKA-455** (agents
never mark Done), **LAIKA-476** (proof on finish_task) and **LAIKA-478**
(review queue). One branch changes `server/`, `server/web/` and `docs/`
together. Not pushed, not merged: the orchestrator reviews and merges.

Laika's strategy is to be the acceptance gate for coding-agent work: any
vendor's agent hands work back with proof, and only a named person signed in
to the web app marks it Done. Today an agent's token can move a task into
Done by `update_status`, by `POST /tasks/:id/status`, or by creating it there;
`finish_task` carries a summary and nothing a reviewer can check; and there is
no one place where a person sees what is waiting for them.

Out of scope: GitHub confirming the proof (LAIKA-477, LAI-753), the weekly
report, any security or HTTPS hardening, and the areas the parallel
`build-cleanup` branch is changing (Capacity chip, REST presence, Board
toolbar, README count, profile fixes).

## Acceptance criteria

**A. Agents never mark Done (LAIKA-455; audit H6, M7)**

- [ ] A caller authenticated by a personal access token is refused a move into
      any status whose **category** is `done` (D-077), whatever it is called
      and however it is named: `POST /tasks/:id/status` by `status` or
      `status_id`, MCP `update_status` by category or by a status's name, task
      create with a done status (REST `status` or `status_id`), `finish_task`,
      claim, and deleting a status whose work would move into a done status.
      The refusal is `403 forbidden` with `details.reason:
      "agent_cannot_mark_done"` and a message telling the agent to call
      `finish_task` and let a person accept.
- [ ] `review → done` is gone from `ALLOWED_TRANSITIONS`
      (`server/src/services/task-lifecycle.ts`); the person's table is
      unchanged; the comment in `server/src/auth/resolve-actor.ts` that said
      the table guaranteed this is corrected.
- [ ] M7: the rule that limits who may move a task into review (assignee,
      project lead, org admin/owner) limits moving it into done too.
- [ ] M7: claim takes a task only from a `backlog`- or `todo`-category status,
      or an unassigned `in_progress` one (released work, which moves no
      category), refusing done, cancelled and review ones with
      `unprocessable`; keeps the first `started_at`; records the real previous
      status in activity.
- [ ] Each new test fails without its fix (proved once by reverting the fix).

**B. Proof on finish_task (LAIKA-476)**

- [ ] `finish_task` (MCP) and the new REST twin `POST /tasks/:id/finish`
      accept optional `commits` (`sha`, optional `message`), `branch`,
      `pull_request` (an http(s) URL) and `tests` (`command`, `exit_code`); a
      call with only today's arguments still works.
- [ ] Every finish is stored as a round (`task_rounds`, numbered per task);
      every evidence item is a row (`task_evidence`) with a `state` of
      `claimed`, `confirmed` or `failed`, today always `claimed`, so step 2
      can flip it without a migration. The migration is additive.
- [ ] Sizes are validated (item counts, string lengths) on both surfaces.
- [ ] The task panel shows the latest round — commits, branch, PR as a safe
      link, test commands with exit codes (green 0, red otherwise), a
      `claimed` badge per item, the agent that finished it — with earlier
      rounds collapsed.
- [ ] `get_task_context` returns the latest evidence, and the latest
      send-back reason first when the task was sent back.
- [ ] The `finish_task` description and the server's `instructions` teach
      agents to attach proof.

**C. Review queue (LAIKA-478)**

- [ ] A global **Review** page at `/review`, in the sidebar's ORG group beside
      Capacity and Unlisted work, with a count of tasks waiting.
- [ ] It lists every task in a review-category status across every project
      the viewer can act on, oldest waiting first; each row shows key, title,
      project, assignee, the agent that finished it, time waiting, evidence
      summary (commits, PR, tests passed/failed) and round number; filters by
      project, assignee, failing tests and no evidence.
- [ ] Selecting a row shows the full evidence.
- [ ] **Accept** (web session only, the permission to move into done) moves
      the task to the project's first visible done status and records who
      accepted. **Send back** requires a reason, moves the task to the first
      visible in-progress status, posts the reason as a comment marked sent
      back, and writes activity; the reason shows on the card and the panel
      until the next finish, and `get_task_context` returns it first.
- [ ] Empty, loading and error states; light and dark; laptop and phone;
      live through the existing store and SSE; no new dependencies.

**Docs**

- [ ] SPEC §4, §5, §6.4, §7.1 and §11.4 describe what was built, and a new
      decision records the three rules (agents never move into done;
      evidence rounds and item states; send-back semantics).
- [ ] Full gate after the last edit: `pnpm test`, `pnpm lint`,
      `pnpm format`, each exiting 0.

## Notes / context

- SPEC §5, §6.3, §6.4, §7.1, §7.2, §11.4; D-021, D-051, D-076, D-077, D-078,
  D-079.
- No new dependency, and no new activity verb: an accept and a send-back are
  `task.status_changed` with `via`, and the reason is `comment.added`.

---
id: LAI-1116
title: 'SPEC and decision for the task detail redesign and the deliverables fields'
area: docs
assignee: strelka
priority: p1
depends-on: [LAI-1115]
discovered-from: []
status: review
finished: 2026-11-03T20:18:01Z
started: 2026-11-03T20:09:02Z
---

## Goal

Write down what LAI-1115 and LAI-1117 build, so the drift guards hold it:
the three task fields, how they change, the MCP params, and the task detail
screen's new shape.

## Acceptance criteria

- [x] §4.5: rows for `deliverables`, `solves`, `unlocks` — not null, default
      `[]`, the item shape and the state vocabulary, ordered, bounded by the
      service. `schema-spec-drift.test.ts` passes with the LAI-1115
      `COLUMNS_NOT_IN_SPEC` entries removed in this task.
- [x] §4.8: one sentence — a change to the three fields is `task.updated`
      (`changed` for a replaced list, `{ field, marked }` for a mark), not a
      verb of its own, as tags and size are not (D-027).
- [x] §6.4: `PATCH /tasks/:id` lists the three; `fields=slim` leaves out the
      five detail fields; `POST /tasks/:id/finish` says which `checklist`
      lines mark a deliverable done; `POST /tasks/:id/checkpoints` takes
      `working_on`. §4.70 says `working_on` is a request to the task, not a
      column of the checkpoint.
- [x] §7.1: `create_task`, `update_task`, `checkpoint_task`, `finish_task` and
      `get_task_context` rows carry the new params and output.
- [x] §11.4.2.1 Task detail: the "What this delivers" section (Ships with
      states and the progress line, Solves, Unlocks, inline-editable); the
      state panel per status (review with Approve / Send back for readers who
      may decide, in progress, sent back, waiting for the agent, done);
      activity grouped by actor with a "Who did this" popover naming person,
      agent, device, session harness, version and model; acceptance lines of
      the form `- [ ]` / `- [x]` drawn as a checklist; the modal at
      `min(1280px, 94vw)`.
- [x] A new decision in `docs/DECISIONS.md` (next free number — D-128 is
      drafted in PR #260): the redesign keeps the centred modal (D-063),
      stores deliverables as JSON columns, adds no activity verb, and keeps
      every §11.4.2.1 must-have.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0 on the branch
      stacked on LAI-1115 (the `view-type-drift` red remains until LAI-1117).

## Notes / context

Design read 2026-11-04: `~/Downloads/Laika Task Detail Redesign.html`, a
`TaskCard` in five states. The owner decided (chat, 2026-11-04): structured
fields; design is style, not scope; modal a little wider; Approve / Send back
inline; phone sheet later (LAI-1118); Share is copy link; mentions stay
people. The design's "confirmed … against the repository" is wrong — proof is
confirmed from GitHub's signed deliveries (D-116); the SPEC wording follows the
server.

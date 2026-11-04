---
id: LAI-1123
title: 'Task detail rail: alignment, the breaking rows, and an agent panel a person can read'
area: web
assignee: strelka
priority: p1
depends-on: [LAI-1122]
discovered-from: LAI-1122
status: review
finished: 2026-11-04T05:57:06Z
started: 2026-11-03T23:28:58Z
---

## Goal

The owner reviewed LAI-1122 locally (2026-11-04): the rail has alignment
problems and rows that break, and the agent panel under it "is not
understandable" — it names the agent three times, prints the session twice,
and says *Intended agent: None* beside *Working*. Fix the rail and rework the
agent panel, enhancing what reads poorly.

## Acceptance criteria

- [x] Status row: the status pill and *Move to <review>* on one line; the
      sub-line under them.
- [x] Every rail row aligns its label with the first line of its value.
- [x] Assignee on one line with *you* and *Profile* as one quiet sub-line.
- [x] Labels: the tags as chips with *+ Add*; the picker opens only when asked.
- [x] Development hides a commit count of zero.
- [x] Estimate: each similar task as key, title and how long it took, its
      send-back reason folded; an empty Tokens row says so in a few words.
- [x] Footer: short dates, one line each.
- [x] Agent panel: one card — the state and what it means, the agent named
      once, then Tool, Model, Last seen, Claimed, Requested agent and Saves
      as label/value rows like the rest of the rail; no line repeats
      another; hand-off and recovery unchanged in behaviour.
- [x] Every existing test that reads these strings or hooks still passes,
      updated by name where wording changed; both themes; no sideways scroll
      at 390px.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

Branch `LAI-1123-rail-polish`, stacked on LAI-1122 (#265). One task, a
subtask of the LAI-1122 card (owner: one high-level task with subtasks).

## Review notes (builder)

- The gate criterion is left unticked here: on this laptop `pnpm lint` and
  `pnpm format` exit 0, and `pnpm test` exits 1 only on timing tests that pass
  alone (see the log). The PR's CI run into `master` is the gate this lands on.

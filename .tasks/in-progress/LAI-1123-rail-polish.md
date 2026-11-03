---
id: LAI-1123
title: 'Task detail rail: alignment, the breaking rows, and an agent panel a person can read'
area: web
assignee: strelka
priority: p1
depends-on: [LAI-1122]
discovered-from: LAI-1122
status: in-progress
started: 2026-11-03T23:28:58Z
---

## Goal

The owner reviewed LAI-1122 locally (2026-11-04): the rail has alignment
problems and rows that break, and the agent panel under it "is not
understandable" — it names the agent three times, prints the session twice,
and says *Intended agent: None* beside *Working*. Fix the rail and rework the
agent panel, enhancing what reads poorly.

## Acceptance criteria

- [ ] Status row: the status pill and *Move to <review>* on one line; the
      sub-line under them.
- [ ] Every rail row aligns its label with the first line of its value.
- [ ] Assignee on one line with *you* and *Profile* as one quiet sub-line.
- [ ] Labels: the tags as chips with *+ Add*; the picker opens only when asked.
- [ ] Development hides a commit count of zero.
- [ ] Estimate: each similar task as key, title and how long it took, its
      send-back reason folded; an empty Tokens row says so in a few words.
- [ ] Footer: short dates, one line each.
- [ ] Agent panel: one card — the state and what it means, the agent named
      once, then Tool, Model, Last seen, Claimed, Requested agent and Saves
      as label/value rows like the rest of the rail; no line repeats
      another; hand-off and recovery unchanged in behaviour.
- [ ] Every existing test that reads these strings or hooks still passes,
      updated by name where wording changed; both themes; no sideways scroll
      at 390px.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

Branch `LAI-1123-rail-polish`, stacked on LAI-1122 (#265). One task, a
subtask of the LAI-1122 card (owner: one high-level task with subtasks).

---
id: LAI-1119
title: 'Deliverables as an estimator signal'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-1115, LAI-1116]
discovered-from: LAI-1115
status: backlog
---

## Goal

The size model counts `criteria` from acceptance checkbox lines
(`estimate-model.ts`). A task that states its Ships list carries a second,
cleaner count of what it must produce. Decide whether `deliverables.length`
joins the inputs, and if so, add it to §4.5's `estimate_hash` sentence and
D-085's list.

## Acceptance criteria

- [ ] A decision (CHIEF) on whether deliverables feed the model.
- [ ] If yes: the factor, its label in `why.factors`, the `estimate_hash`
      input, SPEC §4.5 and §4.32 updated, and the accuracy test still passing.

## Notes / context

Left out of LAI-1115 on purpose: it changes a frozen hash and a decision.

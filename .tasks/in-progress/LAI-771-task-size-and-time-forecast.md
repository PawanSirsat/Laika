---
id: LAI-771
title: 'Size and forecasts, phase 1: every task gets a computed size (XS-XL) with its why, a build-time forecast beside the actual, an override, and per-project accuracy (server/ + server/web/ + docs/)'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-17T13:52:30Z
status: in-progress
---

## Goal

The owner wants a difficulty on every task that updates itself, and predicted
time beside actual time so estimates improve. When this is finished, each task
carries a size XS / S / M / L / XL (weights 0.25 / 0.5 / 1 / 2 / 4, relative to
the project's typical task) computed from its own text and from similar
finished tasks in the project, a build-time forecast as a p50–p80 range, the
actual build time once finished, a *why*, and a person's override. D-085 is the
contract. Research with a back-test on 341 tasks: ~/Documents/laika-strategy/task-estimation/REPORT.md.

## Acceptance criteria

- [ ] **Computed inside Laika**, no outside service: signals from the task (acceptance text length, criteria count, subtasks, tags, dependencies) plus the k most similar finished tasks in the same project (cheap local text similarity). A back-test over the board's own finished tasks (each prediction using only earlier tasks) reports typical error against the plain project median; the method must beat the median.
- [ ] **Recompute** on create, on edit of title/description/acceptance, on subtask or dependency change — keyed on a hash of the inputs so irrelevant edits cost nothing; under 5 ms per recompute measured; refit nightly via the scheduler. A parent's size and forecast come from its children.
- [ ] **Frozen at claim:** the forecast in force when work starts is stored; estimate-vs-actual always uses that copy. Estimates kept in an append-only history table (migration **0036**, additive only).
- [ ] **Build time** = first start to first finish; review wait and rework shown separately.
- [ ] **Cold start:** size only; hours shown after 10 finished tasks in the project.
- [ ] **Override:** a person can set the size (who may: anyone who may edit the task); the override is shown, the computed one stays visible under *why*.
- [ ] **UI:** size badge on board cards and a List column (sortable); task panel section with size, *why* (each factor's contribution, links to the similar tasks), forecast range, actual, override control; a per-project accuracy figure. Light and dark, laptop and phone.
- [ ] **Agents:** `get_task_context` returns size, forecast and why; `create_task`/`update_task` accept an optional size override.
- [ ] **Never a score of people:** accuracy per project (and per agent client only with k ≥ 3 people), never per person (D-078 item 6, D-085 item 8).
- [ ] SPEC §1.1 note and the new sections; D-085 already written.
- [ ] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes / context

- Migration **0036** is reserved; LAI-769 (parallel) takes 0035. Whichever merges second regenerates its migration and journal properly (never just renames).
- Token forecasts are phase 2 (LAI-772). No new dependencies. Owner-direct.

---
id: LAI-316
title: 'Record the owner’s 2026-10-22 decision amending D-096 item 2 (polly’s turns and dispatched builders’ commits on SIGNALS) and LAI-315 in DECISIONS.md and SPEC'
area: docs
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-314
status: backlog
---

## Goal

`docs/DECISIONS.md` and SPEC say what LAI-314 and LAI-315 build, so neither
ships ahead of the record. Belka writes it (CLAUDE.md, *Two machines*, item 4:
only Belka writes `docs/DECISIONS.md`).

## The owner’s decision (2026-10-22), verbatim as handed to Strelka

> OWNER DECISION (2026-10-22, amends D-096 item 2 'only prompts and
> commits'): the owner types only into Omnigent's polly, so My day's SIGNALS
> lane is always empty. Make it show:
> (a) polly's PERSON-STARTED turns (the `t` turns the collector already
> distinguishes from turns Omnigent started itself) counted as prompts, for
> SIGNALS bucketing;
> (b) commits made in the repos/worktrees of builders the owner dispatched
> (sessions tagged `omnigent` in ~/.laika/activity/skip-sessions) counted as
> commits on the lane — lane ticks only, never added to the owner's hours or
> contribution (D-091 still holds for hours).
> Still counts only: no text, paths, repo names, messages.

## Acceptance criteria

- [ ] A D-entry in `docs/DECISIONS.md` records the decision above as an
      amendment of D-096 item 2, and names LAI-314.
- [ ] The same D-entry, or its own, records LAI-315's decision.
- [ ] SPEC's description of a time-draft block's signals (§6.4, the `at`
      field) says a person-started orchestrator turn counts as a prompt and
      a dispatched builder's commit as a commit, counts only.

## Notes / context

- Filed by Strelka from LAI-314 (Strelka's range, D-097). CHIEF/Belka work.
- LAI-314's task file carries what it built and how, for the wording.

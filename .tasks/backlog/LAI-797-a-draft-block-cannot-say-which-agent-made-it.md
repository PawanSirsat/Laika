---
id: LAI-797
title: 'A draft block cannot say which agent its time came from, so My day cannot show "polly" beside an hour'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-792]
discovered-from: LAI-792
status: backlog
---

## Goal

My day shows where each drafted block's time came from — Claude Code, an
Omnigent orchestrator (polly), Codex — as counts, never as text, so the person
confirming a day can tell the orchestrator's minutes from their own sessions'.

## What LAI-792 found

LAI-792 drafts an Omnigent orchestrator's turns as the activity of the
person's primary session: each turn's end counts as a `reply`. The block
carries no label saying so, because SPEC §6.4 fixes `signals` to
`{ prompts?, replies?, sessions?, commits?, marks? }` and refuses any other
field in a block with `422`. The collector can only say it locally:
`laika time draft` prints "Built from … N Omnigent orchestrator turns …".
The owner asked for drafts to carry an `omnigent` / `polly` label.

## Acceptance criteria

- [ ] A block may carry per-agent counts (for example
      `agents: { "claude-code": n, "omnigent": n }`, bounded keys, counts
      only) — SPEC §6.4's upload shape and §4.45's `signals` column, named.
- [ ] The server stores and returns them on My day only to the owner on a web
      session, as the other signals are; an older collector that sends none
      still works.
- [ ] My day shows the agents behind a block; light and dark.
- [ ] The collector sends them (an orchestrator's turns as `omnigent`).
- [ ] Gate: test, lint, format exit 0.

## Notes

Four owners: `docs/` (SPEC), `server/`, `server/web/`, `cli/`. It is §4.4's
merge procedure, not a crossing.

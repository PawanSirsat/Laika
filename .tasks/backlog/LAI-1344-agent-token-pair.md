---
id: LAI-1344
title: 'CLI: LAIKA_AGENT_TOKEN without LAIKA_AGENT_URL is sent to the tool file''s board'
area: cli
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1343
status: backlog
---

## Goal

Found by LAI-1343's census. `readCredential` (`cli/src/agent-session.ts`) takes an agent's
credential from `LAIKA_AGENT_TOKEN` "with `LAIKA_AGENT_URL`, or the saved URL": when the
environment holds an agent token and no URL, it is paired with the board in
`~/.laika/agents/<tool>.json`, whatever token that file holds. An environment token issued by
another board is then sent to the file's board — the same mix LAI-1343 closed for the person's
`LAIKA_URL`/`LAIKA_TOKEN`.

It is **documented as intended** (cli/README.md: "`LAIKA_AGENT_TOKEN`, with its board from
`LAIKA_AGENT_URL` or, when that is not set, from the tool's own file"), and a D-118 hook test
asserts it (`agent-hooks-omnigent.test.ts`, "A plain run keeps the harness's own rule,
environment token included"). Changing it changes which credential an agent's hooks act with,
so it was left for a decision rather than changed inside LAI-1343.

Callers that pass an environment (so are affected): `agent.ts` (hook identity, two sites),
`agent-checkpoint.ts` (six), `agent-checkpoint-cli.ts`, `agent-events-cli.ts` (two),
`agent-handoff.ts`, `agent-watch.ts`, `project-check.ts` (two). Callers passing `{}` read only
the file and are not affected.

**Proposed:** `LAIKA_AGENT_TOKEN` is used only with `LAIKA_AGENT_URL`; without it the tool's file
is used as a pair (its URL and its own token), as `laika-claude` now does for the person's pair.
A token equal to the file's is the same credential either way.

## Acceptance criteria

- [ ] CHIEF decides the rule: both or neither, or the current documented fallback kept.
- [ ] If changed: a test with `LAIKA_AGENT_TOKEN` for board B and a tool file for board C sends
      nothing to C with B's token; the D-118 test and the README say the new rule.

## Notes

- **Testing on Belka:** single test files only; CI runs the gate.

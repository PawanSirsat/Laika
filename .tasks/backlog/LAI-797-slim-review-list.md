---
id: LAI-797
title: 'The Review list and the sidebar Review badge still download every waiting task with its description and acceptance text'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-795]
discovered-from: LAI-795
status: backlog
---

## Goal

LAI-795 slimmed the project task list. `GET /api/v1/review` still returns
full tasks, and the sidebar badge reads it on every page, so each screen pays
for every waiting task's description and acceptance text (about 200 tasks
waiting today).

## Acceptance criteria

- [ ] The Review list and the badge request only what they render, using the
      same opt-in selector shape as LAI-795; the default response is
      unchanged for agents and the CLI.
- [ ] The badge gets its count without downloading task bodies.
- [ ] Bytes of one Review page and of the badge request measured before and
      after; tests count fields or bytes, never time.
- [ ] Gate: test, lint, format exit 0.

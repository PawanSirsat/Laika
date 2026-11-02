---
id: LAI-1073
title: 'Project setup records: privacy and consistency edge cases from the #221 review'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1066
status: backlog
---

## Why

Review of PR #221 (LAI-1066) found edge cases where a local path or a username
could reach the board, and two inconsistencies. Batched in one follow-up.
Multi-owner (§4.4) with named cross-area edits: `server/` (CORE), `cli/` and
`server/web/` (SHELL), and SPEC §4.82 (CHIEF).

## Acceptance criteria

- [ ] `normaliseRemote` treats a Windows local path (`C:\Users\bob\repo`), a
      single-letter host, or any backslash as local → `undefined`; the label
      never carries a path.
- [ ] `POST /project-setups` refuses a `repo_label` outside a character
      allow-list (no `/`, `\`, `~`, `:`, control characters), so no
      path-like label is ever stored.
- [ ] When the repository top is the user's home directory, the folder-name
      label is not used; a neutral label is.
- [ ] A personal token sending a local-check body gets `403 not_an_agent`,
      not `422`.
- [ ] A browser record naming an agent requires that agent's grant on the
      project, consistent with what the agent itself could record; SPEC
      §4.82 says so.
- [ ] Web: *Update available* text mentions a prefix mismatch; a local check
      that found no block leads the headline over a browser record.
- [ ] CLI: an explicit test that a symlinked instructions file is read and
      neither it nor its target is changed.
- [ ] Tests for each.

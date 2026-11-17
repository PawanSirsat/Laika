---
id: LAI-1307
title: 'Flaky browser tests after the UI transformation: agents-tab, review-dialog, and setup that can hang a shard'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1306
status: backlog
---

## Goal

After #350 several browser tests failed once on CI and passed on a re-run, each a wait that read
the screen before a request had landed; every one delays a master release (D-073). jira-header
was fixed in #353, availability and slim-list in LAI-1309. What remains:

## Acceptance criteria

- [ ] `agents-tab.test.ts` "Close on a step showing the secret…" (30 s waitFor timeout on #352).
- [ ] `review-dialog` "a row a poll took before the decision landed is skipped on advance" (run
      44064020948).
- [ ] Every browser helper that runs setup before its test's `try`/`finally` closes its harness
      when setup fails, so a setup failure fails the file instead of hanging the shard for 60
      minutes (web shard 2 on #350; `openDay` already fixed in LAI-1306).
- [ ] Each fixed wait is aimed at the condition its assertion needs; no sleeps, no loosened
      assertions.

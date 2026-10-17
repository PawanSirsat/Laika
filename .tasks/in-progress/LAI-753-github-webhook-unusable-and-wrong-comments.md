---
id: LAI-753
title: 'GitHub webhook: no path sets its secret, a push stores almost nothing, and three comments say GitHub retries'
area: server
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-751
started: 2026-10-17T09:28:56Z
status: in-progress
---

## Goal

The GitHub webhook is not usable today and its comments are wrong. Found by
the heatmap research (`/tmp/laika-heatmap-research/REPORT.md`, Part A item 4
and Part B9) while planning LAI-751. It blocks the review gate's
"CI-confirmed" evidence (strategy P0 #8). Not part of LAI-751.

## Acceptance criteria

- [ ] A product path (API and screen, owners and admins) sets and rotates
      `orgs.github_webhook_secret_enc`. Today none exists, so every delivery
      is refused `401` (`server/src/http/routes/webhooks.ts`).
- [ ] A `push` records what a reader needs: today it stores at most one row
      with repo and branch — no commit ids, count or author — and a push to
      the default branch stores nothing.
- [ ] The three comments claiming GitHub retries failed deliveries are
      corrected (`server/src/services/webhooks.ts`,
      `server/src/http/routes/webhooks.ts`). GitHub's documentation says it
      does not redeliver automatically; every push to `master` restarts
      production, so deliveries during a restart are lost unless redelivered
      by hand.

## Notes / context

- Filed by LAI-751 from the orchestrator's contract,
  `/tmp/laika-activity/CONTRACT.md`, section "LAI-753".
- D-050 refused mapping commit authors to Laika users; any attribution this
  task adds needs a decision first.

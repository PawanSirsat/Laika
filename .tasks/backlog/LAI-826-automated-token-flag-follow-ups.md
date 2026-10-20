---
id: LAI-826
title: 'Automated token rows: the collector feature-detects the flag, the untested paths get tests, SPEC states the fold rule'
area: cli
assignee: unclaimed
priority: p2
depends-on: [LAI-815]
discovered-from: LAI-815
status: backlog
---

## Goal

LAI-815 shipped sub-agent tokens as rows marked `automated`. Its review
(review-automated-tokens, 2026-10-21) approved it with these follow-ups.

## Acceptance criteria

- [ ] **Feature detection, not 422 handling.** The board's sharing answer
      (the one that already carries `prefixes`) advertises that it accepts
      the `automated` flag. Without it, the collector drops automated rows,
      as it did before LAI-815, so an older board never refuses a whole
      report (own rows included) and the collector never backs off a day.
      Once the board supports the flag, those days are re-sent because the
      day's signature changed. Do **not** parse the 422. A test runs a new
      collector against a board without the flag.
- [ ] **Untested paths get tests:** accepted cost, rework and forecast
      coverage with automated rows; the "fewer than 3 people" fold with a
      person whose only rows are automated.
- [ ] **SPEC fold sentence:** a person counts toward "three people" even when
      their only rows in that row are automated (the review judged this
      correct; write it down).
- [ ] **Census prose:** drop the reader count from the LAI-815 docs rather
      than correct it (the review counted 32, not 33).
- [ ] **Plan-limit forecast, decision only:** sub-agents spend from the same
      account, so under D-091 the forecast now under-predicts for someone
      running an orchestrator. Write the trade-off up for CHIEF; do not
      change behaviour in this task.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Also noted by the review, not in scope here: about 22.6M of 26.56M
  automated tokens on 10-20 were tied to no card, so token-forecast
  calibration (`estimates.ts:1790`, coverage minimum 0.7) will drop the
  owner's tasks on those days until builders mark their cards.
- "What the board holds for you" shows automated tokens beside Prompts and
  Sessions that exclude automated sessions; a footnote belongs in LAI-820's
  area (SHELL).

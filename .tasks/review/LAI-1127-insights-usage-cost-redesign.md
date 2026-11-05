---
id: LAI-1127
title: 'Insights → Usage & cost matches the owner’s new design'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
status: review
started: 2026-11-05T12:10:00+05:30
finished: 2026-11-05T12:17:28+05:30
---

## Why

The owner exported a new design for Insights → Usage & cost
(`.polly/designs/insights-usage-cost.html`). Today's tab is a long column of
equal cards; the design is a dense dashboard: one KPI strip, the daily chart,
Budget alerts beside Top tasks, a tabbed Breakdown beside Cache efficiency,
Cost per accepted task with Rework and Runaway beside it, then a *You ·
visible only to you* section. Board card: LAIKA-993.

## Acceptance criteria

- [x] Header keeps Capacity / Usage & cost tabs, the Space select and a
      7d / 30d / 90d segmented range (`aria-pressed`, names *7 days* …).
- [x] A context line *All spaces · last N days · counts are minimums* with a
      *How we count* toggle (`aria-expanded`) revealing the existing floor text.
- [x] One 6-cell KPI strip: Tokens, Cache reads, Unattributed (or Outside any
      space in a space), Per day, Cost, From cache — label, value, sub.
- [x] Tokens per day chart, unchanged data, hover and keyboard readout.
- [x] Budget alerts (the reader's own token alerts, `GET /me/token-alerts`):
      share chip, key + title, used / budget with a thin bar, × dismiss,
      Dismiss all, collapsed to 6 with *Show all N*, *Soft alerts · nothing
      is blocked*. Beside it Top tasks.
- [x] Breakdown with Space / Developer / Agent / Model tabs (WAI-ARIA tabs,
      arrow keys); Space only when the server sent `by_project`; Developer
      still says per-person figures are for owners and admins when `null`.
      Beside it Cache efficiency.
- [x] Cost per accepted task with Rework and Runaway-agent alerts as side
      items; Runaway only when the server sent it.
- [x] Budgets (set a space's / sprint's budget) kept, below.
- [x] *You · visible only to you*: Your LLM tokens and Your plan limit.
- [x] No prototype sample string ships; theme tokens only; both themes; no
      sideways scroll at 390, 1366, 1440.
- [x] Browser tests updated; lint and format exit 0.

## Notes

- SHELL, `server/web/` only. No server change: every element has an
  endpoint already (see the PR's mapping table).
- Screenshots: `.polly/evidence/LAI-1127/`.
- Known gaps: the page header keeps today's Insights band (tabs below the
  title, not inline as drawn) — it is shared with Capacity; the cost sub-line
  keeps *API-equivalent, not your bill* where the design says *API-equivalent*;
  Budgets (a lead sets a space's and a sprint's budget) is not in the design and
  is kept, below Cost per accepted task, so nothing is lost.

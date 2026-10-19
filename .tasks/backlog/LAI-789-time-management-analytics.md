---
id: LAI-789
title: 'Time, phase 3: Time page for management — hours by client, project and card, budgets, estimate vs actual, capacity band, month close, admin-view log'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-787, LAI-788]
discovered-from:
status: backlog
---

## Goal

Management sees confirmed hours by client, project and card, how budgets are
burning, how estimates compare with actual hours, and the team's capacity as a
band — never a personal score (D-088 items 1, 6, 7).

## Acceptance criteria

- [ ] Time page in the sidebar: hours by client/project/card; billable share
      read from Solidtime at display time (no stored rates); hour budgets per
      project with burn and forecast to completion; estimate vs actual hours
      per project using D-085 effort; human hours vs agent minutes vs tokens
      and cost per project; time not tied to any card.
- [ ] Team capacity as one band for the team; no utilisation per person.
- [ ] Per-person hours: owners and admins only; each view logged; the person
      sees who looked and when. Members: project totals, three-person floor.
- [ ] Month close by a manager locks the period; later changes are revisions;
      Solidtime edits after close flagged.
- [ ] Draft acceptance rate (confirmed unchanged) shown per project, not per
      person.
- [ ] Light and dark, laptop and phone. Gate: test, lint, format exit 0.

## Notes / context

Top 10 analytics and traps: ~/Documents/laika-strategy/time-tracking/market/REPORT.md. Design §3.5–3.8:
~/Documents/laika-strategy/time-tracking/design/REPORT.md.

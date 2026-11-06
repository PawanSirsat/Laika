---
id: LAI-1153
title: 'Profile Overview: Work, This week, Projects table, Agents, Review and LLM tokens in rows'
area: web
assignee: shell
priority: p2
depends-on: [LAI-1150, LAI-1152]
status: in-progress
started: 2026-11-06T10:45:58+05:30
---

## Goal

The Overview as rows of cards that share a height, the same for both kinds
(frames A, B, C).

## Acceptance criteria

- [ ] Rows: Work + This week · Projects + Agents · Activity · Review for others
      + LLM tokens; one column at 390px; equal heights per row.
- [ ] Work: three tiles as tabs (In progress · In review · Due in 7 days), five
      rows, *Show all N* in a bounded scroll capped at 50 with the design's
      copy, *Open in Work ›*, and the *Delivered · 12 weeks* footer line.
- [ ] This week: two numbers on an empty track (never a fill, D-131 item 4),
      day bars confirmed + hatched drafts, today marked, Confirmed / Drafts /
      Agents apart, away line; *Time report ›* switches tab.
- [ ] Projects: the table (role *Space admin* / *Member*, open, hours 2 weeks,
      accepted, reviewed), open first, the quiet-projects fold; two-line rows
      on a phone.
- [ ] Agents: share of LLM tokens bar (from usage `by_agent`), per-tool rows
      with online and share, *Developer setup ›*, the dashed empty state.
- [ ] Review for others and LLM tokens restyled half-width with the design's
      copy and empty states; *Cost is the API-equivalent price, not a bill.*
- [ ] New member (frame B) empty states throughout; browser tests per card.

## Notes / context

Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion. SHELL's area (`server/web/`).

**Deviation (claim, 2026-11-06):** `depends-on` names LAI-1152 (profile shell),
which is not in `.tasks/done/` on `master`; it is being built in parallel on
`LAI-1152-profile-shell`. The owner directed the parallel build. To keep the
two apart, LAI-1152 owns the page chrome, head card, tabs, Who looked, the ⋯
menu and removing RatingCard / DecisionsCard / CurrentLoadCard; this task owns
the Overview body only (`profile/overview/`), and `ProfileScreen.tsx` changes
only where it renders the Overview. The two branches are reconciled on merge.

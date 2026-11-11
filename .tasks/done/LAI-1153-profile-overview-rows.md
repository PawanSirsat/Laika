---
id: LAI-1153
title: 'Profile Overview: Work, This week, Projects table, Agents, Review and LLM tokens in rows'
area: web
assignee: shell
priority: p2
depends-on: [LAI-1150, LAI-1152]
status: done
started: 2026-11-06T10:45:58+05:30
finished: 2026-11-06T11:46:20+05:30
---

## Goal

The Overview as rows of cards that share a height, the same for both kinds
(frames A, B, C).

## Acceptance criteria

- [x] Rows: Work + This week · Projects + Agents · Activity · Review for others
      + LLM tokens; one column at 390px; equal heights per row.
- [x] Work: three tiles as tabs (In progress · In review · Due in 7 days), five
      rows, *Show all N* in a bounded scroll capped at 50 with the design's
      copy, *Open in Work ›*, and the *Delivered · 12 weeks* footer line.
- [x] This week: two numbers on an empty track (never a fill, D-131 item 4),
      day bars confirmed + hatched drafts, today marked, Confirmed / Drafts /
      Agents apart, away line; *Time report ›* switches tab.
- [x] Projects: the table (role *Space admin* / *Member*, open, hours 2 weeks,
      accepted, reviewed), open first, the quiet-projects fold; two-line rows
      on a phone.
- [x] Agents: share of LLM tokens bar (from usage `by_agent`), per-tool rows
      with online and share, *Developer setup ›*, the dashed empty state.
- [x] Review for others and LLM tokens restyled half-width with the design's
      copy and empty states; *Cost is the API-equivalent price, not a bill.*
- [x] New member (frame B) empty states throughout; browser tests per card.

## Notes / context

Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion. SHELL's area (`server/web/`).

**Deviation (claim, 2026-11-06):** `depends-on` names LAI-1152 (profile shell),
which is not in `.tasks/done/` on `master`; it is being built in parallel on
`LAI-1152-profile-shell`. The owner directed the parallel build. To keep the
two apart, LAI-1152 owns the page chrome, head card, tabs, Who looked, the ⋯
menu and removing RatingCard / DecisionsCard / CurrentLoadCard; this task owns
the Overview body only (`profile/overview/`), and `ProfileScreen.tsx` changes
only where it renders the Overview. The two branches are reconciled on merge.

**Builder's notes (finish, 2026-11-06).**

- *Due in 7 days* is a count only: the profile serves `current_work.due_7d`
  and no list of those cards, so that tab says *N due in the next 7 days* with
  *See them in Work* (`/work?person=<id>`) instead of rows. A list needs a
  server field.
- This week is **one** `GET /time/report?from=&to=&members=<them>&drafts=include`
  for both cases (own scope on your own; a `time` look on someone else's, as
  D-139 item 4 decided), giving per-day confirmed/drafted and `agent_minutes`.
  Hours set and away dates are the availability the head card already holds
  (`/me/availability` on your own; on someone else's the pill's one
  `GET /people/:id/load` since LAI-1159 — reused, not read again, and never the
  list). A reader not served `work_week` gets *tracked* alone, never a guess.
- Agent minutes are said in minutes (D-088 item 8), e.g. *242 min*, not the
  design's *4h 02m*.
- Durations use D-139 item 7's two forms: `36 h 58 min` in the headline and the
  facts, `38h 20m` in the projects table and on the day bars where the long
  form does not fit.
- The projects table switches to two-line rows by **the card's** width (a
  container query), not the page's, so a 1024 laptop never squeezes the name
  column to nothing.
- LAI-1152 merged to `master` while this was in flight; `master` was merged into
  this branch and the Overview re-applied on its shell.

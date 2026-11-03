---
id: LAI-1122
title: 'Task detail, complete to the 2026-11-04 design — activity and comments, state panel, rail, data with no screen, phone'
area: web
assignee: strelka
priority: p1
depends-on: [LAI-1117]
discovered-from: LAI-1117
status: review
finished: 2026-11-03T23:24:13Z
started: 2026-11-03T21:11:02Z
---

## Goal

LAI-1117 shipped the redesign's new data and behaviour but kept much of the
old look, and left the rail and the phone layout undone. This is the **one
task** that finishes the task detail to the owner's design (owner, chat,
2026-11-04: "one high-level task is enough, with subtasks under it"). Its
parts are tracked as subtasks on the board card. It absorbs LAI-1118 (phone
sheet) and LAI-1121 (rail Estimate card and Details order), whose cards
become its subtasks.

## Acceptance criteria

- [x] **1. Activity and comments.** One header row per run (avatar, name, the
      agent chip `<harness> · <device>` that opens *Who did this* on hover,
      focus or click, the time on the right) and a vertical rail joining the
      run's items. Event rows with an icon circle per kind, from → to as
      pills, and meta (*via MCP · Polly*, the session's harness, version and
      model). Event wording as the design writes it (*Created this task*,
      *Sent the work request to …*, *Moved*, *Accepted and started work*,
      *Sent back*). Comment cards: a person's comment with *Edited*; an
      agent's progress note; a finish summary that folds with a fade and
      *Show full summary · N more points*; a send-back reason card. The
      empty line and the composer footer (*Markdown · @ to mention someone*,
      Comment). A deliverable ticked or started reads as such in the feed.
- [x] **2. State panel.** In review: the commit list and the test runs with
      *Show all N runs* inside the panel, *Full summary in activity ↓*, the
      Proof section folded below. Sent back: *Round n evidence* with
      *Show commits & tests*. The agent's mark in the panel's lines.
- [x] **3. Rail.** The status control as a pill with its colour dot; a
      **Links & dates** card (parent, subtasks *n of m done* with add and
      detach, blocked by, blocks with link and unlink, due, planned start);
      an **Estimate** card (effort with its override and *Why <level>?*,
      similar tasks with their durations, actual with a verdict, tokens
      *<total> of <p80> (<pct>)* with the cost line, the budget bar and every
      control TokensSection has); Details in the design's order with priority
      as *▲ P1 · High*; the footer as the design draws it. Nothing the rail
      or the main column could do before is lost.
- [x] **4. Data that had no screen.** Comment edit and delete (LAI-234). Each
      round's decision — accepted or sent back, by whom, the reason — in the
      Proof section (`RoundView.decision`). Similar finished tasks with why
      each was sent back, in the Estimate card (`GET /tasks/:id/similar`).
      Time people confirmed on the task, in the Estimate card
      (`GET /tasks/:id/time`, totals only, LAI-812).
- [x] **5. Phone.** Below 600px the drawer is a bottom sheet with a handle;
      one column in the design's order by CSS `order`; closes by Escape, the
      scrim, the handle and Back.
- [x] **6. Design check.** Each mockup state seeded locally and screenshotted
      at desktop and 390px in both themes; the pairs shown to the owner.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

- Branch `LAI-1122-task-detail-complete`, stacked on LAI-1117 (#264).
- Built by parallel agents in their own worktrees, split by file so none
  edits another's: the feed (`ActivityFeed.tsx` and its pieces), the state
  panel (`StateHero.tsx`, `EvidenceSection.tsx`, the rounds service), the
  rail (`TaskMeta.tsx` and new rail cards, the time and similar endpoints);
  the phone sheet after they merge.
- Still out, as the owner agreed: share links and `@agent` mentions (the
  server has neither).

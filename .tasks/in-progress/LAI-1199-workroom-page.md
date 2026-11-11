---
id: LAI-1199
title: Task Workroom v1 — the full-page task view at /task/:key (Phase C, UI only)
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-11-11T10:30:00Z
---

## Goal

A task has two entries: the drawer for a quick look, and a full page at
`/task/:key` (the Workroom) for working it. The page is three resizable
panels — hierarchy and section nav on the left, the task's document,
execution timeline, evidence and discussion in the centre, and four agent
lanes (Accountable / Requested / Executing / Outcome), status, assignee and
the existing review actions on the right. UI only: the existing public API,
no new dependency, no demo data, permissions decided by the server.

Stacked on LAI-1140's drawer host (PR #289). Spec:
`.polly/proposal/workroom-and-deliverables.md` §1, and Phase C of
`00-transformation-proposal.md`.

## Acceptance criteria

- [ ] `/task/:key` is a route (route table + ScreenOutlet) that resolves a
      key through the existing API, with loading skeleton, error + Retry,
      not-found and permission-denied states.
- [ ] The drawer has an *Expand* control that opens `/task/:key` (a pushed
      entry; Back returns to the view with the drawer open); the page has
      *Back to <view>*.
- [ ] Left: parent, subtasks, dependencies both ways, related work, section
      nav. Section switching replaces history; opening the page pushes.
- [ ] Centre: description and acceptance through the existing renderer; an
      execution timeline from checkpoints, rounds and claim activity; evidence
      with claimed / confirmed / failed provenance; discussion and activity.
- [ ] Right: four agent lanes from real data only (never "assigned to an
      agent"); status; assignee; Accept / Send back through the existing
      flows; decisions and open questions from checkpoint fields, labelled
      agent-reported.
- [ ] Dividers are `role="separator"`, drag- and keyboard-resizable (arrows,
      Shift, Home/End, Enter collapses), panels collapsible, widths kept in
      localStorage (preferences only), storage that throws falls back to
      defaults.
- [ ] Focus mode hides the side panels and the app sidebar, on a shortcut
      that clashes with no existing key; Escape leaves it.
- [ ] No nested same-axis scroll: the page scrolls the centre; side panels
      are sticky.
- [ ] Responsive: ≥1280 three panels; 1024 two (left behind a button);
      ≤768 one column with a section switcher; 390 full-screen. Both themes,
      reduced motion, landmarks, headings, labelled separators, tokens only.
- [ ] The drawer keeps working identically; shared reads are extracted, not
      duplicated.
- [ ] Unit tests for lane derivation and the layout maths; Playwright for
      Expand and direct URL, Back/history, keyboard resize + persistence
      across reload, focus mode, breakpoints, not-found, lanes from fixture
      data only. Each key behaviour mutated once to prove its test fails.

## Notes / context

Server gaps found are reported, not built: there is no REST key lookup
(`GET /tasks/:id` takes an id only), so the page resolves a key through the
space list and the space's task set.

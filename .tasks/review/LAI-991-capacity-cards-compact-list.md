---
id: LAI-991
title: 'Capacity: compact cards of one height, every block drawn with a 0, consistent hover text, and a List view'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: review
finished: 2026-10-22T18:15:03Z
started: 2026-10-22T17:42:37Z
---

## Why

The owner redesigned Capacity (`~/Downloads/Capacity.html`, a Claude Design
export, 2026-10-22) and asked for it on `master`: the cards are to be smaller
and the same shape for everyone, a block that has nothing to say draws a `0`
or *No agents connected* / *No spaces* rather than disappearing, what hover
shows is the same kind of thing everywhere, and the page gets a **List** view
beside the cards.

## Acceptance criteria

- [x] Every card draws the same blocks in the same order, whoever the person
      is: head (avatar, name, role, status, load badge), workload (in progress ·
      to do · backlog, the bar, waiting on reviewers · due in 7 days), **Agents**
      (*N running*; chips, or *No agents running* — "connected" would claim
      what a member's answer cannot say), **Spaces** (*N spaces*;
      chips with the space's colour and committed count, or *No spaces*), and
      the tasks footer (*Show tasks · N in progress*, or *No tasks in
      progress*). For an owner or admin, **Activity · 14 days · total** too,
      with the sparkline and *by hand · by agents · bookkeeping* as three
      figures. Nothing is omitted for being zero.
- [x] Cards in a row are the same height: the grid stretches them and the
      footer sits at the bottom.
- [x] Hover is consistent: every figure that has a rule behind it carries a
      `title` saying what it counts — the load badge, overdue, each activity
      figure (what *by hand*, *by agents* and *bookkeeping* mean), each space
      chip, each agent chip, the status line.
- [x] A **Cards / List** toggle in the toolbar. List is a table: person, load,
      workload bar, in progress, to do, review, agents running, activity (owners
      and admins), spaces. The choice is remembered in the browser. Filters,
      search, space and sort apply to both.
- [x] *Team load* and *Agents running now* under the grid are retired: the List
      view's bars are the team load, and the *Agents running* tile and each
      card's agents carry the rest. SPEC §11.4.2.1's Capacity entry says so.
- [x] Both themes; at 390px nothing is clipped or pushes the page sideways; the
      skeleton still matches the final layout.
- [x] Browser tests cover: every block present with zeros on a person with no
      agents, spaces or tasks; the List view's rows and columns; the hover
      titles. Existing capacity tests updated where the markup changed.
- [x] Gate: root `pnpm test`, `pnpm lint`, `pnpm format` all exit 0.

## Notes

Done by CHIEF on the owner's direct instruction (the owner asked this session
to build it and merge it to `master`), in the worktree `Laika-capacity` on
branch `LAI-991-capacity-cards`. Colours stay tokens: `theme-single-source`
forbids literals. The design's space colours are `avatarColor('space:' + slug)`,
the same as the sidebar's badge.

## Review (CHIEF, 2026-10-22)

Built and reviewed by the same session on the owner's instruction, so the
review is the gate and the criteria read back against the screen:

- Every block on every card, zeros drawn: `capacity.test.ts` *every card
  draws every block* (Cal Mokoena, who has nothing) and *a member sees the
  same blocks less Activity*.
- One height a row, footer at the edge: *cards in a row are one height*.
- Hover: *every figure says its rule on hover* — card and list.
- Cards / List, remembered: *List: the same people as rows …* and the
  member's list.
- Team load and Agents running now retired: SPEC §11.4.2.1 rewritten;
  `CapacityScreen.tsx` no longer imports `PersonLink` or `AgentMark`.
- Both themes looked at once (dark and light screenshots of cards and list);
  390px test green; the skeleton test green.
- Root gate on the branch: cli 604 / web 3015 / server 3626, `pnpm test` 0,
  `pnpm lint` 0, `pnpm format` 0. The first run was red on one line
  (`.cap-avatar-sm` at 11px, the type floor) and hung once in
  `cli/test/activity-hook.test.ts` on a `/bin/sh` hook that never drained;
  the file passes alone (101/101) and the rerun was green — noted in the
  log, not fixed here.

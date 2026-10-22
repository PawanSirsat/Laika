---
id: LAI-991
title: 'Capacity: compact cards of one height, every block drawn with a 0, consistent hover text, and a List view'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: in-progress
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

- [ ] Every card draws the same blocks in the same order, whoever the person
      is: head (avatar, name, role, status, load badge), workload (in progress ·
      to do · backlog, the bar, waiting on reviewers · due in 7 days), **Agents**
      (*N running*; chips, or *No agents connected*), **Spaces** (*N spaces*;
      chips with the space's colour and committed count, or *No spaces*), and
      the tasks footer (*Show tasks · N in progress*, or *No tasks in
      progress*). For an owner or admin, **Activity · 14 days · total** too,
      with the sparkline and *by hand · by agents · bookkeeping* as three
      figures. Nothing is omitted for being zero.
- [ ] Cards in a row are the same height: the grid stretches them and the
      footer sits at the bottom.
- [ ] Hover is consistent: every figure that has a rule behind it carries a
      `title` saying what it counts — the load badge, overdue, each activity
      figure (what *by hand*, *by agents* and *bookkeeping* mean), each space
      chip, each agent chip, the status line.
- [ ] A **Cards / List** toggle in the toolbar. List is a table: person, load,
      workload bar, in progress, to do, review, agents running, activity (owners
      and admins), spaces. The choice is remembered in the browser. Filters,
      search, space and sort apply to both.
- [ ] *Team load* and *Agents running now* under the grid are retired: the List
      view's bars are the team load, and the *Agents running* tile and each
      card's agents carry the rest. SPEC §11.4.2.1's Capacity entry says so.
- [ ] Both themes; at 390px nothing is clipped or pushes the page sideways; the
      skeleton still matches the final layout.
- [ ] Browser tests cover: every block present with zeros on a person with no
      agents, spaces or tasks; the List view's rows and columns; the hover
      titles. Existing capacity tests updated where the markup changed.
- [ ] Gate: root `pnpm test`, `pnpm lint`, `pnpm format` all exit 0.

## Notes

Done by CHIEF on the owner's direct instruction (the owner asked this session
to build it and merge it to `master`), in the worktree `Laika-capacity` on
branch `LAI-991-capacity-cards`. Colours stay tokens: `theme-single-source`
forbids literals. The design's space colours are `avatarColor('space:' + slug)`,
the same as the sidebar's badge.

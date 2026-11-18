---
id: LAI-1319
title: 'My day: the Availability chip’s state sits 6px above its word and chevron'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-1318
status: in-progress
started: 2026-11-18T07:58:30Z
---

## Goal

On My day's title row the *Availability* control reads "Availability ■ At
capacity ⌄", and the state — glyph and words — sits 6px above the line the word
and the chevron share. The pill keeps its standalone `align-self: flex-start`
inside the control's row. Centre it.

## Acceptance criteria

- [ ] The word, the state's glyph, the state's words and the chevron share one
      centre line (measured offset 0px, was -6px), light and dark.
- [ ] The pill elsewhere (Insights, the profile, My availability) is unchanged.
- [ ] Repo-root `pnpm test`, `pnpm lint` and `pnpm format` exit 0.

## Notes

`server/web/src/routes/screens/my-day/my-day.css` only.

## Renumbered

Filed first as LAI-1319 on 2026-11-18 from a sweep of the git refs alone. That id is already taken on the Laika board, by a card whose task file never reached a branch here. Renumbered before anything was pushed, so no commit carries the old id. The board card carries this id as `external_ref`.

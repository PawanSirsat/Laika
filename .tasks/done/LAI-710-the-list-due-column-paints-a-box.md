---
id: LAI-710
title: 'The List’s DUE column paints a grey box down every row'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-705
status: done
closed: 2026-10-07T07:57:56Z
started: 2026-10-07T08:10:00Z
finished: 2026-10-07T08:14:00Z
---

## Goal

Found in LAI-705's screenshot of the List in the light theme: the DUE column
is a solid grey block from header to last row. LAI-495 gave the due cell
`list-tone-${dueTone}`, and `.list-tone-flat` paints a background and border —
the status pill's box. PRI, CREATED and UPDATED are excluded from the box by
one rule in `list.css`; DUE was never added to it.

## Acceptance criteria

- [x] `.list-due` joins the rule that takes the box off the text columns, and
      the flat tone's muted colour rule, so the overdue red still shows.
- [x] A browser assertion: a List row's DUE cell has a transparent background
      in both themes, while the status pill beside it keeps its own; red
      before the fix.

## Notes / context

Filed and fixed by CHIEF on the owner's instruction to finish the List and
icons quickly; one CSS rule. Discovered from LAI-705.

## Review

Accepted 2026-10-07T07:57:56Z by CHIEF, who fixed it. Red on the old CSS, green on the
fix; the status pill beside it keeps its box as the positive control.


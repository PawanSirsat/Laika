---
id: LAI-511
title: 'My day: the editor is a full-height right drawer that opens on a tap and is closed on load; Agent time and On your plate leave the page and open in the same drawer from a header button; on a phone the drawer is a bottom sheet'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-888
status: in-progress
started: 2026-10-25T00:30:00Z
---

## Goal

The owner's `MyDay.dc.html` (LAI-510) draws the editor as a 400px drawer
beside the **whole page** — a sibling of the page column, the height of the
viewport, its own scroll, a left rule — shown only while something is
selected, and nothing is selected on load. It draws no side column: Agent
time and On your plate are not on the page. The owner, 2026-10-25: *"i want
as per design … also want side card appear when tap"*. So the drawer carries
either the editor (a block, gap, stretch, tray item or Add time picked) or
the two side cards (a header icon button beside the eye), and the page body
is the Timeline, the tray and the tabs alone. On a phone the same drawer is
the design's bottom sheet, which retires LAI-506.

## Acceptance criteria

- [ ] On load nothing is selected and no drawer is open; the page body is
      full width (`myday-grid`'s side column is gone).
- [ ] Picking a block, a gap, a dragged stretch, a tray item, Add time (N)
      or the timer's refused stop opens the drawer to the right of the page:
      400px wide, viewport height, `role="dialog"` with the editor's
      aria-label, border-left, its own vertical scroll, head and footer fixed
      inside it as the design draws them. The page column narrows beside it.
      × and Esc close it; ‹ › in its head walk the drafts as before.
- [ ] Under 1280px with the drawer open the app sidebar collapses (the
      design's `tight`), and the body padding drops to `16px 20px 48px`.
- [ ] A header icon button (34px, beside the eye; aria-label *Beside your
      day*) opens the drawer holding Agent time and On your plate, each as the
      card it is today; a selection replaces them with the editor; closing
      the drawer shows the page alone. The button reads `aria-expanded`.
- [ ] Under 760px the drawer is a bottom sheet: fixed to the bottom, 86% max
      height, 16px top radius, a 36×4 handle, a scrim that closes it, Esc
      closes it, focus trapped inside; letting go of the selection closes it.
- [ ] Both themes, at 1440, 1180 and 390px. `my-day-editor-right.test.ts`
      re-aimed; a browser test proves the drawer closed on load, open on a
      pick, the cards on the button, and the sheet on a phone.
- [ ] LAI-506 is superseded by this task (noted in its file by CHIEF).

## Notes / context

Design: `docs/design/MyDay.dc.html` — `dr`, `lay.side`, `lay.tight`, the
`sideDef` cards are computed by the design but not drawn; the owner wants
them on a tap. Keep `Inspector.tsx` and the cards' components; this task is
where they live, not what they say. Built by CHIEF on the owner's word, in
its own worktree, as LAI-500 – LAI-509 were.

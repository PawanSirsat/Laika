---
id: LAI-730
title: 'The Board toolbar''s own controls leave search 113px at 920px with the sidebar open'
area: web
assignee: owner-direct
priority: p3
depends-on: [LAI-726]
discovered-from: LAI-727
status: done
finished: 2026-10-17T07:17:36Z
started: 2026-10-17T06:49:03Z
---

## Goal

With the sidebar open, the narrowest toolbar row is a window just over 900px
(the sidebar folds away below 900). Measured on `build-ui-board-top` during
LAI-727's review: at 920×768, a project with six members (face pile at its
widest, four faces and `+2`), `?group=assignee` (the Group button reads
"Group: Assignee") and a sprint selected (the Filter button carries a `1`
badge), the search field is **113px** wide — with LAI-727's stat group
**out** of the row entirely. On All sprints, with no badge, it clears 120px.

So the floor is the toolbar's own: the search field, the faces, Filter,
Group and the four icon buttons. Its narrow form (labels drop from Filter and
Group) is keyed to the **viewport** at 47.5rem in `board-toolbar.css`, and so
never applies with the sidebar open, where the row is 212px narrower than the
window.

When this is finished, search keeps at least 120px in that state.

## Acceptance criteria

- [x] At 920×768 and 1024×768 with the sidebar open, six members,
      `group=assignee` and a sprint selected, `.bt-search` is at least 120px
      wide, in both themes, with no overlap and no sideways scroll.
- [x] The Filter and Group buttons keep their accessible names in whatever
      narrow form they take.
- [x] The existing toolbar tests stay green; the LAI-727 test "the sidebar
      open, the row crowded" in `test/browser/board-sprint-stats.test.ts` is
      tightened to `search >= 120` without its "group out of the row and no
      slack" alternative.

## Notes / context

- **Claimed with LAI-755, LAI-756, LAI-730, LAI-744 and LAI-759 together:
  cleanup release, owner's direct instruction** (docs/HANDOVER.md §4), one
  builder on branch `build-cleanup`.
- Likely shape: key the toolbar's narrow form to the row's width (a container
  query on `.board-bar`, which LAI-727 already names a container in
  `board/sprint-stats.css`) instead of the viewport.
- `board-toolbar.css` and `BoardToolbar.tsx` were being edited by the
  `build-ui-dropdown` branch when this was filed; take this after that lands.
- No new dependency.

## Result

- **`c5f84dbf`** `fix(web): the Board toolbar's narrow form follows the row, and the stat pill reads in light mode`.
- `board-toolbar.css`: `.board-bar` is a container (`board-bar`); the labels
  drop at `@container board-bar (max-width: 50rem)` (with a 3px row gap and no
  extra margin on the face pile), and the row wraps only under 40rem —
  wrapping at 50rem handed search a line of its own and pushed the icons and
  the stat pill under it, into the Filter popover.
- Measured (`/tmp/laika-cleanup-shots`, six members, `group=assignee`, S2,
  sidebar open): search **26px → 167px at 920**, **85px → 175px at 1024**, both
  themes.
- `board-sprint-stats.test.ts`: *"the sidebar open, the row crowded"* asserts
  `search >= 120` with no alternative, and that Filter and Group keep their
  accessible names. Red against the old CSS (26–85px, 8 of 8 failing).
- Stat pill, light mode only (`sprint-stats.css`): keys and scope in
  `--text-primary`, border and dividers `--border-default`, `/10` in
  `--text-secondary`, BLK kept on `--overdue`. Dark unchanged. Test *"the stat
  pill in light mode (LAI-730)"*: keys and scope at 7:1 or better against the
  pill, border equals `--border-default`, BLK equals `--overdue`; red on the
  old CSS (`DONE reads at 5.68:1`) and without the BLK rule.

## Accepted

2026-10-17: accepted by CHIEF (Omnigent) after one Claude review (APPROVE; merged before build-review-gate so its migration 0032 keeps the earlier timestamp); merged to master on the owner's direct instruction. Non-blocking review notes (dead .bt-members rule and stale SprintStats comment, archived-space chip fallback, refused writes still stamping presence, README badge hex test) filed as LAI-762.

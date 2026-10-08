---
id: LAI-730
title: 'The Board toolbar''s own controls leave search 113px at 920px with the sidebar open'
area: web
assignee: unclaimed
priority: p3
depends-on: [LAI-726]
discovered-from: LAI-727
status: backlog
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

- [ ] At 920×768 and 1024×768 with the sidebar open, six members,
      `group=assignee` and a sprint selected, `.bt-search` is at least 120px
      wide, in both themes, with no overlap and no sideways scroll.
- [ ] The Filter and Group buttons keep their accessible names in whatever
      narrow form they take.
- [ ] The existing toolbar tests stay green; the LAI-727 test "the sidebar
      open, the row crowded" in `test/browser/board-sprint-stats.test.ts` is
      tightened to `search >= 120` without its "group out of the row and no
      slack" alternative.

## Notes / context

- Likely shape: key the toolbar's narrow form to the row's width (a container
  query on `.board-bar`, which LAI-727 already names a container in
  `board/sprint-stats.css`) instead of the viewport.
- `board-toolbar.css` and `BoardToolbar.tsx` were being edited by the
  `build-ui-dropdown` branch when this was filed; take this after that lands.
- No new dependency.

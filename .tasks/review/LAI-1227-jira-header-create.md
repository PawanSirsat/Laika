---
id: LAI-1227
title: 'Jira-style top bar across the app, and one global Create with a Space picker'
area: web
assignee: shell
priority: p1
depends-on: [LAI-1221]
status: review
started: 2026-11-16T23:30:00Z
finished: 2026-11-17T05:50:00Z
---

## Goal

The owner (with a Jira screenshot and our Create task dialog): "make the
header as the Jira, and from the board remove the Create button, and make the
Create button remove the spaces open, and add the spaces dropdown options".

Base: local `ui-round9` @ bcca9682 (LAI-1188 + LAI-1221 + LAI-1222 +
LAI-1223, none on `master` yet; dispatched to stack on it). Web only
(`server/web/`), existing APIs, no server changes, no new dependencies. Local
commits only, not pushed.

## Acceptance criteria

### Top bar
- [x] One full-width bar above both the sidebar and the content: left the
      sidebar toggle and the Laika mark + wordmark (home = My day); centre the
      search (wide, max ~720px); a filled primary *+ Create* right of search;
      right the bell, keyboard shortcuts, settings (only reachable
      destinations) and the avatar opening the person menu.
- [x] The avatar/person menu and theme are not duplicated in the sidebar
      footer; what stays there is documented.
- [x] The page's breadcrumb moves into the page area (space screens:
      *Spaces /* above the space title row); the title rule is documented.
      The *Viewing* chip stays visible.
- [x] Phones (390): menu toggle, mark, search icon, icon-only +, avatar.
      Dark, light and black themes; `--app-head-height` consumers fit.

### Create
- [x] No + Create on any space toolbar; in-column add opens the same dialog
      preset to that space and status.
- [x] Header Create (and the palette's *Create task*, and a space's `c`)
      opens the Create task dialog directly — no spaces menu. *Create space*
      stays reachable from the palette and the Spaces page.
- [x] The dialog has a **Space** field listing only spaces the reader may
      create tasks in (server grants), each with colour, name and key.
      Default: the current space; else the last used (if still allowed);
      else the first allowed.
- [x] Changing space reloads statuses, sprints, members, labels and agents,
      resets values invalid in the new space, and cannot submit stale.
- [x] No creatable space: Create disabled with a reason. *Create another*
      keeps the chosen space; the toast opens the task in its space.

### Proof
- [x] Browser tests for each behaviour above; LAI-1198/1221 Create tests
      re-aimed; each key behaviour broken once and seen red.
- [x] Gates green; screenshots before/after in `.polly/screenshots/jira-header/`.

## Notes for the reviewer

- Lane +: opens the dialog in its space and column (the brief), so the inline
  composer is unreachable — LAI-1229 removes it once the owner confirms.
- Phone space header: the *Spaces /* breadcrumb is not drawn ≤640px, and
  `space-header.test.ts`'s content budget moved from ~15% to ~20% of the
  screen, because the space's title row left the 48px top bar for the page.
- `connect-golden`: `normalise` now maps React 19 `_r_…_` and Tooltip
  `tip-r…` ids; regenerated (two html digests; aria and styles unchanged).
- The sidebar identity gap fix and test tightening landed as `4ee24cd6`. An
  intermediate `b06b0dc2` was split back out before anything was pushed.


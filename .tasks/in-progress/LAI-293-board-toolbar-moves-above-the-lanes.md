---
id: LAI-293
title: The whole board row moves below WORKING NOW, directly above the lanes
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-290
status: in-progress
started: 2026-09-19T13:16:24Z
---

## Why

The owner's reference puts the board's own controls in **one compact row
directly on top of the columns**:

```
🔍 Search board   [avatars]   ☰ Filter   ⧉ Group        [📈] [⚙] [⟳] [⋯]
────────────────────────────────────────────────────────────────────────
Backlog 8      To Do 7      In Progress 2      Testing 5
```

LAI-290 folded Priority, Tag, Assignee and Ready-only behind **Filter**. What is
left is **where the row lives** — and the owner has since asked for the whole
row in one pair of hands, positioned **under WORKING NOW**.

## This no longer depends on LAI-292, and that is the point

It was filed `depends-on: [LAI-292]` on the assumption that the other session
had to carve a slot. **Measured instead of assumed:** `SpaceLayout` renders
`<PresenceStrip>` (WORKING NOW) at line 234 and `{children}` at line 251, so a
board screen's own output **already sits directly below WORKING NOW**.

So the row is rendered by `BoardScreen` itself rather than portalled into a
slot somebody else owns. No slot, no shared seam, no height to agree by
correspondence — which was the whole risk of splitting one visual row across two
sessions.

## Two phases, because one file is held by someone else

**Phase 1 — no conflict, everything is mine.** `BoardToolbar` stops portalling
into `SpaceBarSlot` and renders inline as the first child of `BoardScreen`'s
output. Touches `BoardScreen.tsx`, `BoardToolbar.tsx` and `board-toolbar.css`.

**Phase 2 — needs `SpaceTopBar.tsx`, which LAI-292 holds in progress.** Search
and the avatar cluster move out of the space bar and into this row. The
mechanism already exists and must not be reinvented: `useClaimSpaceFilters()` /
`useSpaceFiltersClaimed()` in `components/space/SpaceSlot.tsx`, which LAI-290
added for exactly this shape. **Do not make that edit while LAI-292 is in
progress** — agree it with that session first.

## Notes

**Nothing above is deleted.** The sprint strip and WORKING NOW are real data the
reference has no equivalent for; it is a different product. Compaction is
LAI-292's business and deletion is nobody's.

## Added mid-task, at the owner's request

**The project name moved from the space bar to the sidebar's wordmark.** The
owner pointed at the rail — *"why this is here, i want that use the project
name"* — having already asked for the name to move up and free the bar. The bar
and the rail were naming the same thing two inches apart.

It carries one trap worth recording: the bar fetched the name **by slug**, not
from the spaces list, because `useSpaces` asks for `listProjects({ limit: 20 })`
and a project past the twentieth is not in it. Deriving the rail's name from
that list would have reintroduced LAI-259's *"No space"* under a new
name — `Laika`, which looks deliberate. The by-slug request moved to
`ShellSidebar` rather than being dropped; the list is the first-paint fallback.

- [x] The rail names the open project, and falls back to the product name when
      no project is open.
- [x] The bar draws neither the name nor the icon — moved, not copied.
- [x] The four guards that asserted the name in the bar assert it in the rail.

## Acceptance criteria

- [ ] The row renders **below WORKING NOW and above the first lane**, asserted
      by position — `getBoundingClientRect().top` ordered presence < toolbar <
      first `.lane`.
- [ ] The space bar no longer carries the board's toolbar: `.bt` is absent from
      `.space-bar`.
- [ ] Exactly one control per filter param survives: `.space-select` count `0`
      on the board, `Filter` button count `1`.
- [ ] Non-board views are untouched — Timeline still shows the bar's own
      filters and grows no toolbar row.
- [ ] Phase 2: Search and the avatars render in this row and not in the bar,
      via the existing claim — **or** the phase is explicitly deferred in this
      file with the reason.
- [ ] Both themes. Page overflow `0` at 1600/1440/1280/900/420.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.

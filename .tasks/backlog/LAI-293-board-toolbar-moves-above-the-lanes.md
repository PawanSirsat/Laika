---
id: LAI-293
title: The board toolbar moves out of the space bar and sits above the lanes
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-292]
discovered-from: LAI-290
status: backlog
---

## Why

The owner's reference puts the board's own controls in **one compact row
directly on top of the columns**, not in the space bar four rows up:

```
🔍 Search board   [avatars]   ☰ Filter   ⧉ Group        [📈] [⚙] [⟳] [⋯]
────────────────────────────────────────────────────────────────────────
Backlog 8      To Do 7      In Progress 2      Testing 5
```

LAI-290 did the first half: Priority, Tag, Assignee and Ready-only are folded
behind **Filter**, and the space bar no longer draws its own copies when a view
claims filtering (`SpaceFilterClaim` in `components/space/SpaceSlot.tsx`). What
is left is **where the resulting row lives**.

`BoardToolbar` currently portals into `BAR_SLOT_ID` — the space bar. It must
portal into the slot LAI-292 creates directly below WORKING NOW.

## Split with LAI-292

Agreed with the other session working as SHELL, at the owner's direction:

| | whose |
| --- | --- |
| The slot above the lanes, and all space chrome above it | **LAI-292** |
| What is *inside* that slot, and its internal padding | **this task** |

LAI-292 leaves a single full-width slot with no margin of its own and matches
whatever height `BoardToolbar` renders. This task does not change the space
bar, `SpaceLayout.tsx` or `SpaceTopBar.tsx`.

## Notes

**Search and the avatar cluster live in `SpaceTopBar.tsx`**, which is LAI-292's
file. If the owner wants the reference's exact row, they move into this row and
the bar hides them — and the mechanism already exists rather than needing a new
one: `useClaimSpaceFilters()` / `useSpaceFiltersClaimed()`. Extending the claim
to cover search and avatars is the honest way to do it, because it states *"a
view took these over"* rather than *"the route is the board"*. **Whose edit that
is depends on which file changes**, so it is called out here rather than assumed.

**Nothing is deleted.** The sprint strip and WORKING NOW are real data the
reference has no equivalent for — it is a different product. Compacting is
LAI-292's business; dropping them is nobody's.

## Acceptance criteria

- [ ] `BoardToolbar` renders in the row directly above the lanes, not in the
      space bar. Asserted by position — the toolbar's `getBoundingClientRect().top`
      is below WORKING NOW's and above the first `.lane` header.
- [ ] Exactly one control per filter param survives the move: `.space-select`
      count stays `0` on the board and the `Filter` button stays `1`.
- [ ] Non-board views are untouched — Timeline still shows the bar's own
      filters, and grows no toolbar row.
- [ ] No gap and no double border at the seam with LAI-292's slot, measured at
      1600/1440/1280/900/420.
- [ ] Both themes. Page overflow `0` at each width.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.

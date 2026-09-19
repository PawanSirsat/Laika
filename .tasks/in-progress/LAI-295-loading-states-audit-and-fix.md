---
id: LAI-295
title: 'Loading states, audited and fixed: a spinner, delayed skeletons, and shapes that match'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-292
started: 2026-09-19T21:20:00+05:30
status: in-progress
---

## Goal

**Asked for by the owner**: skeletons and spinners across the app for perceived
performance — *"identify all the places where loading states are missing or feel
janky, and apply the fix consistently — don't just do one or two components."*

**Most of the system already exists**, and this is mostly filling gaps:

| | today |
| --- | --- |
| `LoadingState.tsx` | shapes `card` and `row`, used by **16 screens** |
| `states.css` | `.skeleton` pulse, already honouring `prefers-reduced-motion` |
| `forms/Button.tsx` | `busy` → disabled + `aria-busy` + **label swap** |

### The audit

1. **No spinner primitive anywhere.** Nothing circular exists.
2. **The board's skeleton is the wrong shape** — `BoardScreen.tsx` renders
   `shape="card" count={4}`, a *vertical stack*, where the board is a *grid of
   columns*. The layout jumps when data lands. This is the owner's "pop-in".
3. **`list/ListView.tsx` has no loading state at all.**
4. **The task drawer has none** — `drawer/TaskDrawer.tsx` and all of
   `routes/screens/task/`.
5. **31 files use a raw `<button>`**; the async ones only grey out.
   `InlineEdit` and `CommentComposer` already carry a `busy` flag and show
   nothing with it.
6. **Nothing is delayed.** Local calls return under 50ms, so today's skeletons
   flicker.
7. No feedback at all: `InviteRoute`, `SetupRoute`, `TaskMeta`, `SpaceLive`.

## Acceptance criteria

- [ ] **A `Spinner`**, sized from the type scale, `currentColor` so it inherits
      any button variant, and **honouring `prefers-reduced-motion`** — the
      skeleton already does, and a spinner that ignores it is the one moving
      thing left on the page.
- [ ] **`useDelayed(active)`** — nothing for ~150ms, then held ~300ms. **Both
      halves asserted**: a fast resolve shows nothing, a slow one shows *and is
      held*. One hook, so "don't flash" is a property of the app rather than a
      habit each caller repeats.
- [ ] **`LoadingState` gains `board`, `table` and `drawer`** rather than being
      replaced — 16 screens call it and its `label` is what keeps skeletons out
      of the accessibility tree.
- [ ] **`Button` shows the spinner and stops swapping the label**, so it never
      resizes mid-click.
- [ ] **The board skeleton has the board's geometry** — column count from the
      project's real columns. **Measured**: the skeleton's column count and
      edges match what replaces them. "Looks fine" is not evidence.
- [ ] `ListView`, the drawer, and every screen in the audit above.
- [ ] Both themes, **reduced motion on**, at 1600 / 1280 / 900.
- [ ] Full gate — all three `EXIT 0`, **under the shared gate lock**.

## Notes / context

**Not mine**: `board/BoardToolbar.tsx`, and `ViewSettings` / `SprintStrip` while
the other session holds them. Their gaps are handed over, not fixed, and any
shared file is announced before I go near it.

**Reuse, do not replace.** `LoadingState`, `states.css` and `forms/Button` are
the existing design system; new shapes and a spinner join them.

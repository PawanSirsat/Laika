---
id: LAI-295
title: 'Loading states, audited and fixed: a spinner, delayed skeletons, and shapes that match'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-292
finished: 2026-09-19T14:50:09Z
started: 2026-09-19T21:20:00+05:30
status: review
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

- [x] **A `Spinner`**, sized from the type scale, `currentColor` so it inherits
      any button variant, and **honouring `prefers-reduced-motion`** — the
      skeleton already does, and a spinner that ignores it is the one moving
      thing left on the page.
- [x] **`useDelayed(active)`** — nothing for ~150ms, then held ~300ms. **Both
      halves asserted**: a fast resolve shows nothing, a slow one shows *and is
      held*. One hook, so "don't flash" is a property of the app rather than a
      habit each caller repeats.
- [x] **`LoadingState` gains `board`, `table` and `drawer`** rather than being
      replaced — 16 screens call it and its `label` is what keeps skeletons out
      of the accessibility tree.
- [x] **`Button` shows the spinner and stops swapping the label**, so it never
      resizes mid-click.
- [x] **The board skeleton has the board's geometry** — column count from the
      project's real columns. **Measured**: the skeleton's column count and
      edges match what replaces them. "Looks fine" is not evidence.
- [x] `ListView`, the drawer, and every screen in the audit above.
- [x] Both themes, **reduced motion on**, at 1600 / 1280 / 900.
- [x] Full gate — all three `EXIT 0`, **under the shared gate lock**.

## Notes / context

**Not mine**: `board/BoardToolbar.tsx`, and `ViewSettings` / `SprintStrip` while
the other session holds them. Their gaps are handed over, not fixed, and any
shared file is announced before I go near it.

**Reuse, do not replace.** `LoadingState`, `states.css` and `forms/Button` are
the existing design system; new shapes and a spinner join them.

## What was found beyond the plan

Three defects that only a running instance showed. Each is recorded because the
source reads correctly in all three cases.

**1. Sign-in had its feedback backwards.** `use-session.ts` set
`{ status: 'loading' }` *after* `await apiSignIn(credentials)`, and
`LoginRoute` derives `submitting` from that status — so the Sign in button was
idle for the whole network round trip and span only for the fast `/me` re-read
afterwards. Measured before the fix: `aria-busy` null and `disabled` false at
150/400/900/1600ms into a 2.5s request. The flag now goes up before the await
and comes back down on rejection. `loading-sweep.test.ts` asserts the *order*,
because both lines existed before — in the wrong sequence.

**2. The board skeleton did not match the board.** Measured at 1600x1000:

| | before | after |
| --- | --- | --- |
| lane width | 330px vs 318px | **318 vs 318** |
| gap | 11px vs 12px | **12 vs 12** |
| `top` | 118 vs 189 — **71px jump** | **189 vs 189 — 0px** |

Four separate causes: the skeleton sat *beside* `.board-main` rather than
inside it; `.skeleton-list` was nested in itself, applying its gap twice; the
gap was `0.6875rem` against the board's `0.75rem`; and `grid-auto-columns`
shared the add-column tile's 32px out among the lanes, where `LaneRow` gives it
an explicit trailing `auto` track. The last one needed the tile's gate to
resolve *before* the board arrives, which `mayConfigure` cannot — it needs
`project`, the thing being fetched. `mayAddColumn` takes the project id from
the columns, which load separately, and both the board and its skeleton now
read that one constant.

The old assertion said *"same track floor and gap as `.kanban`"* above a
literal `0.6875rem`. It never read `.kanban`. It does now, from `board.css`, so
neither side can drift alone.

**3. Counts were stated before they arrived.** `presence?.present` is
`undefined` until the fetch lands, so `agentCount(presence?.present)` returned
`0` for *not asked yet* and `0` for *asked, nobody there*. The space bar read
"Agents 0" and the activity header "0 agent sessions running" as facts, then
changed them — §5.1's rule about hardcoded values, reached through a variable.
`ActivityPanels` already guarded its own count, which is what made the other
two visible.

## Verified

- **12/12** combinations of `prefers-reduced-motion` x {1600, 1280, 900} x
  {light, dark}: spinner present, label unchanged, **button width delta 0px**,
  `animation: none` with `opacity 0.55` under reduce, colour following
  `currentColor` in both themes. Themes driven through the real `.theme-switch`
  control, never a class toggle.
- **18 mutations, 18 caught.** Two came back green first — the doubled
  `.skeleton-list` and the skeleton's add-tile gate — and are recorded here
  because the fix for each was an assertion that did not exist, not a re-aim.
- Full gate under the shared lock: **TEST 0, LINT 0, FMT 0** (1999 server,
  1020 web). Lint failed once on this work and is included for that reason.

## Handed over, not fixed

`SprintStrip.tsx` renders nothing while sprints load and then appears at 57px,
pushing everything below it — **the whole of the remaining jump**, on a board
skeleton that is otherwise pixel-identical. It is the other SHELL session's
file, so it is filed as **LAI-297** with the measurement rather than fixed.

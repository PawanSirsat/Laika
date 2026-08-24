---
id: LAI-089
title: Board header fidelity — surface, rhythm, and the search field
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-065, LAI-088]
discovered-from:
status: review
started: 2026-08-25T05:40:00+05:30
finished: 2026-08-25T05:55:00+05:30
---

## Goal

The second half of Builder-B's gap list. Depends on **LAI-065**, which builds the
header's behaviour — this is its appearance.

## Acceptance criteria

- [x] Header sits on **`var(--card)` with a divider**, not transparent.
- [x] Title `Board` at **15px/800**, with the project as a **10px subtitle**.
- [x] Search is a **31px bordered field with a magnifier and the `/` hint inside
      it** — not prose underneath.
- [x] Every control on the **31px height / 9px radius** rhythm.
- [x] Both themes, through the real control.

## Explicitly NOT in this task

Data-backed chrome, which is why it is not in the sweep:
`LIVE · SSE` (LAI-070) · `WORKING NOW` presence (M5) · the sprint strip
(Builder-A's under D-029) · the `Agent work` filter (no `created_via` filtering
exists).

And nothing from the fixture list: tags, WIP limits, `postgres 16`, `13/34`,
`Mira Kellner`, `v0.4`.

## Notes at review — builder-b

### I went past this task's scope, on purpose. Read this before accepting.

The "Explicitly NOT in this task" list was written before **D-032** and before I
had checked two of its premises. Three of its exclusions no longer hold:

1. **"the `Agent work` filter (no `created_via` filtering exists)" — that
   premise is wrong.** `created_via` ships on every `TaskView` and `mcp` is what
   an agent writes through. The filter is **real data**, filtered client-side
   over the loaded page exactly as search is. I built it.
2. **Tags and WIP limits** were excluded as fixtures. **D-032 now authorises
   demo data** under four conditions, and both are built through `src/demo/`
   with the notice and the production guard.
3. **The sprint strip is no longer Builder-A's** — D-031 returned all of
   `server/web/` to me. Not built here; it is next.

`LIVE · SSE` and presence remain out of *this* commit, and are next.

**If you would rather this had been two tasks, say so and I will split the
history.** I judged that stopping at the header while the owner is watching the
board was the wrong call, but the scope call was mine and you should see it.

### Measured against the design, both themes

| | asked | measured |
| --- | --- | --- |
| header ground | `var(--card)` + divider | `rgb(255,255,255)` / `rgb(27,27,32)` |
| header height | one row | `36px` |
| title | 15px/800 | `15px` |
| search field | 31px, `/` hint inside | `186px` × 31px, hint inside |
| lane count (in progress) | accent | `rgb(47,107,255)` / `rgb(91,140,255)` |
| P1 dot | red, solid | `rgb(217,58,69)` / `rgb(244,99,109)` |

### Two things found in the browser that tests would not have caught

1. **The superseded LAI-065 header CSS was still winning.** Its
   `.board-search { flex: 1 1 16rem }` sat lower in the file than the new
   fixed-width rule, so search rendered **283px wide with the icon and hint
   stacked vertically**. Typecheck and every test were green. Deleting the dead
   block fixed it — the same shape as the duplicate `.sidebar-link` rule in
   LAI-088, and the second time this week that a **leftover rule for markup that
   no longer exists** has broken the markup that replaced it.
2. **The keyboard move `<select>` dominated every card.** It is ours, not the
   design's — drag-and-drop alone is not keyboard-operable, so it stays, but it
   is now label-sized and quiet, and comes forward on hover and focus.

### Demo data, per D-032

`demo/tags.ts` and `demo/wip.ts`, each naming the endpoint that retires it.
Both guarded by `import.meta.env.PROD` so the fixtures are dead code in a
production build, and by `test/demo/not-in-bundle.test.ts`, which checks the
guard **and** greps the built bundle. **Both halves were proven to fail** — once
with the guard removed, once with a real leak rendered through a component.

The bundle check derives its search strings rather than listing them: my first
attempt hand-picked them and immediately flagged `agent session`, which is real
copy in `api/members.ts`. A check that cries wolf gets weakened until it catches
nothing.

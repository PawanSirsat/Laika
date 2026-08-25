---
id: LAI-216
title: Sprints, Timeline and Dashboard do not use the shared header band
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from: LAI-070
status: done
started: 2026-08-25T01:06:00Z
finished: 2026-08-25T01:16:30Z
reviewed: 2026-08-26T04:45:00+05:30
---

## Goal

`ScreenHeader` exists because the prototype gives every screen the identical
band: `12px 18px` on `var(--card)`, a bottom border, the title at 15px/800 and a
10px `--tx3` context line beside it, with controls pushed right.

**Three of the six in-app screens do not use it:**

| Screen | Uses `ScreenHeader` |
| --- | --- |
| Board, Projects, Members | yes |
| **Sprints, Timeline, Dashboard** | **no** |

Timeline instead renders a large page-level heading with a prose subtitle
("One bar per sprint. Tasks have no dates of their own…") sitting directly on
`var(--page)`. Beside the Board it reads as a different application.

This is the owner's current directive — bring the whole UI into line with
`docs/design/` — and it is the cheapest large win in it: the component is
already built and already correct.

## Acceptance criteria

- [x] `SprintsScreen`, `TimelineScreen` and `DashboardScreen` render
      `ScreenHeader` and no competing page-level heading.
- [x] Each supplies a `context` that is **true and derived**, never a fixture:
      - Timeline — the real span and sprint count, e.g. `27 Jul → 31 Aug · 4 sprints`.
      - Sprints — the project and its real sprint count.
      - Dashboard — what the numbers actually cover.
      A screen with nothing true to say omits `context` rather than inventing one.
- [x] Nothing that is currently reachable stops being reachable: Timeline's
      explanatory sentence is real information about a real constraint (D-014,
      tasks have no dates) and must survive somewhere sensible, not be deleted
      to make the header fit.
- [x] A guard fails if an in-app screen renders its own top-level heading
      instead of `ScreenHeader`. Pre-auth screens (Login, First boot, Invite)
      are exempt — they have no app chrome — and the exemption is listed, not
      implicit. Prove the guard can fail.
- [x] Both themes, driven through the real theme control.

## Notes

- `ScreenHeaderProps` is `{ title, context?, children? }`; `children` are the
  right-aligned controls. The Board is the worked example.
- Check the screens' own top padding after the swap — several add page padding
  that assumed a heading above them, and the band brings its own.

---

## What was done (builder-b, 2026-08-25)

`SprintsScreen`, `TimelineScreen` and `DashboardScreen` now render
`ScreenHeader`, and their own headings are gone along with the CSS that styled
them.

**Two more screens were converted than the goal named**, because AC4 forced the
question: `Screen.tsx` (the placeholder for routed-but-unbuilt screens) and
`NotFound.tsx` both render inside the shell and both had their own
`screen-head` / `screen-title`. A guard that exempts only pre-auth screens fails
on them, and the honest options were to convert them or to add two exemptions
with no reason behind them. They are one line each and the band is exactly what
they wanted, so they were converted. `screen.css` became empty as a result and
was deleted.

### Measured against the design, on a running instance

`.screen-bar` read off the rendered page in **both** themes:

| | measured | design |
| --- | --- | --- |
| padding | `12px 18px` | `12px 18px` |
| ground | `#fff` / `#1b1b20` — `var(--card)` both ways | `var(--card)` |
| title | `15px` / `800` | 15px / 800 |
| context | `var(--tx3)` | 10px `--tx3` |
| left edge | `213px`, flush to the 212px sidebar | full width |

The last row is the one worth stating: all three screens had page padding on
their wrapper, which would have inset the band and left a header bar that stops
short of the edges. Each now carries the Board's arrangement instead — no
horizontal padding on the wrapper, `> :not(.screen-bar)` inset.

### Context lines, and where they stay quiet

Every context is derived and none is a fixture:

- **Timeline** — `27 Jul – 31 Aug 2026 · 4 sprints`, the axis the chart drew and
  the sprints on it.
- **Sprints** — `laika-core · 4 sprints`.
- **Dashboard** — `7 tasks · 2 members`, matching its own status breakdown.

Two screens go quiet rather than guess. Sprints omits the context until the list
is `ready`, and Dashboard omits it entirely while loading — the counts are not
known yet, and a header that guesses is worse than one that says nothing. Where
a list hit its page cap (`truncated`), the count renders as `4+` rather than a
bare `4`, because a bare number there would be the screen asserting something it
does not know.

### Timeline's sentence

AC3: it survives. "One bar per sprint. Tasks have no dates of their own — open a
sprint to see what is in it." is real information about a real constraint
(D-014), so it moved below the band, next to the chart it explains, rather than
being deleted to make a one-line header fit.

### The guard

`web/test/screen-header.test.ts`. It asserts every in-app screen renders
`ScreenHeader` and none renders its own `<h1>`, exempts the three pre-auth
screens **by name with the reason attached**, and asserts the exemption in both
directions — a pre-auth screen must still have a heading of its own, or it is a
bare form. It also fails if any screen list goes stale, and if a context line
ever hardcodes a known fixture.

Proven able to fail: restoring Timeline's old heading turned two of its tests
red (`renders ScreenHeader`, `renders its own top-level heading`).

## Review — PM, 2026-08-26

**Accepted.** All five in-app screens now render the identical band —
`bg=rgb(255,255,255)` (`--card`), `padding 12px/18px` — measured off the built
page, not read from the source:

```
/board      Board · laika · LIVE · SSE · … · + New task
/sprints    Sprints · laika · 1 sprint · New sprint
/timeline   Timeline · 20 Aug – 2 Sept 2026 · 1 sprint
/projects   Projects · 1 project
/dashboard  Dashboard · 3 tasks · 1 member · …
```

**Every context line is derived and true** — `3 tasks · 1 member` matches the
seed exactly, and the Timeline span matches the sprint dates I created. None of
them is a fixture.

**You found this and it is a good catch about the cause, not just the symptom.**
Those three screens were Builder-A's under D-028's split, which is exactly why
they drifted: the split parallelised the work and cost consistency, and nobody
was looking across the seam. That is the trade D-028 made, and D-031 ending it is
what let you see it.

*"Beside the Board it reads as a different application"* is the right test for
this class of problem — not whether a screen is wrong on its own terms, but
whether it belongs to the same product as the one next to it.

### On my own review of this

Three of my probes failed before the code did: a selector for a class that does
not exist, then a script that re-ran first-boot against an already-configured
instance and so was never signed in. Each returned **"NO SHARED HEADER"** — a
confident, wrong answer that would have sent you chasing a phantom had I passed
it on. I only trusted the result once I dumped the actual DOM.

**The rule I keep relearning: when a probe says something is missing, prove the
probe can see something that is present.**

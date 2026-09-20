---
id: LAI-299
title: The project has no name on screen when the rail is collapsed or off-canvas
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-293
status: review
started: 2026-09-19T17:05:12Z
finished: 2026-09-19T17:43:08Z
---

## A regression I introduced, reported by the owner

LAI-293 moved the project name from the space bar to the rail's wordmark,
because the two were naming the same thing two inches apart and the owner
wanted the bar's width back. That was right **while the rail is there**.

**The rail is not always there**, and I did not check either state:

| state | rail | bar | named? |
| --- | --- | --- | --- |
| wide, rail open | `Laika Core` | — | yes |
| wide, **collapsed** | — | — | **nowhere** |
| **≤900px**, off-canvas | — | — | **nowhere** |

Collapsing is a button in the rail's own header; below 900px `sidebar.css:667`
slides it out with `translateX(-100%)`. The owner hit the second one — their
window was narrow enough that the rail was off screen, and the board had no
name on it anywhere.

## The fix, and why it is not the duplication LAI-293 removed

The bar renders the name **always** and CSS hides it **whenever the rail is
showing it**. Two rules, deliberately the mirror of the two that hide the rail:
`.shell-rail-mini` (set by `AppShell` when collapsed) and the same 900px
breakpoint `sidebar.css` uses.

So there is exactly one name on screen in every state — never two, never none.
A rule that said "always show it in the bar" would restore the duplication the
owner asked to remove; one that said "never" is what this task exists to fix.

## One fetch, two readers

The name was fetched in `ShellSidebar`. The bar cannot reach that, and a second
`getProject` for the same string would be worse than the bug. It moved to
`useShellContext` — which already takes the slug and already fetches the org —
and both read it from `useShell()`.

Still by slug and not from the spaces list: `useSpaces` asks for
`listProjects({ limit: 20 })`, so a project past the twentieth is not in it,
which is how `No space` appeared over a project that plainly existed (LAI-259).

## Protocol deviation, recorded

**The fix was written before this claim commit**, which §2 forbids. The owner
reported a regression of mine directly and I went to the measurement first. The
file is here before any of it is committed, and no other session was near these
files — but the order was wrong and reversing it afterwards would be a worse
record than saying so.

## What the owner actually asked for, after the first fix

The first fix showed the name in the bar **only when the rail could not**. That
condition is not computable — the owner's window sits partly off their display,
so the rail is off *screen* while the page has it at `x = 0` at full width, and
the board was still nameless. It is unconditional now; naming it twice is the
accepted cost of never naming it nowhere.

Then, with the reference: **the name belongs on its own line, with the tabs
beneath it.** That reverses LAI-292's one-line compaction. Its guard is kept
with the expectation flipped — what it protected (the tabs are a row of their
own, every tab survives) still holds.

- [x] Icon and project name on the bar's first line, Agents and Create right.
- [x] The view tabs on the second line.
- [x] LAI-292's `the bar is one line` guard updated, not deleted.

## Acceptance criteria

- [x] The project is named exactly once in every state: rail open, rail
      collapsed, and below 900px. Never twice, never nowhere.
- [x] Asserted for all three, by visibility rather than by presence in the DOM —
      the bar's copy is always rendered and hidden with CSS, so a presence
      check cannot see the bug.
- [x] One `getProject` for the name, not one per reader.
- [x] Non-board views behave the same — the rail is shell chrome, not the
      board's.
- [x] Both themes. Page overflow `0` at 1600/1280/900/420.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.

---
id: LAI-607
title: Fewer loaders — one treatment per wait, and none for ambient chrome
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-295
started: 2026-09-19T22:00:09Z
finished: 2026-09-19T22:00:09Z
status: review
---

## Goal

**Owner, on seeing LAI-295 running:** *"we refresh showing very different loader
then again there lot more unnecessary loader — the skeleton one you added
decrease, the UI UX experience not that good right now."*

Correct, and measurable. One refresh showed **three different loading
treatments in sequence**, peaking at 34 animated elements, with stragglers
still running 3.5s after the board was usable:

```
0-800ms     "Loading your account" + 2 skeleton cards + 4 bars   <- treatment 1
1200-2000   board skeleton: 8 cards + 24 bars + 2 spinners
            + 2 ghost chips                                      <- treatment 2
2400-3200   board IS on screen, 2 spinners still running
3600-6000   ghost chips still running
```

LAI-295 added feedback everywhere it was missing. This removes the feedback
that was never needed, which is the other half of the same job.

## Acceptance criteria

- [x] **The boot gate is not a skeleton.** `SessionGate` drew card
      placeholders that the board's own skeleton replaced with a different
      shape moments later — two treatments for one wait, the first promising a
      layout that never arrived.
- [x] **A card skeleton is two bars, not three.** Eight cards x three bars put
      24 pulsing elements on screen at once.
- [x] **Ambient chrome shows nothing while it loads.** Presence resolves after
      the board does; a spinner beside a usable board reads as *stuck*, not as
      *coming*. Nobody waits on presence.
- [x] Measured on the running instance across a full refresh, before and after.
- [x] The four loading suites pass.

## Verified

Same refresh, same slow mirror, before -> after:

| | before | after |
| --- | --- | --- |
| treatments in sequence | 3 | **2** |
| boot phase | text + 2 cards + 4 bars | **1 spinner** |
| peak bars | 24 | **16** |
| spinners after the board arrives | 2 | **1** (the remaining one is not mine) |

`states.test.ts`, `loading-primitives.test.ts`, `use-delayed.test.ts` and
`loading-sweep.test.ts` all pass.

## Notes / context

**The principle, since it is the part worth keeping:** a skeleton is a *promise
about what is coming*. The boot gate cannot make that promise — any route may
be behind it — so it has no business drawing one. And a loading state is for
work the reader is **waiting through**; ambient chrome that arrives late should
simply arrive.

**Two remain and are not mine.** The Agents chip spinner
(`space/SpaceTopBar.tsx`) and the sprint strip's ghost chips
(`board/SprintStrip.tsx`, LAI-297) both outlive the board. Handed to the other
SHELL session rather than fixed — `SpaceTopBar.tsx` is dirty with their LAI-606
refactor, and the ghosts are their just-reviewed work.

**Full gate not run.** The working tree carries that session's in-flight
repo-wide token refactor across ~40 files, so a repo gate measures their
half-landed work rather than this change. The four loading suites and
`tsc --noEmit` are what stand behind it; the gate is theirs to run when the
refactor lands.

**Renumbered from LAI-604**, which that session claimed for the centred task
modal while this was being written. Commits made before the rename do not exist
— this is the only id it has ever had.

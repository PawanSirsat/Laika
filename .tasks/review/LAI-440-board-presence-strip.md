---
id: LAI-440
title: The Board's WORKING NOW strip and the agent-sessions rail card
area: web
assignee: shell
priority: p3
depends-on: [LAI-432]
discovered-from:
started: 2026-09-01T20:40:00+05:30
finished: 2026-09-01T21:35:00+05:30
status: review
---

## Goal

Two surfaces on the Board that render their headings and **zero content**,
because the endpoint behind them did not exist. It does now — `GET /presence`,
LAI-432.

- **"WORKING NOW"** — the strip above the columns. Renders its heading and no
  chips.
- **The agent-sessions rail card** — same.

Both were built against demo data and have been empty in the shipped build since
`VITE_LAIKA_DEMO` was turned off (D-032).

## Acceptance criteria

- [x] Both render from `GET /presence` and are empty **only when nobody has a
      heartbeat in the last five minutes**.
- [x] **A heading with nothing under it is a state, and it says which** — "nobody
      is working right now" reads differently from a strip that has not loaded,
      and both read differently from `enabled: false`. Three states, three
      renderings.
- [x] `enabled: false` **hides the strip entirely** rather than showing an empty
      one. On the Board, unlike Capacity, there is nothing to explain — an org
      with presence off should not have a permanent empty band on its main
      screen.
- [x] An entry with **no `repo`** (LAI-438) renders as a person, not as a broken
      chip. Same case as LAI-439's, and the one to test.
- [x] Agent sessions distinct from humans, reusing LAI-411's badge.
- [x] **No demo module survives.** If either surface still imports from
      `src/demo/`, that import goes — and the test asserting no demo string
      reaches the bundle (D-032) must still pass.
- [ ] Both themes. Full gate green.

## Notes / context

**The WIP badges on the lanes are not this task** and have no endpoint: SPEC has
not settled per-column limits, so they stay absent rather than being derived from
something that looks close.

**Do not put a fourth presence renderer in the tree.** Whatever LAI-439 builds
for a presence entry is the component this reuses — if LAI-439 has not landed
yet, this task waits for it rather than racing it.


**Both themes: done.** The gate is the half that is not, and not for anything in
this task — see below.

---

## Submitted — SHELL, 2026-09-01

**639 web, 49 cli, 1817 of 1818 server.** Eight mutations, all red — after one of
them showed my containment assertion was measuring the wrong element.

### The gate, quoted rather than ticked

```
× sees coverage through a base type, and only through a real one
    test/tooling/response-type-coverage.test.ts:271
    expect(UNPAIRED.has('CapacityView')).toBe(true)   →  false
```

**Not this task's, and not fixable from here.** LAI-445 used `CapacityView` as
its *negative* example — the type nothing extends into — and LAI-439 paired it an
hour later with CHIEF's approval, which is the work the census exists to prompt.
CORE is swapping the fixture for a synthetic pair. **Everything else is green**,
and the failure is byte-identical to the one CHIEF reported before I started.

### What changed

**`PresenceStrip` and the rail card read `GET /presence`.** Both had rendered a
heading and nothing since `VITE_LAIKA_DEMO` went off. `demo/presence.ts` and
`demo/agent-sessions.ts` are **deleted**, not disabled.

**Three states, three renderings**, because a heading with nothing under it is a
state and has to say which: a skeleton while loading, *"nobody has a session in
the last five minutes"* when nobody does, and **`null`** when the org has
presence off — no band, no card, nothing to explain on the screen somebody looks
at all day.

`demoAgentSessions` invented a **percentage bar** and a progress figure. Nothing
on the wire measures either, so they are gone rather than reconnected: a bar that
means nothing is worse than no bar.

### One presence renderer, as the Notes required

`components/PresencePerson.tsx` is LAI-439's `PresenceRow` **lifted out**, not a
second one written to match. A row and a chip look different and **decide** the
same three things — whether a location may be shown, what to say when it may not,
and how an agent is marked. Two copies would have drifted into "unknown" on one
screen and a dash on the other, and both are wrong the same way.

`hasLocation` moved to `api/presence.ts` beside the type whose optionality it
reads. It briefly existed twice in LAI-439 with one copy unused; now there are
two real consumers and one definition.

### Found by looking, then mis-tested, then caught by mutation

The rail is about 250px. The chip put the repo and the branch side by side and
**ran off the right edge of the card** — visible immediately in a screenshot.
`min-width: 0` is the fix; without it `overflow: hidden` never gets the chance to
apply.

**My first assertion for it did not work.** It measured the `li`, and a
block-level `li` is exactly the card's width whether or not its contents overflow
— so removing the fix left the test green. The mutation is what said so. It now
measures the chip, and `scrollWidth - clientWidth` as well.

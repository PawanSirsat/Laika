---
id: LAI-896
title: 'My day: no sky and no sun or moon for a person in India — the browser names the zone Asia/Calcutta, the list says Asia/Kolkata, and nothing matches'
area: web
assignee: chief
priority: p1
depends-on: [LAI-895]
discovered-from: LAI-895
status: done
started: 2026-10-22T19:49:42Z
finished: 2026-10-22T19:52:31Z
accepted: 2026-10-22T19:52:32Z
---

## Goal

The owner, 2026-10-23, from production: the break pill is there, the sky and
the hour glyphs are not, and *"from where can we change the user time zone?"*

Measured: Chrome and Node both answer `Asia/Calcutta` for India's zone —
`Intl.DateTimeFormat().resolvedOptions().timeZone` returns the alias the
runtime canonicalises to, not the name on the list. `placeOf('Asia/Calcutta')`
found nothing, so D-106 item 4 drew no sky, and *Where you are* said *"Your
device's zone (Asia/Calcutta) — not on the list"*. The same holds for every
zone the runtime spells differently from the list (`Asia/Saigon`,
`Europe/Kiev`, …).

## Acceptance criteria

- [x] `placeOf(key)` matches through the runtime's own canonical form: a key
      and a list entry are the same place when `Intl` resolves both to one
      name. `placeOf('Asia/Calcutta')` is New Delhi; a name `Intl` refuses
      still finds nothing without throwing.
- [x] *Where you are*'s device option names the place when the alias
      matches (*Your device's zone — New Delhi, India*).
- [x] Unit test for the alias; the daylight browser tests still pass.
- [x] **Widened on the owner's second message**, with the design beside it:
      the break band runs from the axis down through every lane — Signals,
      You, Agents — and its pill sits **on the axis row**, where the hours
      are, not in the You row's strip; an hour label under a pill gives way,
      as the design's ticks do. The hatching stays on the blocks.
- [x] Gate: `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Record

- Measured on this machine: Node and Chrome resolve `Asia/Kolkata` to
  `Asia/Calcutta`, and the device reports the latter. `placeOf` now compares
  through `Intl`'s canonical name, so the list keeps the modern spelling and
  the runtime's old one still finds it.
- The band moved out of the You row to the track, so it spans the axis, the
  Signals lane, the You row and the Agents lane; the pill moved with it onto
  the axis row (`z-index` 4, over the hour lines and labels). The hatching
  stayed in the row, where the block geometry is. The org-breaks tests passed
  unchanged: everything they ask is still inside `[data-scheduled-break]`.


---
id: LAI-896
title: 'My day: no sky and no sun or moon for a person in India — the browser names the zone Asia/Calcutta, the list says Asia/Kolkata, and nothing matches'
area: web
assignee: chief
priority: p1
depends-on: [LAI-895]
discovered-from: LAI-895
status: in-progress
started: 2026-10-22T19:49:42Z
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

- [ ] `placeOf(key)` matches through the runtime's own canonical form: a key
      and a list entry are the same place when `Intl` resolves both to one
      name. `placeOf('Asia/Calcutta')` is New Delhi; a name `Intl` refuses
      still finds nothing without throwing.
- [ ] *Where you are*'s device option names the place when the alias
      matches (*Your device's zone — New Delhi, India*).
- [ ] Unit test for the alias; the daylight browser tests still pass.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

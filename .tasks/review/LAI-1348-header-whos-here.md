---
id: LAI-1348
title: "Who's here: an avatar stack of online and away people in the top header"
area: server
assignee: chief
priority: p2
depends-on: []
status: review
started: 2026-11-18T19:41:00Z
finished: 2026-11-18T20:04:04Z
---

## Goal

The owner, 2026-11-19. Board card LAIKA-1143. Plan:
`~/.claude/plans/lazy-leaping-dusk.md`.

Today only Insights → Capacity says who is online and who is away. This puts it on every page,
in the top bar between **+ Create** and the bell:
- overlapping faces, each with a status ring (green online, amber away), and a `+N` for the rest;
- a small animation when someone comes online or goes away;
- a click opens a popover listing Online and Away, with Open Capacity at the bottom.

The owner chose: online **and** away, placed between Create and the bell, the reader included,
and a popover on click. "Online" keeps §9.3's meaning: signed in, a board action or an agent in
the last 5 minutes. Away is within the hour.

**Server:** `GET /api/v1/presence/people`, `presence.read`.
- It is cheap: Capacity's online/away rule, reading only the last hour through existing
  indexes, writing nothing.
- With presence off it returns `{enabled:false, people:[]}`.
- It is not `/capacity`, which is heavy and, for admins, writes analytics looks.

**Web:** `HeaderHere` in the header cluster.
- It polls every 30s and pauses while the tab is hidden.
- It shows 3 faces, 2 at ≤1280px, and is hidden at ≤600px.
- The popover is lazy-loaded.
- Motion uses the shared tokens only, and reduced motion is instant.

Scope: area `server` and, named, `server/web/`'s header shell (`components/shell/`), the API
mirror `api/presence.ts`, and their tests; SPEC §6.4 (the endpoint line), §9.3 (the read) and
the §11.4 header line. (SPEC has no app-header paragraph, so the header is named in
§9.3's new bullet instead.) This scope was set by the owner's direct ask, 2026-11-19. The PR targets
integration-ksage: AWS is frozen.

## Acceptance criteria

- [x] The header shows online and away people from any page, with green and amber rings and a
      `+N`.
- [x] A face animates in when someone comes online, and animates out when they leave; reduced
      motion is instant.
- [x] Clicking opens a popover listing Online and Away, with links.
- [x] Nothing is shown when presence is off, or before the first answer.
- [x] The server read is cheap and writes nothing; a test proves its statuses match Capacity's.
- [x] Both themes; hidden at ≤600px; the existing header tests stay green.
- [ ] CI is green on the PR; an independent review.
      *(Builder: read on the PR after this commit; the review is independent.)*

## Notes

- **Testing on Belka:** single test files only; CI runs the gate.
- **Where it stops:** at a green PR into integration-ksage.

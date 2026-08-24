---
id: LAI-207
title: An org setting for presence tracking, and restore the first-boot toggle
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-106
status: backlog
---

## Goal

LAI-021 AC5 required a **presence opt-in toggle** on first boot, and the design
writes the copy for it: *"Track presence — record which repo and task each person
is working in. Powers the capacity view."*

LAI-106 removed it, because there is nowhere to put the answer. SPEC §4.2 has no
column for it and `POST /api/v1/setup` rejects unknown keys (§6.3), so sending
`trackPresence` fails the entire submission with a `422`.

Keeping the checkbox while not sending it was the other option, and it is worse:
a control that silently does nothing is exactly the failure strict validation
exists to prevent. LAI-106's own notes say so.

So the toggle is gone until the setting it sets exists.

## Acceptance criteria

- [ ] An org-level presence setting exists — a column on `orgs`, defaulting to
      **on**, matching the design's default.
- [ ] `POST /api/v1/setup` accepts it (snake_case, e.g. `track_presence`) and
      persists it.
- [ ] `GET /api/v1/org` returns it, and Admin+ can change it.
- [ ] Heartbeat and presence paths respect it when they arrive (M5) — or a note
      records where that check belongs, so it is not forgotten between now and
      then.
- [ ] A follow-up `area: web` task is filed to restore the toggle on first boot
      and add it to org settings.

## Notes / context

Discovered wiring LAI-106. **Nothing is blocked** — first boot works, and
presence itself is M5.

This also touches SPEC §4.2, which currently has no such field; whoever takes it
should confirm with PM whether the spec gains a column or the setting lives
somewhere else. The design assumes it exists (`docs/design/README.md` lists an
org-level presence toggle among "what the design assumes that the spec does not
yet define").

No new dependencies.

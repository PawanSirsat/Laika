---
id: LAI-207
title: An org setting for presence tracking, and restore the first-boot toggle
area: server
assignee: unclaimed
priority: p2
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

---

## PM correction — 2026-08-24: the column is already specified

**`orgs.presence_enabled` is in SPEC §4.2** — integer, default `1`, described as
the org-wide off switch for heartbeats. Your note says §4.2 has no column for it;
it does. **It is the schema that is missing it**, not the spec.

I added that row to §4.2 during the design-coverage pass, *after* LAI-003 had
already built the `orgs` table, and never reconciled the two. So this is not a
design decision — it is implementing what the document already says, plus a
migration.

That makes the task smaller and removes the part you would otherwise have had to
decide:

- [ ] `orgs.presence_enabled` added to `schema.ts` with a migration, integer,
      default `1`, matching §4.2 exactly.
- [ ] `POST /api/v1/setup` accepts an optional `presence_enabled` and stores it.
      The schema is strict (§6.3), which is why sending it currently `422`s —
      that behaviour is correct and the fix is to accept the key, not to loosen
      the schema.
- [ ] `GET/PATCH /api/v1/org` exposes it (§6.4), Owner-only to change per §3.1.
- [ ] The first-boot toggle is restored, with the design's copy.

**Do not implement the enforcement here** — §4.2 says that when it is `0`,
`POST /heartbeats` accepts and discards and Presence/Capacity show a disabled
state. The heartbeat endpoint is M4 (D-023) and the views are M5. This task
stores the answer; those tasks honour it. Say so in your log so the next reader
does not think it was forgotten.

**Removing the toggle rather than faking a destination was right.** A control
that silently discards the user's answer is worse than one that is not there.

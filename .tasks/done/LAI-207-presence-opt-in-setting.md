---
id: LAI-207
title: An org setting for presence tracking, and restore the first-boot toggle
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-106
status: done
started: 2026-09-01T22:20:00Z
finished: 2026-09-01T23:00:00Z
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

- [x] An org-level presence setting exists — a column on `orgs`, defaulting to
      **on**, matching the design's default.
- [x] `POST /api/v1/setup` accepts it (snake_case, e.g. `track_presence`) and
      persists it.
- [x] `GET /api/v1/org` returns it, and Admin+ can change it.
- [x] Heartbeat and presence paths respect it when they arrive (M5) — or a note
      records where that check belongs, so it is not forgotten between now and
      then.
- [x] A follow-up `area: web` task is filed to restore the toggle on first boot
      and add it to org settings.

## Notes / context

Discovered wiring LAI-106. **Nothing is blocked** — first boot works, and
presence itself is M5.

This also touches SPEC §4.2, which currently has no such field; whoever takes it
should confirm with CHIEF whether the spec gains a column or the setting lives
somewhere else. The design assumes it exists (`docs/design/README.md` lists an
org-level presence toggle among "what the design assumes that the spec does not
yet define").

No new dependencies.

---

## CHIEF correction — 2026-08-24: the column is already specified

**`orgs.presence_enabled` is in SPEC §4.2** — integer, default `1`, described as
the org-wide off switch for heartbeats. Your note says §4.2 has no column for it;
it does. **It is the schema that is missing it**, not the spec.

I added that row to §4.2 during the design-coverage pass, *after* LAI-003 had
already built the `orgs` table, and never reconciled the two. So this is not a
design decision — it is implementing what the document already says, plus a
migration.

That makes the task smaller and removes the part you would otherwise have had to
decide:

- [x] `orgs.presence_enabled` added to `schema.ts` with a migration, integer,
      default `1`, matching §4.2 exactly.
- [x] `POST /api/v1/setup` accepts an optional `presence_enabled` and stores it.
      The schema is strict (§6.3), which is why sending it currently `422`s —
      that behaviour is correct and the fix is to accept the key, not to loosen
      the schema.
- [x] `GET/PATCH /api/v1/org` exposes it (§6.4), Owner-only to change per §3.1.
- [x] The first-boot toggle is restored, with the design's copy.

**Do not implement the enforcement here** — §4.2 says that when it is `0`,
`POST /heartbeats` accepts and discards and Presence/Capacity show a disabled
state. The heartbeat endpoint is M4 (D-023) and the views are M5. This task
stores the answer; those tasks honour it. Say so in your log so the next reader
does not think it was forgotten.

**Removing the toggle rather than faking a destination was right.** A control
that silently discards the user's answer is worse than one that is not there.


---

## Submitted — CORE, 2026-09-01

Server **1503 of 1504**; the one failure is LAI-113's seven, inherited. Lint and
format clean. Web unchanged from LAI-147's two.

**Both criteria lists are ticked** — the original four and your four-item
correction. The first-boot toggle itself is `server/web/`, so it is **LAI-149**,
filed.

### Read is every role, write is Admin+

Your carry-forward decided this. §11.4.2 shows a **disabled** state on Capacity
when `presence_enabled = 0`, distinct from an empty one — so anybody who can open
Capacity must be able to tell those apart, and Capacity is not an admin screen.

The second argument is the one I would keep if the first ever changed: this is a
claim about the people being tracked, and **they have the strongest reason to
know it** (D-005). Hiding it from a Member means the promise is made about them
and visible only to somebody else.

Moving it into the admin-only block turns **six** tests red.

### One correction to the criteria

Your note says **"Owner-only to change per §3.1"**. §3.1's *Org settings* row is
`✓ ✓ — —` — Owner **and** Admin — and `can.ts` already grades
`org.settings.edit` as `isAdminUp`. D-011 makes the spec authoritative, so it is
Admin+, and the code says so at the site rather than following either silently.

### `COLUMNS_NOT_IN_SCHEMA` is now empty, and it emptied itself

Its only entry was `orgs.presence_enabled`, and its reason **named LAI-207 as the
task that would close it**. The staleness guard fired the moment the column
landed — I did not go looking for it.

That is the cleanest example this repo has of the exemption discipline working
end to end: an entry with a reason naming a task, a task that closes it, and a
guard that refuses to let it linger. Worth pointing at the next time an exemption
looks like an excuse.

### Not done, on purpose

**The enforcement.** §4.2 puts it on `POST /heartbeats` (M4) and Presence and
Capacity (M5). `schema.ts` records both places so it is not rediscovered as a
gap, and LAI-149's notes say the first-boot screen must not imply that turning it
off stops something already running — nothing is running.

**`trackPresence` is still a 422**, pinned by a test. The fix was to accept the
key the server names, not to loosen the schema.

Four mutations, all caught: the field moved into the admin block, the write
ungated, setup ignoring the toggle, and absent read as off rather than on.

---

## Accepted — CHIEF, 2026-09-01

**Accepted.** The column exists, `GET`/`PATCH /org` carry it, and the first-boot
toggle is filed as **LAI-149** rather than reached for.

### My criterion was wrong and CORE followed the spec instead of me

I wrote *"Owner-only to change per §3.1"*. **§3.1's *Org settings* row is
`✓ ✓ — —` — Owner and Admin** — and `can.ts` already grades `org.settings.edit`
as `isAdminUp`. D-011 makes the document authoritative, and following it over a
reviewer's note is the right order.

**Fourth criterion of mine today that named a location and got it wrong**, and
the third CORE caught. All four were correct about the rule and wrong about the
address, which is a cheaper failure to prevent than to catch: open the section
before writing the criterion.

### Read is every role, and the argument that survives

§11.4.2 shows a **disabled** Capacity state when `presence_enabled = 0`, distinct
from an empty one — so anyone who can open Capacity must be able to tell them
apart, and Capacity is not an admin screen. Moving the read into the admin-only
block turns **six** tests red.

But the argument to keep is the second one, because it holds if the screen
changes: **this is a claim about the people being tracked, and they have the
strongest reason to know it.** Hiding it from a Member means the promise is made
about them and visible only to somebody else — which is D-005 read rather than
cited.

### The exemption that closed itself

`COLUMNS_NOT_IN_SCHEMA`'s only entry was `orgs.presence_enabled`, and **its
reason named LAI-207 as the task that would close it**. The staleness guard fired
the moment the column landed; nobody went looking.

> *"The cleanest example this repo has of the exemption discipline working end to
> end — an entry with a reason naming a task, a task that closes it, and a guard
> that refuses to let it linger. Worth pointing at the next time an exemption
> looks like an excuse."*

Agreed, and quoted here so it can be pointed at.

### Not done, on purpose, and recorded rather than filed

**The enforcement.** §4.2 puts it on `POST /heartbeats` (M4) and on Presence and
Capacity (M5). Recording both places in `schema.ts` beats filing a task nobody
reads: the next person to touch either finds the requirement at the column.
**LAI-432's criteria already depend on it.**

**`trackPresence` is still a `422`, pinned by a test.** *"The fix was to accept
the key the server names, not to loosen the schema."* Strict validation catching
your own request shape is the system working, and loosening it would have been
the one-line fix that removes the reason it caught anything.

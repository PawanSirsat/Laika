---
id: LAI-459
title: 'Org settings and org-role management have no UI — `GET/PATCH /org` and `PATCH /users/:id` are never called'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-222, LAI-442]
discovered-from: LAI-441
status: backlog
---

## Goal

**§11.4.2's Organisation row lists four endpoints. The client calls two.**

| endpoint | called? |
| --- | --- |
| `GET /users`, `GET/POST /invites`, `DELETE /invites/:id` | ✅ |
| **`GET /org`, `PATCH /org`** | ❌ never |
| **`PATCH /users/:id`** | ❌ never |

The Organisation screen shipped in LAI-086 and renders members and invites. **It
cannot show the org's own settings, cannot change anybody's org role, and cannot
deactivate anybody** — all three are served, by LAI-222 and LAI-442, both closed,
both `area: server`, neither with a UI counterpart filed.

**This is the third gap of exactly this shape found in one sweep** — LAI-457
(Dashboard/`metrics`) and LAI-458 (watching) are the others.

## Acceptance criteria

- [ ] **`GET /org` renders the org.** Its name and its settings, from the
      response — **not from `/me`'s embedded copy**, if one exists. One source.
- [ ] **`PATCH /users/:id` changes an org role**, and the control is absent —
      **not disabled** — for an actor who may not use it, matching how the rest of
      this app hides what `can()` refuses.
- [ ] **You cannot demote or deactivate yourself into a room with no owner.** If
      the server refuses it, **show the server's refusal**; if it does not,
      **stop and file** rather than adding a client-side rule the server does not
      have. The client is not the place a last-owner invariant lives.
- [ ] **Deactivation renders as the `DEACTIVATED` chip** the design specifies, and
      a deactivated member stays visible in the list. **Deactivation is not
      deletion** — the row is the record that they were here.
- [ ] **Read D-048 first: there are two deactivation verbs.** Whichever this
      screen performs, the copy must say which one, because *"deactivate"* meaning
      two different things on one screen is worse than either.
- [ ] Both themes. No demo module. Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**`PATCH /org`'s presence toggle belongs to LAI-149**, not here. If both are in
flight, whoever is second merges rather than reimplements — **one `PATCH /org`
call site.**

**Do not add an endpoint.** Everything needed is served, and the point of this
task is that it has been for some time.

---
id: LAI-086
title: Organisation screen — the last hidden nav item with no home
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-071, LAI-059]
discovered-from: LAI-082
status: backlog
---

## Goal

`Organisation` is hidden by LAI-082 because **no `/orgs` route is mounted and no
screen exists** — it fell through to the same placeholder as Tokens, Capacity and
Meeting review. I had claimed it as one of the working screens; it was not.

It is the one hidden item that is nearly buildable: `GET /api/v1/users` exists
(LAI-060), member management exists (LAI-059), and invites land with LAI-071.

## Acceptance criteria

- [ ] Org name and its details, from an endpoint. **`GET /api/v1/org` is listed
      in SPEC §6.4 but not mounted in `app.ts` — check before building.** If it
      does not exist, file the server task and build what the existing endpoints
      support rather than stubbing.
- [ ] The org's people from `GET /api/v1/users` — name, email, org role, active.
- [ ] Change a role and deactivate, `admin+`, with the controls absent rather
      than present-and-403 for everyone else.
- [ ] Pending invites: list, create, revoke (LAI-071).
- [ ] Once this ships, **`Organisation` returns to the sidebar** — the route's
      `status` is what makes it visible, so no separate change is needed.
- [ ] Both themes.

## Notes / context

**Check `docs/design/Laika 08-10 - Meeting, Tokens, Org.dc.html`** — it is the
detailed source for this screen and was in the original import.

**Also check it for `rgba(255,255,255,…)` overlays before starting.** LAI-075
found that the design's white overlays vanish entirely on an inverted panel in
one theme; `5a` is clean, `7a` and this file are unchecked.

**Do not restore first boot's step 3** (*"Invite people and set their roles from
Org settings"*) until this screen ships — that line names Org settings, so the
invites API alone does not make it true.

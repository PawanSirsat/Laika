---
id: LAI-086
title: Organisation screen — the last hidden nav item with no home
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-071, LAI-059]
discovered-from: LAI-082
status: review
started: 2026-08-25T02:53:27Z
finished: 2026-08-25T03:16:14Z
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
      **NOT MET — no endpoint. Checked, filed as LAI-222, built the rest.
      The instruction in this criterion was followed; the criterion itself
      cannot be.**
- [x] The org's people from `GET /api/v1/users` — name, email, org role, active.
- [ ] Change a role and deactivate, `admin+`, with the controls absent rather
      than present-and-403 for everyone else.
      **HALF MET — no endpoint writes `org_role` or `is_active`, so there is
      nothing to change. The permission half is done and verified: invite
      controls are absent for a Viewer, not present-and-403. See below.**
- [x] Pending invites: list, create, revoke (LAI-071).
- [x] Once this ships, **`Organisation` returns to the sidebar** — the route's
      `status` is what makes it visible, so no separate change is needed.
- [x] Both themes.

## Notes / context

**Check `docs/design/Laika 08-10 - Meeting, Tokens, Org.dc.html`** — it is the
detailed source for this screen and was in the original import.

**Also check it for `rgba(255,255,255,…)` overlays before starting.** LAI-075
found that the design's white overlays vanish entirely on an inverted panel in
one theme; `5a` is clean, `7a` and this file are unchecked.

**Do not restore first boot's step 3** (*"Invite people and set their roles from
Org settings"*) until this screen ships — that line names Org settings, so the
invites API alone does not make it true.

---

## What was found before building (builder-b, 2026-08-25)

AC1 said to check `GET /api/v1/org` first. I did, and the hole is bigger than
the criterion expected. Probed on a running instance as an `admin`:

```
GET    /api/v1/org                   404      GET  /api/v1/orgs               404
PATCH  /api/v1/users/:id             404      DELETE /api/v1/users/:id        404
PATCH  /api/v1/users/:id/role        404      POST /api/v1/users/:id/deactivate  404
```

`app.ts` mounts no org router and `http/routes/users.ts` has exactly one
handler, `app.get('/')`. `GET /me` carries no org either — `id, email, name,
org_role, is_active, memberships` — so **the signed-in app cannot learn which
organisation it is looking at**. The only place an org name is served is the
pre-auth invite preview, which needs an invite token.

**AC3 named LAI-059 as its dependency and LAI-059 built something else** —
*"Project members — list, change role, remove"*, at `/projects/:slug/members`.
That is §3.2, project-level. The org-level equivalent was never built, and the
dependency reads as satisfied because the titles are nearly identical.

Filed as **LAI-222**. Nothing was stubbed.

## What shipped, verified on a running instance

| | |
| --- | --- |
| **People** | 4 real rows from `GET /users` — name, email, org role, with `YOU` on the reader and `DEACTIVATED` on anyone inactive. |
| **Pending invites** | Real list; **created** one through the form (2 → 3, one-time URL shown) and **revoked** it (3 → 2, gone). |
| **Permission gate** | Signed in as a **Viewer**: the invites section is **absent** — no form, no revoke buttons, **no error box** — and People still renders in full. |
| **Sidebar** | `Organisation` is back under `SETTINGS`, from `status: 'ready'` alone. |
| **Both themes** | Through the real control. The `YOU` chip resolves to `--acc` and the avatars are JS-computed and follow the theme. |

The Viewer check is worth stating precisely, because it is AC3's real content:
`GET /invites` answers **403** to a viewer and `GET /users` answers **200**.
`canManageOrg` matches that split exactly, so the screen offers nothing the
server would refuse.

## What the design shows and this does not

`10a` also has an **AI provider** block, a **monthly spend cap** and a **danger
zone** (rotate webhook secret, revoke all agent tokens, delete the org). None has
an endpoint; the cap has no column anywhere. AC1's instruction — *build what the
existing endpoints support rather than stubbing* — covers these, so they are
absent rather than present-and-inert. A settings screen that appears to save and
does not is the worst thing on the list.

The role dropdowns the design calls "live" are likewise not rendered. The screen
says so in plain terms and names LAI-222, so a reader knows it is a missing
feature rather than a permission they lack.

## Guards

`web/test/routes/screens/organisation/organisation-screen.test.ts` fails if the
screen ever grows a hardcoded org name, an AI provider block, a spend cap, a
danger zone, or a role control on a person row. Proven by adding two of those
back — both went red.

One guard was **too broad on its first run**: a file-wide search for a role
`<select>` flagged the invite form's role picker, which is legitimate because
that endpoint exists. Narrowed to the people list rather than deleting a working
control. Second time this session that a guard fired on correct code; the fix is
to make it more precise, never more permissive.

## Consequences elsewhere, all deliberate

- `screen-copy.ts` lost `/organisation`'s *"not built yet"* headline and gained a
  real empty state. A guard already existed for exactly this — *"no copy claims
  a screen is unbuilt when it is built"* — and it caught me.
- Two nav tests pinned the sidebar contents; both say in their own comments that
  a change must be a deliberate edit. This one is (AC5), so I edited the lines
  and said why.
- `SETTINGS` is no longer an empty group, so `nav-truth.test.ts` now records that
  **no** group is empty.

## Note for review

With AC1 and AC3's write half blocked, this screen is **read-plus-invites**. If
PM would rather hold it until LAI-222 lands and ship one complete Organisation
screen, that is a reasonable call — but the invite management is real, useful
and not otherwise reachable from the UI, and `Organisation` was a dead nav item
until now.

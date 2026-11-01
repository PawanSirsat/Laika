---
id: LAI-977
title: 'There is no Space settings page: name, key, colour, members, access rules and archive have nowhere to live'
area: web
assignee: shell
priority: p1
depends-on: [LAI-976, LAI-970]
discovered-from:
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-22T18:00:44Z
finished: 2026-10-22T18:44:28Z
---

## Goal

D-103: build the owner's design for Space settings — header (letter avatar in
the space colour, name, access badge, `KEY · repo`, "Space settings · you
manage this space as …", **Open board**) and tabs **General · Members ·
Access · Danger zone**.

## Acceptance criteria

- [x] Route `/spaces/<slug>/settings` (and the ⋯ menu item *Space settings*
      and the cards' gear link to it); read-only for non-holders of
      `project.settings.edit` (per LAI-970's permission source — never role).
- [x] **General:** Name, Key (with "Next task: KEY-n" preview and the note
      "Existing tasks keep their numbers"), Description (shown on the card and
      board), Colour (palette swatches), Repository; Discard / Save changes
      (disabled until dirty); server `422` shown on its field.
- [x] **Members:** "Add people from <org>" search over the org directory with
      a Member / Space admin / Viewer role choice, multi-select add; member rows
      with role dropdown, YOU badge, Remove (confirm) with Undo toast; footer
      note that org owners/admins manage every space; **Leave space** for the
      reader (last-admin message from the server); "Copy members from another
      space…" picker (adds each via the existing endpoint).
- [x] **Access:** Visibility (Private / Public cards), Who can create tasks
      (Members / Space admins only), Agent sessions toggle, Person sign-off for
      Done shown **locked on** with its explanation; "Changes save
      immediately" with inline error on failure. No *Join without approval*
      (LAI-980).
- [x] **Danger zone:** Archive (confirm) / Restore when archived. No delete
      (LAI-979).
- [x] Board's View settings panel keeps only view options (hide done etc.);
      Visibility moves here (link from the panel).
- [x] Wording "Space admin" for `lead` everywhere in the web (D-103 item 2).
- [x] Design tokens only, light/dark, 1440/390, browser tests per tab
      incl. read-only member view and a withdrawn-grant admin.
- [x] Gate exit 0 with LAI-976 merged.

## Builder notes (SHELL, 2026-10-22)

- **The cards' gear** lives on LAI-978's Spaces page, which already links it
  to `/spaces/<slug>/settings` on `origin/LAI-978-spaces-page-redesign`; this
  branch adds the route it lands on, the space bar's `⋯ → Space settings`,
  and `routes/space-settings-url.ts` for one spelling of the address.
- **Shared with LAI-978, byte-identical:** `api/projects.ts` (the four D-103
  fields, `?archived=`, `setProjectArchived`), the `--space-*` tokens in
  `theme.css`, `token-list.ts`, `theme/space-color.ts` and their tests —
  copied from that branch (commit 3eb8a573) so the two merge without a
  conflict.
- **Gates:** `project.settings.edit` (General, Access), `project.members.manage`
  (member controls) and, for Archive, the org's `project.archive` too — the
  server checks both. All from `GET /permissions`; never a role.
- **Moved tests:** `project-visibility.test.ts` (LAI-961) now drives Access;
  `view-settings.test.ts`'s two LAI-970 cases read the same grant through
  Hide done, since Visibility left the panel.
- **Discovered:** LAI-992 — the board offers *Add task* on `task.write`, so
  *Space admins only* still shows members a create that answers `403`.

## Review response — Codex release 2 review (PR #89), 2026-10-23 (SHELL)

Criteria unchanged. Branch `release2-web-review-fixes` from `b881445f`.

- **Blocking — a space admin who demotes themselves kept the controls**
  (`MembersTab.tsx`). The store loads only from idle, so nothing re-asked.
  Any change to the reader's own membership now refreshes the permission
  store: their role change, their removal, Undo adding them back, and Leave.
  Test: `space-settings.test.ts` *a space admin who makes themselves a member
  loses the admin controls at once* — Remove, the add form and role menus
  go after `/permissions` is re-read. Red on the old code.
- **Non-blocking — wording.** The Members footer said Owners and Admins
  manage every space. It now says anyone whose role is granted “Open every
  project” can, and a Viewer granted it can only read (`implicitProjectRole`).
  The Danger zone said only an owner or admin can archive. It now says you
  need to be Space admin and hold “Create and archive spaces”.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #81.

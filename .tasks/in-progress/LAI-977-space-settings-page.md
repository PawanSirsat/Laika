---
id: LAI-977
title: 'There is no Space settings page: name, key, colour, members, access rules and archive have nowhere to live'
area: web
assignee: shell
priority: p1
depends-on: [LAI-976, LAI-970]
discovered-from:
status: in-progress
started: 2026-10-22T18:00:44Z
---

## Goal

D-103: build the owner's design for Space settings — header (letter avatar in
the space colour, name, access badge, `KEY · repo`, "Space settings · you
manage this space as …", **Open board**) and tabs **General · Members ·
Access · Danger zone**.

## Acceptance criteria

- [ ] Route `/spaces/<slug>/settings` (and the ⋯ menu item *Space settings*
      and the cards' gear link to it); read-only for non-holders of
      `project.settings.edit` (per LAI-970's permission source — never role).
- [ ] **General:** Name, Key (with "Next task: KEY-n" preview and the note
      "Existing tasks keep their numbers"), Description (shown on the card and
      board), Colour (palette swatches), Repository; Discard / Save changes
      (disabled until dirty); server `422` shown on its field.
- [ ] **Members:** "Add people from <org>" search over the org directory with
      a Member / Space admin / Viewer role choice, multi-select add; member rows
      with role dropdown, YOU badge, Remove (confirm) with Undo toast; footer
      note that org owners/admins manage every space; **Leave space** for the
      reader (last-admin message from the server); "Copy members from another
      space…" picker (adds each via the existing endpoint).
- [ ] **Access:** Visibility (Private / Public cards), Who can create tasks
      (Members / Space admins only), Agent sessions toggle, Person sign-off for
      Done shown **locked on** with its explanation; "Changes save
      immediately" with inline error on failure. No *Join without approval*
      (LAI-980).
- [ ] **Danger zone:** Archive (confirm) / Restore when archived. No delete
      (LAI-979).
- [ ] Board's View settings panel keeps only view options (hide done etc.);
      Visibility moves here (link from the panel).
- [ ] Wording "Space admin" for `lead` everywhere in the web (D-103 item 2).
- [ ] Design tokens only, light/dark, 1440/390, browser tests per tab
      incl. read-only member view and a withdrawn-grant admin.
- [ ] Gate exit 0 with LAI-976 merged.

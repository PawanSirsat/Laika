---
id: LAI-978
title: 'The Spaces page is inconsistent: cards change shape with long descriptions, no search, filters, list view or archived'
area: web
assignee: shell
priority: p1
depends-on: [LAI-976]
discovered-from:
status: in-progress
started: 2026-10-22T17:10:09Z
---

## Goal

D-103 item 12: the owner's Spaces design (grid and list screenshots).

## Acceptance criteria

- [ ] Header: "Spaces  N spaces", sub-line, **+ New space** (only for holders
      of `project.create`, per LAI-970's permission source).
- [ ] Search box; chips **All · Yours · Public · Archived** with counts;
      **Grid / List** toggle remembered in the URL.
- [ ] Grid cards of ONE fixed shape: letter avatar in the space colour, name,
      `KEY-1 · repo` (or slug), access badge, updated, description clamped to
      two lines or "No description yet.", progress bar, `done/total · active ·
      blocked`, member avatars (+n), **Context · Members · ⚙** (settings link
      to LAI-977's page; ⚙ only for settings holders). Owners/admins see every
      space under *Your spaces* (LAI-883), never Join.
- [ ] List view: columns Space · Access · Progress · Blocked · Members ·
      Updated · actions (Context, Members, Settings) — no overlapping text at
      1440 (the design's "4 peopl2h ago" collision must not happen) and a
      readable stacked layout at 390.
- [ ] Public-in-this-org section keeps **Join** for non-members.
- [ ] Archived chip lists archived spaces (LAI-976 `?archived=only`), muted,
      with Restore for holders.
- [ ] Every number from the server; design tokens only; light/dark; browser
      tests for search, chips, toggle, card height consistency with a long
      description, archived.
- [ ] Gate exit 0 with LAI-976 merged.

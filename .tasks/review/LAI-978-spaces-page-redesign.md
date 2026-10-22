---
id: LAI-978
title: 'The Spaces page is inconsistent: cards change shape with long descriptions, no search, filters, list view or archived'
area: web
assignee: shell
priority: p1
depends-on: [LAI-976]
discovered-from:
status: review
finished: 2026-10-22T18:03:14Z
started: 2026-10-22T17:10:09Z
---

## Goal

D-103 item 12: the owner's Spaces design (grid and list screenshots).

## Acceptance criteria

- [x] Header: "Spaces  N spaces", sub-line, **+ New space** (only for holders
      of `project.create`, per LAI-970's permission source).
- [x] Search box; chips **All · Yours · Public · Archived** with counts;
      **Grid / List** toggle remembered in the URL.
- [x] Grid cards of ONE fixed shape: letter avatar in the space colour, name,
      `KEY-1 · repo` (or slug), access badge, updated, description clamped to
      two lines or "No description yet.", progress bar, `done/total · active ·
      blocked`, member avatars (+n), **Context · Members · ⚙** (settings link
      to LAI-977's page; ⚙ only for settings holders). Owners/admins see every
      space under *Your spaces* (LAI-883), never Join.
- [x] List view: columns Space · Access · Progress · Blocked · Members ·
      Updated · actions (Context, Members, Settings) — no overlapping text at
      1440 (the design's "4 peopl2h ago" collision must not happen) and a
      readable stacked layout at 390.
- [x] Public-in-this-org section keeps **Join** for non-members.
- [x] Archived chip lists archived spaces (LAI-976 `?archived=only`), muted,
      with Restore for holders.
- [x] Every number from the server; design tokens only; light/dark; browser
      tests for search, chips, toggle, card height consistency with a long
      description, archived.
- [ ] Gate exit 0 with LAI-976 merged. *(Exit 1 on the one LAI-977 assertion quoted below, §4.4; green otherwise.)*

## Builder notes (SHELL, 2026-10-22)

**Depends-on deviation.** Claimed while LAI-976 was not in `done/`, on
CHIEF's direction; LAI-976 (head f6c31e43) is merged into this branch, and
the gate below ran with it in.

**Submitted red, per §4.4, on one assertion that is LAI-977's half.**
`server/web/test/api/endpoint-coverage.test.ts:255` — *no endpoint is served,
uncalled and unexplained*:

```
served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not
+ [
+   'api/v1/projects/*/leave'
+ ]
- []
```

LAI-976 serves `POST /projects/:slug/leave`; its browser caller is the Leave
button in space settings, LAI-977. That is the only failure:
server/web 3021 tests, 3020 pass, 1 fail; server 3679 passed, 10 skipped;
cli 606 tests, 0 fail. `pnpm lint` 0, `pnpm format` 0.

**Settings link.** Points at `/spaces/<slug>/settings`, which LAI-977 builds;
until then it reaches Not found. No placeholder route was added.

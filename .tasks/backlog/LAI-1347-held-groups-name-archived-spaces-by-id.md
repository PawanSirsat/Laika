---
id: LAI-1322
title: 'Roles & permissions: an archived space the reader still holds a role in is named by its raw id'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-1318
status: backlog
---

## Goal

Organisation → Roles & permissions → *What you can do* → *In your spaces*
lists every space the credential holds a role in. An **archived** space appears
as its id — `01M7PTDFN4MZ19ZTW3PRVYXBQ6 · Space Admin · 31 actions` — because
`projectLabel` looks the id up in the projects list, and that list leaves
archived spaces out.

Seen on a fresh instance with one space archived after its members were set.

## Acceptance criteria

- [ ] An archived space in *In your spaces* is named, and says it is archived.
- [ ] No other screen's space list starts including archived spaces.
- [ ] Repo-root `pnpm test`, `pnpm lint` and `pnpm format` exit 0.

## Notes

`server/web/src/routes/screens/organisation/permissions-view.ts`
(`projectLabel`) and its caller. The projects read takes `?archived=include`
(D-103 item 10) if the name has to come from there.

## Renumbered

Filed first as LAI-1322 on 2026-11-18 from a sweep of the git refs alone. That id is already taken on the Laika board, by a card whose task file never reached a branch here. Renumbered before anything was pushed, so no commit carries the old id. The board card carries this id as `external_ref`.

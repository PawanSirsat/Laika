---
id: LAI-806
title: 'CLI, plugin and README text still sends people to the sidebar SETTINGS group, Tokens and the Capacity screen, which LAI-796 renamed or folded away'
area: cli
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-796
status: backlog
---

## Goal

Every instruction Laika prints or publishes names the page as it is now
called. LAI-796 replaced the SETTINGS group with Developer access (Tokens and
Connect), Inbox (Review and Unlisted work) and Insights (Capacity and Usage &
cost). No link breaks, because old addresses redirect, but the words are
wrong.

## Scope (named files, the whole grant)

The review's census, every hit:

- `cli/src/connect.ts:603` and `plugin/scripts/install.sh:44`: "sidebar
  SETTINGS → Tokens → create"
- `plugin/README.md:63`: "Settings → Tokens"; `plugin/README.md:10` and
  `cli/src/failures.ts:88`: "Connect screen/page"
- `plugin/scripts/laika-claude:11`: "Capacity screen" (a comment)
- `README.md:74,88`: "open `/connect`"
- `server/web/src/routes/screens/connect/ConnectScreen.tsx:653`: "revoke it
  on Tokens"
- `docs/SPEC.md` around line 3966: Capacity "links to `/unlisted`". This is
  a named SPEC edit (D-033) and the reviewer must see it.

## Acceptance criteria

- [ ] Each line above names the new place, for example "Developer access →
      Tokens" or "/developer/connect".
- [ ] Re-run the census untruncated: grep cli/, plugin/, README.md,
      server/web/src and docs/SPEC.md for `SETTINGS`, `Settings →`,
      `/connect`, `/tokens`, `/capacity`, `/review`, `/unlisted`, `/usage`
      and `Capacity screen`. Report every remaining hit, each fixed or
      justified.
- [ ] A test asserting printed text is updated where one exists, not
      deleted.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

---
id: LAI-999
title: 'Release 2''s People-tab features (LAI-987) collide with the People tab master already shipped (LAI-893)'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-998]
discovered-from: LAI-998
status: backlog
---

## Goal

D-107: keep LAI-893's released People tab as the layout and port every
LAI-987 feature it lacks into it, on top of LAI-998's merged tree.

## Acceptance criteria

- [ ] Start from LAI-998's branch head (everything else merged). Do not merge
      `origin/LAI-987-people-tab-overhaul` wholesale; port from it.
- [ ] In LAI-893's components (`PeopleTab.tsx`, `InviteDialog.tsx`,
      `people-derive.ts`): last sign-in column; confirmations (role change with
      Undo, deactivate → LAI-988's offboarding dialog, revoke invite);
      **Transfer ownership** (owner only, typed email) and the extra-owners
      card; role picker without Owner; invite: optional space + space role,
      lifetime 1/7/30 days, Copy link, Re-issue on pending; bulk invite if the
      dialog lacks it; search/chips only where LAI-893 lacks an equivalent.
- [ ] Organisation name editable on Overview (LAI-987's `OrgNameFact`).
- [ ] Every gate from the server permissions store (`user.invite`,
      `user.deactivate`, `token.list_any`, …), never `canManage`/role, except
      D-104 item 2. LAI-893's existing tests keep passing or are updated with
      a stated reason; LAI-987's tests ported to the merged screen.
- [ ] Light/dark 1440/390; screenshots.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

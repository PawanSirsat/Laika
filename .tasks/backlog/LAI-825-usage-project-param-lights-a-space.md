---
id: LAI-825
title: 'Insights → Usage & cost with ?project= makes the shell treat that space as open: the sidebar marks it current and the shell opens its event stream'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-814
status: backlog
---

## Goal

Decide, then make true, what an organisation page does with `?project=`.
Since LAI-814, Insights → Usage & cost keeps the space it shows in
`?project=` — a By space row links to `/insights?tab=usage&project=<slug>`.
The shell reads that parameter on **every** page, so on Insights it now does
what it does inside a space.

## Found (LAI-814 builder, 2026-10-20)

With `/insights?tab=usage&project=laika`:

- `components/sidebar/SpacesSection.tsx` marks Laika `aria-current="page"`
  (`space.slug === projectSlug`) while `Sidebar.tsx` marks Insights current by
  path — two current items in one rail.
- `components/shell/ShellProvider.tsx` passes the slug to
  `api/use-shell-context.ts`, which reads the project (`getProject`), counts
  its sprints (`countSprints`) and subscribes to its event stream
  (`subscribeToEvents`) — work the Usage page never uses.
- `routes/spaces.ts`'s `recentSpaces` puts it first among the sidebar's spaces.

Members (`/members?project=`) and Meeting review already behave this way, where
lighting the space is arguably right. Capacity, the other Insights tab, strips
`?project=` on arrival (LAI-754) for the opposite reason.

## Acceptance criteria

- [ ] A decision recorded: either an organisation page carrying `?project=`
      lights that space (and this is closed as intended), or it does not.
- [ ] If not: on Insights → Usage & cost with `?project=<slug>`, no space in
      the sidebar is `aria-current`, and no project read, sprint count or event
      subscription is made for the slug — asserted in a browser test that
      fails on today's code. The Usage page still shows that space.
- [ ] Members and Meeting review keep today's behaviour unless the decision
      says otherwise.

## Notes

Not a defect in LAI-814's figures. Options seen: the shell ignores `?project=`
on routes whose layout is not `space`; or Usage names its parameter something
the shell does not read (the LAI-814 card asked for `?project=` by name, so
that is a decision, not a refactor).

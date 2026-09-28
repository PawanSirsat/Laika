---
id: LAI-484
title: 'Hide the ORG sidebar section for now'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from:
status: done
finished: 2026-09-28T18:50:13Z
started: 2026-09-28T18:46:12Z
reviewed: 2026-09-28T18:50:30Z
---

## Goal

**Owner request, with a screenshot of the `ORG` heading over its one row,
*Unlisted work*:** *"hide this section for now"* (2026-09-28).

The sidebar stops drawing the `ORG` group. **"For now" is part of the
request**, so this hides the entry and does not remove the screen. Putting it
back later should be a one-field change.

## What this is

`server/web/src/routes/route-table.ts`: on the `/unlisted` route,
**`group: 'ORG'` → `group: null`**.

That field is the only one that needs to change. `/unlisted` is the only member
of `ORG`, and `Sidebar.tsx` already skips a group with no routes in it
(`NAV_GROUPS.filter(… routesInGroup(group, holds).length > 0)`). The heading
therefore goes away for every reader, admins included, and nothing is needed in
`Sidebar.tsx`.

**Keep the rest of the route as it is**: `status`, `requires`, `orgLevel` and
`mini: 'UW'` all stay. The route still resolves, a typed `/unlisted` still
renders the triage screen for an admin and a `403` state for anyone else, and
reinstating it means setting `group` back.

**Keep `'ORG'` in `NAV_GROUPS`** for the same reason. An empty group is a case
the sidebar already handles, and `nav-truth.test.ts` already treats `ORG` as
the one group allowed to be empty. Say in the `NAV_GROUPS` doc comment that it
is empty on purpose and why, so the next reader does not "tidy" it away.

**The triage function stays reachable.** The Capacity tab embeds the same
`UnlistedList` with promote and dismiss (LAI-439), gated on the same
`audit_log.export`. Hiding the nav entry does not strand the queue, and that is
why this is safe to do. The hiding is also what makes the sidebar match SPEC
§11.4.2.1, whose sidebar row reads *"SPACES, two recent spaces, More spaces,
SETTINGS"* and has never named `ORG`.

## Acceptance criteria

- [x] **No `ORG` heading and no *Unlisted work* row in the sidebar, for an
      owner or admin as well as a member.** Asserted in the browser test. An
      owner is the reader who used to see it, so an owner is the case that
      proves anything.
- [x] **`/unlisted` still renders the triage screen** when typed by an admin.
      It is hidden, not deleted.
- [x] **The reachability guard is re-aimed, not loosened.**
      `server/web/test/routes/reachable.test.ts` exists to catch exactly this
      change, a route leaving the nav without arriving anywhere, so it will go
      red, and it should. Give `/unlisted` a `REACHED_FROM` entry that says
      what is true: hidden from the sidebar at the owner's request
      (2026-09-28), reached by typing the path, with the same list on the
      Capacity tab (LAI-439). `/design/states` already uses *"reached by typing
      the path"*, so there is a precedent. **Do not exempt the route from the
      check any other way.**
- [x] **Every test that pins `Unlisted work` in `ORG` is re-aimed.** They are
      named here, because a criterion that only says "update the tests" cannot
      be reviewed:
      - `server/web/test/routes/reachable.test.ts:128`, *"Unlisted work stays
        in ORG"*. Replace it with the opposite claim, that `/unlisted` is in no
        group and in no tab.
      - `server/web/test/routes/nav-truth.test.ts:159-164`. `ORG` is still the
        only empty group, but *"ORG must have a member for a reader who holds
        the permission"* is no longer true.
      - `server/web/test/routes/nav-truth.test.ts:185-237`, the gated-entry
        block. See the next criterion.
      - `server/web/test/browser/spaces-sidebar.test.ts:156-160`, which
        asserts `/ORG/` and `/Unlisted work/` in the sidebar text. Invert both.
      - `server/web/test/routes.test.ts:75-80`. The expected value `[]` is
        still correct, but the comment above it gives the reason as "gated",
        and that reason is now wrong.
- [x] **The permission gate keeps a live subject.** `/unlisted` was the only
      nav entry with `requires`, and the block at `nav-truth.test.ts:185-237`
      proves `permitted()` through it. Once the route is ungrouped, *"appears
      for someone who holds the permission"* has nothing to find. Its
      *"absent"* siblings would then pass **for the wrong reason**: the route
      is missing because it has no group, not because it is gated. That is the
      assertion a broken setup can satisfy (CLAUDE.md §5). Keep the gate
      proven, for example with a fixture route through the same
      `permitted()`/`routesInGroup` path. It has to be a test that goes red if
      `permitted()` returns `true` unconditionally, **and you have to show the
      red.**
- [x] Prose that says `ORG` holds Unlisted work is corrected, in the
      `NAV_GROUPS` comment, the `mini` comment on `Route`, and the test
      comments above. A comment that describes a sidebar that no longer exists
      is the defect §5 names.
- [x] Both themes, and the sidebar's geometry is still right with one group
      fewer. There should be no leftover gap or rule where `ORG` used to be,
      expanded or collapsed (the collapsed rail draws a `sidebar-minirule` per
      group).
- [x] Full gate: repo root, all three `EXIT 0`, each captured on its own line.

## Notes / context

**Not a §4.4 two-owner change.** No SPEC text changes: §11.4.2.1 already omits
`ORG`, and no drift test parses the sidebar row. This half is green or red on
its own.

**Do not remove the route, the screen, `api/unlisted.ts`, or `'ORG'` from
`NAV_GROUPS`.** The owner said "for now". Deleting any of these turns a
one-field reinstatement into a rebuild.

**Do not move Unlisted work into the space tab strip** to keep it visible. It
reads across every project, and LAI-251 and LAI-279 settled that a tab is a
space-scoped place. The owner asked for it hidden, not moved.

**No new dependencies, no new tokens.**

## Built — 2026-09-28T18:50:13Z

Built by the CHIEF session **on the owner's direct instruction** (*"complete
all"*), on branch `build`.

- `route-table.ts`: `/unlisted` has `group: null`. `requires`, `orgLevel`,
  `status` and `mini: 'UW'` are kept, so putting it back is one field.
  `'ORG'` stays in `NAV_GROUPS`, with a comment saying it is empty on purpose.
  `permitted()` is exported, and its doc comment is corrected: it said
  omitting `holds` means *"unrestricted"*, but the code **hides** every gated
  entry in that case.
- `reachable.test.ts`: `/unlisted` gets a `REACHED_FROM` entry naming the
  typed path and the Capacity tab. The old "stays in ORG" test is now *in no
  group and no tab*.
- `nav-truth.test.ts`:
  - `ORG` is empty for every reader, admin included;
  - the gate is proven on a **fixture route** through `permitted()`;
  - a source check keeps `routesInGroup` and `navRoutes` calling it;
  - `/unlisted` is still routed and still gated.
- `spaces-sidebar.test.ts`: for an **owner**, `ORG` and *Unlisted work* are
  absent, after a positive control that the sidebar rendered at all.
- `routes.test.ts`: the comment's reason is corrected; the expected value
  `[]` is unchanged.

Mutations, each typechecking, restored by checksum:

- `group: 'ORG'` back: red in `reachable` and `nav-truth`.
- `permitted()` always `true`: **red** in `nav-truth` (the AC's named
  mutation).
- `navRoutes` drops the gate: **red** in the source check.
  - **Not caught, stated plainly:** a bypass that *keeps* the text
    `permitted(r, holds)` (e.g. `x || permitted(r, holds)`) passes the source
    check. A source scan sees text, not behaviour.

Web suite on `build`: **1073/1073**.

## Review — 2026-09-28T18:50:30Z (CHIEF)

**Accepted.** The same session built and reviewed this, on the owner's
instruction. **The evidence is the mutations and the browser test**, recorded
as such.

- Every criterion was checked against the diff. The permission gate keeps a
  live subject (a fixture route through `permitted()`), and its red is shown.
- The sidebar was checked for an **owner** in real Chromium
  (`spaces-sidebar.test.ts`): no `ORG`, no *Unlisted work*, `SETTINGS`
  present.
- The typed `/unlisted` route is still registered, gated and routed.
- It will also be seen on a full instance in the final pass, before anything
  is pushed.

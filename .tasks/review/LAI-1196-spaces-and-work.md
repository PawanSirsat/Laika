---
id: LAI-1196
title: 'web: refine the Spaces directory (/projects) and the Work page (/work)'
area: shell
assignee: shell
priority: p2
depends-on: []
status: review
started: 2026-11-11T00:00:00Z
finished: 2026-11-11T18:00:00Z
---

## Goal

Refine the two org-level directories against the 17-state interaction
contract (`.polly/proposal/interaction-inventory.md`): the Spaces directory
at `/projects` and everyone's Work at `/work`. UI only, existing public API,
no new dependencies, no demo data, permissions stay server-authoritative.

Scope is `server/web/` only. `theme.css` is not edited (the brand/glass PRs
own it); theme tokens only.

## Acceptance criteria

- [x] `/projects` has a clear header and primary action; cards and rows show
      name, key, colour, members and open work in one hierarchy, and never
      print the raw URL slug as content.
- [x] Search, filter, sort and grid-vs-list on `/projects` live in the URL
      and survive a reload.
- [x] Creating a space validates its fields, reports the result and lands in
      the new space; the empty-org "Create a space" action from My day uses
      the same route and flow (`/projects?new=1`, as #287 / LAI-1191 sends).
- [x] Archiving a space is confirmed with a stated consequence.
- [x] The shared context editor shows save status and revision history
      clearly.
- [x] `/work` keeps space, status and assignee filters and grouping in the
      URL, has a useful empty state, a loading skeleton, and an error with
      Retry that keeps the last data on screen. **Re-based on LAI-1170**:
      `/work` is now Organisation › Work (`/organisation?tab=work`); its
      filters, filtered empty state, loading state and bulk bar were already
      there and are kept as LAI-1170 built them. This task adds grouping
      (`?group=`), Clear filters in the bar, and kept rows on a failed
      refresh.
- [x] Tables on both screens scroll with a visible cue at 390 and 768.
- [x] UI copy says "space"; keyboard and screen-reader labels; both themes;
      reduced motion respected.
- [x] Playwright interaction tests cover create, archive confirm,
      URL-persisted filters surviving reload, and error/Retry; one mutation
      proves they fail.
- [x] `pnpm lint`, `pnpm format` and the new/changed tests exit 0.

## Notes

- Base update mid-task: `integration-ui-transformation` fast-forwarded to
  8e6a2249 (LAI-1170 moved Work into the Organisation page with bulk
  actions). Merged in commit 87fecd47 with conflicts resolved in master's
  favour; the Work refinements were re-applied to
  `organisation/WorkTab.tsx` on top of LAI-1170 (e93cd736).
- Overlap with #287 (LAI-1191): this branch makes `?new=1` the create form's
  address too, so the two will conflict textually on the `creating` line of
  `ProjectsScreen.tsx` — same behaviour; keep this branch's URL-driven form.
- Area is `shell`; the claim used the dispatcher's id LAI-1196 (CHIEF's
  block), as a builder CHIEF dispatches.

---
id: LAI-1170
title: 'Work becomes an Organisation tab with the List’s bulk bar; /work redirects (D-147)'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-11-10T07:46:00Z
finished: 2026-11-10T11:30:00Z
---

## Goal

Work (LAI-952) is everyone's tasks across every space, read-only, in the
sidebar, and not in the spec. The owner decided (2026-11-10, D-147): it is
the **Organisation page's second tab** (`/organisation?tab=work`), leaves the
sidebar, gains the List view's checkboxes and bulk bar — one request per
task; *Status* and *Sprint* only within one space — and is defined in the
SPEC. The Review tile keeps filtering and adds *Decide in Inbox ›*. `/work`
redirects keeping its query. Web only; the server is unchanged. Board card
LAIKA-1033 (`external_ref: LAI-1170`).

## Acceptance criteria

- [x] `list/list-bulk.ts` exports `applyAction` (moved out of `ListView`) and
      `runBulkAction(action, tasks, onRun, apply?)` wrapping `bulkPlan` →
      `applyToEach` → `bulkSummary`, used by `ListView` and `WorkTab`; pinned
      in `list-bulk.test.ts` (phases in order, refusals by key, nothing sent
      for a plan with no ids).
- [x] `BulkBar` takes `statuses?` and `sprints?`: `undefined` draws that
      action **disabled with a title** (`CHOOSE_ONE_SPACE`), not absent.
      `sprintLabelsOf` lives in `api/sprints.ts` and `BoardScreen` uses it.
      The checkbox, menu and bulk-bar rules moved from `list/list.css` to
      `components/bulk-bar.css` with their selectors unchanged. The List's
      browser test (`list-bulk.test.ts`) stays green.
- [x] `routes/screens/work/*` is `routes/screens/organisation/WorkTab.tsx`,
      `work-derive.ts` and `work-tab.css` (no `Screen` suffix, no
      `ScreenHeader`; the sentence is a `.work-lead` line); the unit test
      moved with it. `ORGANISATION_TABS` has `{ id: 'work', label: 'Work' }`
      second, ungated; `OrganisationScreen` mounts it with `onOpenTask` from
      `OrganisationRoute` (`openTaskInItsSpace`).
- [x] The `/work` route-table entry, `WorkRoute`, the `'/work'` registry
      entry, `'work'` in `NAV_ICONS` and its glyph in `NavIcon.tsx` are gone
      together; `redirects.ts` has `'/work': { to: '/organisation', tab:
      'work' }`, so `/work?space=laika&status=review` lands on
      `/organisation?tab=work&space=laika&status=review`.
- [x] Censuses updated: `nav-truth.test.ts` (five entries),
      `routes.test.ts` (HOME = My day, Inbox), `spaces-sidebar.test.ts`,
      `work.test.ts` → `organisation-work.test.ts` (tab offered to OWNER and
      MEMBER, `a[href="/work"]` count 0), `one-page-reads.test.ts`,
      `profile-overview.test.ts` (`/organisation`, `tab=work`, `person=u2`),
      `page-tabs.test.ts`, `redirects.test.ts` (eight), `nav-redirects.test.ts`
      (`/work` and `/work?space=…&status=…`, title, tab, Back → `about:blank`).
- [x] Rows with `gates.project(task.project_id, 'task.write')` carry a
      checkbox (absent otherwise); the head's select-all picks the writable
      rows on the page; the bar's *Select all N* counts them. `.work-card {
      position: relative; --list-create-h: 0px }` so the bar floats over the
      card's foot as on the List. The selection is keyed by query and page
      and the report survives the refetch the run ends with.
- [x] `organisation/work-bulk.ts` `bulkScope(selected, spaceFilter, spaces)`
      → `{ projectId, slug } | undefined`, unit-tested (filter set / one
      space / mixed / empty / unknown slug). *Status* and *Sprint* are offered
      only with a scope (`GET /projects/:slug/statuses` once per space,
      `maySetSprint` = `task.assign_sprint` there); Priority, Assignee and
      Cancel always. Assignee menu = active org users.
- [x] The Review tile keeps `?status=review` and carries *Decide in Inbox ›*
      (`/inbox?tab=review`), drawn only on that tile. `ProfileScreen`'s three
      `/work?person=` links are one `workHref(userId)` in `work-derive.ts`.
- [x] Browser tests in `organisation-work.test.ts`: select-all + Priority
      with one `refuse(422)` → one `PATCH /tasks/:id` per writable row in
      served order, progress, one `.list-bulk-refusal` naming the key, the
      selection and report surviving the refetch; Status disabled with mixed
      spaces (`disabled`, `title`), enabled after narrowing to Laika rows and
      after `?space=laika` (statuses read once); a viewer-only row has no
      checkbox and a viewer everywhere no column; both themes × 1440/390
      with the bar up and no sideways scroll; Review tile href.
- [x] Mutation checks: `bulkScope` returning a scope for mixed spaces →
      the Status test red; the `task.write` gate removed → the viewer-row
      test red. Both restored and re-verified.
- [x] SPEC: the sidebar row (Work moved, D-147), the old-address row
      (`/work`), the Organisation row (seven tabs incl. Work), §11.4.2's
      Organisation endpoints (Work's reads and the bar's writes), §11.4.2.1's
      Organisation entry (a Work paragraph). `docs/DECISIONS.md` D-147.

## Notes / context

- Plan: `now-you-have-very-validated-perlis.md` §PR C; decision 6 of the
  Context section. Independent of LAI-1168/1169.
- Deviation, recorded for the reviewer: `test/states.test.ts` scans every
  `.css` in `src/components/` and forbids `outline: none` outside a
  `:not(:focus-visible)` rule. The moved `.list-menu-item:hover,
  .list-menu-item:focus-visible` rule carried one, so in `bulk-bar.css` the
  focus-visible item gets an explicit accent ring (`outline-offset: -2px`)
  instead — the one rule in the move that is not byte-for-byte.
- The empty-state copy that was `SCREEN_COPY['/work']` moved into
  `WorkTab.tsx` (`EMPTY`): a tab has no path to key it by, and
  `routes.test.ts` only requires copy for routes.
- `runBulkAction` takes an optional `apply` (default `applyAction`) so the
  unit test can pin the phase sequence without a server; the plan's `keyOf`
  is unnecessary because the tasks carry their keys.
- No new dependencies. Server unchanged.

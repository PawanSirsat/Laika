---
id: LAI-488
title: 'Board and List keep the same filters, and the List hides what cannot apply'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-621, LAI-487]
discovered-from:
status: backlog
---

## Goal

**Owner request (2026-09-28):** *"we have that same filter in the board as well
so that must be aligned properly."*

**The owner chose "keep filters, hide the rest":**

- filters and search **carry over** when you switch between the Board and List
  tabs;
- controls that cannot apply to a table are **hidden on the List** instead of
  silently doing nothing.

## What this is

**Switching tab drops every filter.** The tab links come from `navHref`
(`server/web/src/routes/nav-url.ts:48`), which writes `?project=` and nothing
else. A reader filtered to *P1, Pawan* on the Board who clicks *List* lands on
an unfiltered list.

**SPEC §11.4.1 says the opposite:** *"Two views over the same task list, same
filters, same URL state"*, and *"share one filter state, reflected in the URL"*.

**Three controls do nothing on `/list`:**

- **Group.** The table ignores `?group=`, yet the toolbar still says
  "Group: Assignee" and `BoardScreen.tsx:838` still renders `groupNotice`,
  telling the reader they can drag between rows of a table that has no rows to
  drag between.
- **View settings' *Show fields*, *Card density* and *Column width*.** They style
  Kanban cards only. *Hide done* and the filter chips **do** apply to the List,
  so they stay.
- **"… → Show as board / Show as list"** (`BoardScreen.tsx:748-751`). On `/list`
  it only clears the legacy `?view`, and the path keeps it a list, so the click
  does nothing. The tab bar has been the view switch since LAI-256.

## Acceptance criteria

- [ ] **The Board ↔ List tab switch carries every key in LAI-487's exported
      filter-key list, plus search (`q`).**
  - It does **not** carry `sort`, `dir` or `page` (List-only, LAI-485),
    `group` (Board-only) or `task`.
  - Every other tab's link is unchanged: Timeline, Calendar and the rest still
    carry only `?project=`.
- [ ] **Browser test, both directions:**
  - Set priority, assignee, status and search on `/board`, click *List*, and
    assert the URL **and** the rows.
  - Then set a filter on `/list`, click *Board*, and assert the same.
  - A reload on either side keeps them. That is already true and is asserted so
    it stays true.
- [ ] **On `/list`, these are absent, not disabled** (LAI-082: a disabled
      control still advertises something that cannot happen):
  - the Group button and the group notice;
  - View settings' *Show fields*, *Card density* and *Column width* sections;
  - the *Show as board / Show as list* menu item.
  Each is asserted absent on `/list` **and present on `/board`**. The Board is
  the control, so a test that only looks at the List cannot be passing because
  the control was deleted everywhere.
- [ ] **A `?group=` in a List URL is ignored and not deleted.** It stays in the
      URL, so returning to the Board keeps the grouping the reader chose.
      Since `group` is not carried (first AC), this matters only for a URL
      typed or shared with `group` on `/list`.
- [ ] **A legacy `?view=list` link still renders the List.**
      `BoardScreen.tsx:131` treats `path === '/list' || params.get('view') ===
      'list'` as the List. Removing the menu item from `/list` must not remove
      that branch, because old links depend on it.
- [ ] Both themes; no layout gap where a hidden control used to be.
- [ ] Full gate: repo root, all three `EXIT 0`, each status captured on its own
      line.

## Notes / context

- **Depends on LAI-487** for the exported key list. **Do not write a second
  list here.** Two lists of "the filter keys" is how *Clear all* came to miss
  `sprint`.
- **How the carry is done is yours.** Options include a `navHref` that takes the
  current params for the two views, or tab links built in the space tab strip
  from the same list. Whichever you choose, **`navHref`'s existing callers must
  keep their behaviour**: `nav-url.test.ts` pins it.
- **`SpaceTopBar`'s "Agents N" chip** also writes `?agent=true` on Board and
  List. It stays; it is the same key, so it agrees by construction.
- **LAI-614** (backlog) reshapes the same toolbar. Whichever lands second merges
  onto the other.
- **No new dependencies, no new tokens.**

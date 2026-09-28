---
id: LAI-485
title: "The List's sort lives in the URL, looks clickable, and starts newest-first"
area: web
assignee: shell
priority: p1
depends-on: [LAI-621]
discovered-from:
status: review
finished: 2026-09-28T18:58:50Z
started: 2026-09-28T18:50:57Z
---

## Goal

**Owner request (2026-09-28), with screenshots of `/list?project=onroute`:**
*"when i click on this column that filter out but not by query in link so i want
implement that properly … user can see that is clickable … by default that list
must show the latest updated one."*

Three things:

1. A sorted List is **linkable**, and it survives a reload.
2. The headers **look** like the controls they already are.
3. A bare `/list` opens **newest-updated first**.

**D-065 records the default and the URL rule.** Read it first.

## What this is

Measured on `shell`, since LAI-621 rebuilt these files and `master` is behind
(D-064):

- **Sort and page are component state.** Sort is `useState` in
  `server/web/src/routes/screens/list/ListView.tsx:59`, with a default of
  `{ key: 'key', ascending: true }`. The page is `useState(0)` at `:63`.
  Neither reaches the URL.
- **Because they are state, they reset without anyone asking.**
  `BoardScreen.tsx:904` swaps `ListView` for a skeleton whenever
  `board.state.status === 'loading'`. `useBoard` enters `loading` on every
  refetch, which happens on every live-stream tick, Refresh, create and panel
  edit. **So whenever anyone edits any task in the project, the reader's sort
  snaps back to KEY ▲** and their page goes back to 1.
  - Moving the state into the URL fixes this as a side effect. That is also why
    this task, not a separate one, owns it.
- **Four orderings are wrong** in `list-derive.ts` `sortValue` (`:164`) and
  `sortRows` (`:188`):
  - `status` sorts the raw enum alphabetically:
    `backlog < cancelled < done < in_progress < review < todo`.
  - `sprint` sorts the label as a string, so `S10 < S2`, and "no sprint" (`''`)
    comes first.
  - `assignee` sorts `Unassigned` alphabetically among the names.
  - There is **no tie-breaker**. Sorting by status or priority gives each group
    in whatever order the rows arrived.
- **The headers are already `<button class="list-sort">` with `aria-sort`**, so
  the semantics are right. But an unsorted column renders **no glyph at all**,
  and hover moves the text from `--text-muted` to `--text-secondary` and nothing
  else (`list.css:112-130`). Nothing on screen says "click me".

## Acceptance criteria

- [x] **Sort is in the URL** as `sort=<key>` and `dir=asc|desc`, written through
      the screen's existing `setParam`, which replaces history rather than
      pushing. The keys are the `SortKey` values in `list-derive.ts`.
- [x] **The default is `updated`, descending, and is not written to the URL.**
      A bare `/list?project=…` renders newest-updated first. Clicking back to
      the default removes both keys rather than writing them.
- [x] **The URL is untrusted input.** An unknown `sort`, an unknown `dir`, or a
      `dir` without a `sort` renders the default and does not throw. Each case
      is unit-tested.
- [x] **`page=` is in the URL as well.** It is 1-based, omitted on page 1, and
      clamped like `ListView` already clamps. It **resets to 1 whenever the
      sort or any filter changes**, because a page number from a different
      ordering points at arbitrary rows.
- [x] **Sort and page survive a live refresh.** Browser test: set a non-default
      sort and page 2, trigger a refetch (Refresh, or a stubbed stream event),
      and assert that the first row, the arrow and the page are unchanged.
      **This is the defect the owner saw.** Show the test red against the
      `useState` version before calling it done.
- [x] **First-click direction follows the data.** CREATED and UPDATED start
      descending (newest first), every other column starts ascending, and a
      second click on the same column flips it.
- [x] **Orderings a reader would expect:**
  - status in workflow order: `backlog → todo → in_progress → review → done →
    cancelled`;
  - sprints in their own order, not as strings: `S2` before `S10`, and no sprint
    at one end;
  - `Unassigned` after every name when ascending;
  - **ties broken by key number**, so any sort is deterministic.
  Each is a unit test in `server/web/test/routes/screens/list/list-derive.test.ts`.
  Today that file tests only `key`.
- [x] **Headers read as clickable**, in both themes, with existing tokens only
      (D-020):
  - every sortable header shows a faint, neutral sort glyph at rest;
  - the active column's label is at full strength with an accent ▲/▼;
  - hover gives the header a background, not just a colour shift;
  - `:focus-visible` shows a visible ring;
  - `title="Sort by <Column>"`.
- [x] **`aria-sort` stays correct**: the sorted column says `ascending` or
      `descending`, and the others say `none`.
- [x] **Browser tests:** clicking a header writes the URL; a reload keeps the
      order; no params gives newest-updated first. There are none for any of
      this today; `list-view.test.ts` does not click a header.
- [x] Full gate: repo root, all three `EXIT 0`, each status captured on its own
      line.

## Notes / context

- **Client-side sort stays client-side.** The server has no `sort` parameter
  (`server/src/services/tasks.ts:448` always orders by `updated_at, id`), and
  LAI-621 loads the whole set, which is why it pages in the browser. **Do not add a server sort**; that would be CORE's
  and is not needed.
- **`sort`, `dir` and `page` are List-only.** LAI-488 carries filters between
  Board and List and must not carry these three. Keep them out of whatever filter
  key list LAI-487 introduces.
- **Do not add manual ordering to the List.** D-060 says the List's sort is
  untouched by `position`, and a "manual" option is a separate question.
- **No new dependencies, no new tokens.**

## Built — 2026-09-28T18:58:50Z

Built by the CHIEF session **on the owner's direct instruction**, on branch
`build`.

- **`list-derive.ts`:**
  - `readSort` / `sortParams` / `nextSort` / `firstDirection` /
    `readPage` / `pageParam`.
  - `DEFAULT_SORT` is updated, descending, and never written to the URL.
  - `sortRows` compares per column, with status in workflow order, sprints
    by number, and Unassigned last, and breaks ties by key ascending in
    either direction.
- **`ListView.tsx`:**
  - sort and page are **props from the URL**, not `useState`, so a remount
    (every refetch) no longer resets them;
  - `title="Sort by …"` on every header;
  - the active arrow is `.list-sort-arrow`.
- **`BoardScreen.tsx`:**
  - `setParams` writes several keys in one history entry, since two
    `setParam` calls would undo each other;
  - one effect resets `page` whenever `filterSignature` changes, whichever
    writer changed it (the toolbar, the space bar, WORKING NOW).
- **`board/filter-keys.ts` (new):** the one exported list of filter keys,
  which LAI-487 extends. Mirrored by `filter-keys.test.ts`, which checks the
  list against the keys `BoardScreen` really reads.
- **`list.css`:**
  - a resting `↕` via `::after` on `aria-sort='none'`, so it never enters
    the accessible name;
  - a hover background, a `:focus-visible` ring, full-strength text on the
    sorted column, and an accent arrow;
  - existing tokens only.

**Red first.** The three browser tests failed against the `useState` version
before any code changed: *"the newest-updated task is not first"*, and the
URL waits timed out.

Mutations, each typechecking, restored by checksum, all **red on the named
test**:

- no tie-breaker;
- status alphabetical;
- Unassigned among the names;
- sprint compared as a string;
- a junk `sort` trusted;
- default KEY ascending;
- a header click never reaches the URL;
- the page reset disabled.

Web suite on `build`: **1091/1091** before the page-reset test, which was
added and passes. The structure guard is green, and so is lint.

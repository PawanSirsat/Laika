---
id: LAI-487
title: 'The shared Filter popover gains Status, Sprint, Blocked only and Updated within'
area: web
assignee: shell
priority: p1
depends-on: [LAI-621]
discovered-from:
status: in-progress
started: 2026-09-28T19:05:31Z
---

## Goal

**Owner request (2026-09-28), with a screenshot of the Filter popover open on
the List:** *"here we can add more filter but think like we have that same
filter in the board as well so that must be aligned properly."*

**The owner chose all four** of the filters offered:

- **Status**
- **Sprint**
- **Blocked only**
- **Updated within**

They go into the one popover that Board and List already share, so both screens
get them.

## What this is

**Board and List already use one toolbar.** Both routes mount `BoardScreen`,
which mounts `BoardToolbar` (`server/web/src/routes/screens/board/BoardToolbar.tsx`).
The popover today holds Priority, Assignee, Label, *Ready only* and
*Agent-created only*.

**What the server already accepts,** from `http/routes/tasks.ts` and SPEC §6.4
(`GET /projects/:slug/tasks ?status=&assignee=&priority=&ready=&sprint=&tag=&updated_since=`):

- **Status:** accepted by the server, and **already declared** in the client's
  `TaskFilter` and `toQuery` (`api/tasks.ts:138`, `:161`). Nothing reads it
  from the URL, so no control can set it.
- **Sprint:** accepted, and read from `?sprint=` (`BoardScreen.tsx:137`). The
  only way to set it is the Board's sprint strip, which **the List hides**, so
  it cannot be chosen from the List at all.
- **Updated within:** the server accepts `updated_since` (unix ms, inclusive).
  The client's `TaskFilter` does not declare it.
- **Blocked:** not a server filter. `blockedState()` (`api/board-derive.ts:116`)
  already computes it in the browser. Since LAI-621 the board holds every task,
  so filtering in the browser covers the whole set.

**Two defects in the same place, fixed here because this task owns the key
list:**

- ***Clear all* is a hard-coded list** at `BoardScreen.tsx:653`:
  `['priority', 'assignee', 'tag', 'ready', 'agent', 'q']`. It **misses
  `sprint`**, and it will miss every key this task adds unless it stops being a
  literal.
- **The badge undercounts.** `BoardToolbar.tsx:119-124` counts `ready` only when
  it is `true`, but `?ready=false` is sent to the server
  (`BoardScreen.tsx:135`, `:148`). A `ready=false` link filters the board while
  the button says nothing is filtered. Sprint is not counted at all.

## Acceptance criteria

- [ ] **Status** is a select: *Any* (default), then the six statuses by their
      labels. It writes `?status=`, and the value goes to the server through
      the existing `TaskFilter.status`. One value, because the server takes one.
- [ ] **Sprint** is a select: *Any*, *No sprint* (`none`), then the project's
      sprints, from the sprints the board already loads. It writes the **same
      `?sprint=`** as the sprint strip, so on the Board the strip and the
      popover always agree. Assert that in a browser test.
- [ ] **Blocked only** is a checkbox that writes `?blocked=true` and filters in
      the browser with `blockedState`. `false`/absent means no filter.
- [ ] **Updated within** is a select: *Any time*, *Today*, *Last 7 days*,
      *Last 30 days*.
  - **The URL stores the window** (`?updated=today|7d|30d`), **not a
    timestamp**, so a link shared on Monday still means "last 7 days" when it
    is opened on Friday.
  - The window becomes `updated_since` at request time, and `updated_since` is
    added to `TaskFilter` and `toQuery`.
  - *Today* means since local midnight.
- [ ] **Unknown values are ignored, not thrown on.** Examples: `?status=bogus`,
      `?updated=90d`, `?blocked=yes`. The URL is untrusted input, and the
      server answers `400` to a bad `status`, so validate before sending.
- [ ] **One exported list of filter keys** feeds the badge, *Clear all* and the
      View-settings chips, and **replaces the literal at
      `BoardScreen.tsx:653`**. LAI-488 carries exactly this list across the
      Board ↔ List switch, so export it from where both can import it.
- [ ] **The badge counts every filter the URL applies**, including
      `ready=false`, `sprint`, and the four new ones. It does not count search,
      which has its own box.
- [ ] ***Clear all* clears every key in the list**, including `sprint`, and
      leaves `project`, `group`, `task`, and LAI-485's `sort`/`dir`/`page`
      alone.
- [ ] **Popover order:** Status, Priority, Assignee, Label, Sprint, Updated
      within, then the checkboxes (*Ready only*, *Blocked only*,
      *Agent-created only*), then *Clear all*.
- [ ] **Browser tests on `/list`**, where none exist today: each new control
      writes its URL key, changes the rows, and moves the badge; *Clear all*
      empties the URL of every filter key. One test on `/board` proves the same
      popover works there.
- [ ] Both themes. Existing tokens only (D-020).
- [ ] Full gate: repo root, all three `EXIT 0`, each status captured on its own
      line.

## Notes / context

- **No CORE task is needed.** Every filter here uses a parameter the server
  already accepts, or is computed in the browser. **Do not add server
  parameters.** Multi-select (e.g. *In progress* **and** *Review*) would need
  one, and it is not part of this task.
- **Label options shrink as other filters are applied**, because they come from
  the loaded, filtered tasks (`BoardScreen.tsx:256`). This is noticed, not in
  scope. File it if you think it matters.
- **`SpaceTopBar`** (Timeline, Calendar, Capacity) has its own older filter
  controls on the same URL keys. It is not in scope; do not add the new filters
  there.
- **LAI-614** (backlog) also reshapes `BoardToolbar`. Whichever lands second
  merges onto the other; neither widens into it.
- **No new dependencies, no new tokens.**

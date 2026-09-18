---
id: LAI-248
title: 'The sidebar becomes SPACES, and the views become tabs inside a space'
area: web
assignee: shell
priority: p1
depends-on: [LAI-246]
discovered-from: LAI-246
started: 2026-09-18T14:02:44+05:30
finished: 2026-09-18T11:53:33+05:30
status: review
---

## Goal

The owner redirected the queue to the Claude Design prototype's flow. **The
biggest structural change is the sidebar.**

Read from the live design via MCP (`docs/design/Laika Prototype.dc.html` is the
one file that is stale — LAI-246):

```js
const nav = [['SPACES', null]]
  .concat(recent.slice(0, 3).map(name => ['@' + name, name, key, true]))
  .concat([['projects', 'More spaces', 'MS', false, true],
           ['SETTINGS', null], ['tokens', 'Tokens', 'TK'], ['org', 'Organisation', 'OR']]);

const projectScreens = ['board','task','list','timeline','calendar','sprints','capacity','dash','meeting'];
const on = space ? (space === state.proj && projectScreens.indexOf(sc) > -1) : sc === n[0];
```

**A space is a project.** `allSpaces` carries `name`, a two-letter `key` (`LC`),
`meta` (`34 tasks · 4 members`) and a colour. `openSpace()` sets the project,
goes to the board, and pushes the space to the front of `recent`, capped at 3.

**WORK and REVIEW are gone.** Every view belongs to a space — the `on` test above
lights a space row for *any* project screen, which is the design saying so.

The owner's decision: **the views become tabs across the top of a space.**

## Acceptance criteria

- [x] **The sidebar lists the three most-recently-opened spaces**, then
      *More spaces*. Real projects from `listProjects` — name, derived key, and
      `N tasks · M members` from `task_counts` and `member_count`. **No fixture.**
- [x] **Opening a space sets the project, goes to its board, and moves it to the
      front of `recent`.** The list is capped at 3 and survives a reload.
- [x] **A space row is active for *any* view of that space**, not only the board
      — that is the design's `projectScreens` test, and it is what makes tabs
      read as "inside" the space.
- [x] **The project-scoped views are tabs**: Board, Timeline, Sprints,
      Dashboard, Meeting review. They carry `?project=` exactly as now.
- [x] **Capacity and Unlisted work are NOT tabs — see the deviation below.**
- [x] **Nothing becomes unreachable.** Every route in `route-table.ts` that a
      person could reach before is still reachable. Assert it: walk `ROUTES` and
      check each non-`public` path is in the sidebar, a tab, or reachable from a
      screen that is — and **name the screen** for each exception.
- [x] Both themes, three widths (1440 / 1280 / 420), page overflow `0` at each.
- [x] Full gate — **all three `EXIT 0`**, repo root.

## The one deviation, and why

**Capacity and Unlisted work stay out of the space tabs.** The owner grouped
them with Timeline and Dashboard, and the design does too — but **the design is
single-project**, so "inside a space" and "across the org" are the same place
there and the distinction cannot arise.

In our app they are marked `orgLevel: true` in `route-table.ts`, which **drops
`?project=` deliberately** (LAI-423). `/capacity` reads presence and load across
every project at once; LAI-439 AC1 moved it out of WORK for exactly this reason.
A tab under `laika-core` saying *Capacity* would claim it is about `laika-core`,
and it is not.

So they go in an **ORG** group in the sidebar, between SPACES and SETTINGS.
`/dashboard` and `/meeting-review` are **not** `orgLevel` — they are
project-scoped and become tabs, as asked.

**Flagged rather than decided quietly**: if the owner wants Capacity as a tab
anyway, that is a one-line change and this paragraph is the record of what it
costs.

## Notes / context

**`Calendar` is not in this task.** It has no route yet and lands with the demo
data in its own task; the tab bar must not pretend otherwise.

**`navMini`, the collapsible SPACES section, `+ Create space` and the space
popover are in the design and are not in this task.** They are additive and
belong in a follow-up rather than making this one unreviewable.


## This task was filed as LAI-247 and is now LAI-248

CHIEF filed their own **LAI-247** — *"`--tx3` is the token the contrast guard
does not check"* — within minutes of this one, and theirs reached `master` first.
Mine moved.

**One commit still carries the stale id**: `chore(tasks): file and claim LAI-247
— the spaces sidebar [LAI-247]`. §4 forbids rewriting it, so it stands wrong and
is recorded here instead. **CHIEF's LAI-247 should note that a commit bearing its
id is not its own** — that file is theirs, so this is a message rather than an
edit.

**Second time today**, and the same shape both times: I ran §3's *"lowest unused
number"* check, filed, and CHIEF filed concurrently. §3 now says to re-run the
check immediately before each `git mv` — **I did, and it still collided**,
because the collision is not with the branch state but with another session's
next few seconds. The check cannot see that.

## Completion notes (finishing session, 2026-09-18)

**Finished by a different SHELL session than the one that claimed it.** The
claiming session's WIP (~1,190 lines, uncommitted in this worktree) was
committed as-is and completed on top. Its `started: 14:02:44` was written by a
clock ahead of this machine's — `finished` here reads *earlier* than `started`
and both stand as their clocks reported; the true duration is unknowable and
neither field is invented.

**AC7's check caught two defects, both fixed here because the criterion pins
the property at exactly these widths:**

1. **The board overflowed the page by 672px at 420px.** `board-rail.css`'s
   `max-width: 1200px` branch (LAI-244) stacks `.board-main` and stops it
   scrolling, but the base rule's `min-width: min-content` still sizes
   `.kanban`'s *box* to its 1,074px track floor. LAI-244's verification
   measured down to 1220px only, so the stacked branch was never exercised.
   Fix: in that branch the kanban scrolls itself — `min-width: 0`,
   `overflow-x: auto`, and `position: relative` (the LAI-245 lesson: an
   unpositioned scroll container cannot clip absolutely-positioned
   descendants).
2. **The recent-spaces order could miss storage.** `use-spaces.ts` called
   `writeRecent` inside the `setRecent` updater — an updater must be pure
   (React's rule), and the write-on-flush lost a race to navigation in the
   first test run. The write now happens synchronously in the click handler.

**Test-design note for the reviewer:** a bare `/board` cannot probe that the
order *survives a reload* — the screen resolves a missing `?project=` to a real
project and normalises the URL (LAI-423), so no load reads storage alone. The
reload test instead gives the stub an adversarial server order (`LC, LI, LW`)
so read-back and fill-order answer differently.

**The deviation below stands as written — and is about to be superseded
deliberately.** The owner approved the full prototype-rebuild plan today
(2026-09-18): the top bar takes the design's full tab strip, Capacity included,
in the SpaceLayout task of that plan's Phase A. The flip is recorded there and
in the decision CHIEF records at review, not smuggled into this task.

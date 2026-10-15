## 2026-10-15T19:06:41Z — LAI-754

Single builder on the owner's direct instruction (2026-10-15, through the
orchestrator; HANDOVER.md §4), worktree `Laika-capacity-global/`, branch
`build-capacity-global` cut from `master` 2f41298. A log file of its own so
parallel builders appending to `chief-*` do not conflict at merge. Nothing
pushed. No Laika MCP tools in this session, so nothing was mirrored onto the
board.

**What changed**
- server/web/src/routes/route-table.ts — `/capacity` is `orgLevel`, in `ORG`,
  mini `CA`; `/unlisted` back in `ORG` (gate unchanged); `/capacity` out of
  `SPACE_TAB_PATHS`
- server/web/src/components/sidebar/Sidebar.tsx — `ORG` renders above SPACES,
  `SETTINGS` stays at the foot
- server/web/src/api/use-unlisted-count.ts (new), shell/ShellProvider.tsx,
  shell/shell-context.ts, shell/ShellSidebar.tsx — one open-unlisted count for
  owners and admins (mount, 60 s, and after a promote or dismiss), shown as the
  sidebar badge and Capacity's link
- server/web/src/api/unlisted.ts — `openUnlistedCount`, `newestFirst`,
  `firstLine`
- server/web/src/components/shell/ScreenOutlet.tsx — `/capacity` mounts `plain`
  (no space frame) and rewrites `?project=` away; `/unlisted` gets the refresh
- server/web/src/routes/screens/capacity/CapacityScreen.tsx, capacity.css,
  capacity-derive.ts — `ScreenHeader`; amber strip and Unlisted list removed;
  *UNLISTED n* link; chips key + title (tooltip), three then *+N more*; ids
  resolved only for what is drawn, from a held task set first, retried on the
  next poll
- server/web/src/routes/screens/unlisted/UnlistedScreen.tsx, UnlistedList.tsx,
  unlisted.css — one line per note, newest first, click to expand, promote
  and dismiss under it, 25 then *Show more*, names from `GET /users`
- server/web/src/components/space/{SpaceLayout,SpaceSlot,SpaceTopBar,ViewTabs}.tsx
  — comments only: Capacity is no longer a space view
- server/test/tooling/structure.test.ts — `WEB_NO_MIRROR_REQUIRED` entry for
  the new hook
- server/web/test/browser/{capacity,unlisted (new),spaces-sidebar,store-requests}.test.ts,
  test/routes.test.ts, test/routes/{nav-truth,reachable}.test.ts,
  test/api/unlisted.test.ts, test/routes/screens/capacity/capacity-derive.test.ts
- docs/SPEC.md §11.4.2 — nav table, screens table, must-haves for Capacity and
  Unlisted work
- .tasks/backlog/LAI-755-capacity-chip-opens-its-task-in-its-own-space.md

**Decisions**
- `ORG` keeps its name and sits above SPACES — not a new heading, and not
  headless: the group already existed for exactly "reads across every space".
- Promote and Dismiss live in the expanded row, not on the line — the owner's
  complaint was size; one click further is the trade.
- *Show more* pages the already-loaded list; every page is still read
  (LAI-703) so the counts are the queue's, not the screen's.
- Chips resolve with `GET /tasks/:id` only for what is drawn; the server
  answer (LAI-728) is unchanged and still the real fix.
- The Agents-chip test moved from `/capacity` to `/activity`: it asserts the
  space bar, which Capacity no longer has.

**Discovered**
- The owner's chips read `…`, which is what an unresolved id draws. One way
  that sticks: an id whose read failed once was never asked again for the
  visit (the effect re-ran only when the missing set changed). Not confirmed
  as the production cause — that instance was not examined — but the retry
  now re-derives what is drawn on every poll, and a mutation restoring the
  old behaviour leaves the chip on `…` in the test.
- A chip for a task in another space opens the last space's board and finds
  nothing (pre-existing; measured on the local instance) → LAI-755 filed
  (discovered-from: LAI-754).
- `POST /api/v1/auth/sign-in/email` from a script needs an `Origin` header
  (`MISSING_OR_NULL_ORIGIN`).

**State**
In `.tasks/review/`. Local instance on port 3754 (`/tmp/lai754-db`) stopped
after the screenshots. Gate exit codes in the final report.

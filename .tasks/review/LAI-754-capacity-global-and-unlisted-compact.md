---
id: LAI-754
title: 'Capacity becomes one global page in the sidebar; Unlisted work leaves it for a compact page of its own; in-progress chips show key and title'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-15T18:33:31Z
status: review
finished: 2026-10-15T19:08:38Z
---

## Goal

**Made on the owner's direct instruction** (2026-10-15, through the
orchestrator), single-agent mode (`docs/HANDOVER.md` §4): one branch may change
`server/web/`, `server/test/tooling/structure.test.ts`'s `WEB_*` maps and
`docs/` together. Every other `CLAUDE.md` rule still applies. The owner's words:
*"Capacity must not be at project level; it must go to the sidebar and be
global. And this Unlisted work list is too big, I don't know why we added it
there."* His screenshots showed Capacity as a project tab, an amber *UNLISTED
WORK* strip inside each person's card, a long list of large Unlisted cards
with Promote/Dismiss under the people, and in-progress chips that showed only
a dot and `…`.

Capacity is one page for the whole organisation, reached from the sidebar.
Unlisted work is a small page of its own, one line per note. A person's
in-progress work reads as keys and titles.

## Acceptance criteria

**Capacity is global**

- [x] The sidebar carries a **Capacity** entry near the top, above SPACES, not
      inside a space and not in a `SYSTEM` group; it links to bare `/capacity`
      (no `?project=`) and is marked current there.
- [x] `/capacity` renders without the space frame (no space bar, no view
      tabs) and reads across every space the viewer can see; the summary strip
      says how many.
- [x] The space tab bar has no Capacity tab.
- [x] An old project-level URL — `/capacity?project=<slug>` — is replaced by
      `/capacity`.
- [x] The 20 s refresh, presence, agent sessions, the summary strip and the
      profile links for owners and admins keep working.

**Unlisted work leaves Capacity**

- [x] `/capacity` renders no per-person amber strip and no Unlisted list; the
      summary strip may carry a small *Unlisted N* link to `/unlisted`, shown
      only to a reader allowed to open it.
- [x] The sidebar carries **Unlisted work** under Capacity, with the open
      count, for owners and admins only (the `audit_log.export` gate it already
      had); absent for everyone else.
- [x] `/unlisted` is compact: one line per note — repo, who, when, the note's
      first line — newest first; a click expands the full text; Promote to
      task and Dismiss still work; the list shows a first page with *Show
      more* rather than every note at once.
- [x] The API and the `log_unlisted_work` MCP tool are unchanged.

**In-progress chips**

- [x] Each chip shows the task key and a truncated title, with the full title
      in a tooltip; chips wrap; a person shows at most three, then *+N more*.
- [x] A chip whose task could not be read on one refresh is asked for again
      on the next, rather than staying `…` for the visit.

**Documents, tests, evidence**

- [x] SPEC §11.4.2 (the nav table, the screens table and the must-have
      elements for Capacity and Unlisted work) says what is built.
- [x] Every test, nav map and route table that referenced the Capacity tab is
      updated — including `server/test/tooling/structure.test.ts`'s `WEB_*`
      maps if they name it — found by an untruncated search of the repo.
- [x] Browser tests cover: the sidebar entries and their gate, no Capacity
      tab, the redirect, no Unlisted list on Capacity, the compact Unlisted
      page (expand, promote, dismiss, show more), and the chips; each shown
      red without its code.
- [x] Screenshots, light and dark, at 1366 and 390: the sidebar, `/capacity`,
      `/unlisted` collapsed and with one note expanded, in
      `/tmp/laika-capacity-global-shots/`.
- [x] `pnpm test`, `pnpm lint`, `pnpm format` each exit 0, run separately
      after the last edit.

## Notes / context

- No new dependencies. No server change: the chips resolve ids with the
  `GET /tasks/:id` the screen already used, only for what is drawn. LAI-728
  (capacity sends task refs) is still the server-side answer.
- Other builders are working on the member profile, the Connect wizard and the
  Organisation screen; this task does not edit those screens.

## Evidence (builder, at submission)

- **Commits** on `build-capacity-global` from `2f41298`: claim `e73c3bc`,
  web `4a6a7cc`, SPEC `8394d2e`, chip alignment `d84297c`, comments
  `4be4911`, LAI-755 filed `6f33679`, log `6bb0f06`, this move.
- **No server change**: `git diff --stat 2f41298 -- server/src cli plugin docker`
  is empty, so `GET /unlisted`, promote, dismiss and `log_unlisted_work` are as
  they were.
- **Census**: an untruncated `grep -rn -i capacity` over `server/web/test`,
  `server/web/src`, `server/test` and `docs/` was walked line by line; every
  tab-era reference in tests, route tables and SPEC §11.4.2 is updated.
  `structure.test.ts`'s `WEB_*` maps named no Capacity path; they gained one
  `WEB_NO_MIRROR_REQUIRED` entry for the new hook.
- **Red without the code** — 14 mutations, each run against the one test that
  claims it (`node --test --test-name-pattern=…`, `# tests 1` every time), all
  exit 1, file restored after each: ORG drawn below SPACES; Capacity back in
  the tab bar; no redirect; amber strip back; Unlisted link for every reader;
  count asked for every reader; every note open at once; server order; no Show
  more; sidebar not told after a promote; no chip cap; chip with no title; a
  failed read never retried; held set not consulted.
- **Real browser, real server** (port 3754, own database, seeded through the
  API and MCP: 4 people, 3 spaces, 12 tasks, 42 notes): 68/68 checks — old URL
  rewritten, no tabs, no chip on `…`, key + title on every chip, `+2 more`,
  `UNLISTED 42 · across 3 spaces`, ORG first in the rail, 25 lines then *17
  more*, a line 33 px (54 px at 390), no sideways scroll — in light and dark at
  1366 and 390. Promote through the UI created `LC-7` and dismiss asked first;
  the sidebar count went 42 → 41 → 40.
- **Screenshots** in `/tmp/laika-capacity-global-shots/`: `capacity-*`,
  `sidebar-*`, `sidebar-in-space-*`, `unlisted-collapsed-*`,
  `unlisted-expanded-*`, each `{light,dark}-{1366,390}`.

---
id: LAI-754
title: 'Capacity becomes one global page in the sidebar; Unlisted work leaves it for a compact page of its own; in-progress chips show key and title'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-15T18:33:31Z
status: in-progress
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

- [ ] The sidebar carries a **Capacity** entry near the top, above SPACES, not
      inside a space and not in a `SYSTEM` group; it links to bare `/capacity`
      (no `?project=`) and is marked current there.
- [ ] `/capacity` renders without the space frame (no space bar, no view
      tabs) and reads across every space the viewer can see; the summary strip
      says how many.
- [ ] The space tab bar has no Capacity tab.
- [ ] An old project-level URL — `/capacity?project=<slug>` — is replaced by
      `/capacity`.
- [ ] The 20 s refresh, presence, agent sessions, the summary strip and the
      profile links for owners and admins keep working.

**Unlisted work leaves Capacity**

- [ ] `/capacity` renders no per-person amber strip and no Unlisted list; the
      summary strip may carry a small *Unlisted N* link to `/unlisted`, shown
      only to a reader allowed to open it.
- [ ] The sidebar carries **Unlisted work** under Capacity, with the open
      count, for owners and admins only (the `audit_log.export` gate it already
      had); absent for everyone else.
- [ ] `/unlisted` is compact: one line per note — repo, who, when, the note's
      first line — newest first; a click expands the full text; Promote to
      task and Dismiss still work; the list shows a first page with *Show
      more* rather than every note at once.
- [ ] The API and the `log_unlisted_work` MCP tool are unchanged.

**In-progress chips**

- [ ] Each chip shows the task key and a truncated title, with the full title
      in a tooltip; chips wrap; a person shows at most three, then *+N more*.
- [ ] A chip whose task could not be read on one refresh is asked for again
      on the next, rather than staying `…` for the visit.

**Documents, tests, evidence**

- [ ] SPEC §11.4.2 (the nav table, the screens table and the must-have
      elements for Capacity and Unlisted work) says what is built.
- [ ] Every test, nav map and route table that referenced the Capacity tab is
      updated — including `server/test/tooling/structure.test.ts`'s `WEB_*`
      maps if they name it — found by an untruncated search of the repo.
- [ ] Browser tests cover: the sidebar entries and their gate, no Capacity
      tab, the redirect, no Unlisted list on Capacity, the compact Unlisted
      page (expand, promote, dismiss, show more), and the chips; each shown
      red without its code.
- [ ] Screenshots, light and dark, at 1366 and 390: the sidebar, `/capacity`,
      `/unlisted` collapsed and with one note expanded, in
      `/tmp/laika-capacity-global-shots/`.
- [ ] `pnpm test`, `pnpm lint`, `pnpm format` each exit 0, run separately
      after the last edit.

## Notes / context

- No new dependencies. No server change: the chips resolve ids with the
  `GET /tasks/:id` the screen already used, only for what is drawn. LAI-728
  (capacity sends task refs) is still the server-side answer.
- Other builders are working on the member profile, the Connect wizard and the
  Organisation screen; this task does not edit those screens.

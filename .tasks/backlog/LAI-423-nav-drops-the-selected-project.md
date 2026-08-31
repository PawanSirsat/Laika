---
id: LAI-423
title: Every nav click drops the selected project and lands you on a different one
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

**Found by the owner, in a browser, within minutes of first opening a seeded
board.** Their words: *"sprint and timeline is not there why?"*

They were not wrong and nothing was missing. `laika-core` had 3 sprints, 41
tasks and a full timeline. The Sprints screen said:

```
Sprints   atlas · 0 sprints
          No sprints yet
```

Two defects compound into one symptom.

### 1. The sidebar drops `?project=`

`server/web/src/components/Sidebar.tsx:98` renders `href={route.path}` — a bare
path with no query string. Measured, from a real browser:

```
/board?project=laika-core   -> click "Sprints"  -> /sprints    (param gone)
                            -> click "Timeline" -> /timeline   (param gone)
                            -> click "Board"    -> /board      (param gone)
```

The comment at `ProjectsScreen.tsx:28` says the choice deliberately lives in the
URL *"rather than storing an ambient selection"* — which is the right call, and
is exactly why the nav has to carry it. As it stands the selection cannot
survive a single click.

### 2. The fallback is the alphabetically-first project

With no `?project=`, screens fall back to `page.data[0]` (`BoardScreen.tsx:109`
and the equivalent in `use-sprints.ts`). `GET /projects` returns
**alphabetically** — measured: `['atlas', 'laika-core', 'pathfinder']` — so the
fallback is whichever project sorts first, with no relationship to what the
person was looking at or where any work is. Here that is `atlas`: 2 tasks, no
sprints, nothing scheduled.

Either defect alone is survivable. Together, **every nav click silently moves
you to a different project than the one you were reading**, and if that project
is empty the screen is indistinguishable from a broken one.

## Acceptance criteria

- [ ] **The nav carries the current project.** From `/board?project=laika-core`,
      clicking Sprints, Timeline, Projects and Board each land on the same
      project. The `href` is a real URL with the query string on it, not a click
      handler that patches the param afterwards — middle-click and copy-link
      must work, which is why `Sidebar.tsx:36` uses a real `<a href>` in the
      first place.
- [ ] **A screen reached with no project in the URL does not silently pick one.**
      Either it resolves a project and **puts it in the URL** so the address bar
      matches what is shown, or it asks. What must not happen is the current
      behaviour: showing project A's name in a header nobody reads while the
      person believes they are looking at project B.
- [ ] **The fallback, where one is still needed, is defensible and written down.**
      Alphabetically-first is not. The person's most recently opened project, or
      the one they are a member of, or the only one they can read — pick one, say
      why in the code, and make it the same choice on every screen. Board and
      Sprints currently disagree, which is its own bug.
- [ ] A test drives the real nav: land on a project's board, click each nav
      entry in turn, and assert the project is still the same one. **Make it
      fail first** — it passes today only because nothing checks.
- [ ] `/members` uses the same `?project=` mechanism (LAI-059) and must be
      covered by whatever fix lands.
- [ ] Both themes, rendered in a real browser. Full gate green.

## Notes

No new dependencies.

**Do not solve this by storing the selection in component state or
localStorage.** `ProjectsScreen.tsx:28` records the decision that the choice
lives in the URL, and it is the right one — a link someone pastes to a colleague
has to open the same board. The fix is to propagate the param, not to replace
the mechanism.

`nav-truth.test.ts` asserts *which* entries exist and passed throughout. That is
the gap worth noting: **it tests that the nav lists the right destinations, and
nothing tests that clicking one takes you where you were.**

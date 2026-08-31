---
id: LAI-423
title: Every nav click drops the selected project and lands you on a different one
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-08-31T18:39:04Z
finished: 2026-09-01T00:25:00Z
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

- [x] **The nav carries the current project.** From `/board?project=laika-core`,
      clicking Sprints, Timeline, Projects and Board each land on the same
      project. The `href` is a real URL with the query string on it, not a click
      handler that patches the param afterwards — middle-click and copy-link
      must work, which is why `Sidebar.tsx:36` uses a real `<a href>` in the
      first place.
- [x] **A screen reached with no project in the URL does not silently pick one.**
      Either it resolves a project and **puts it in the URL** so the address bar
      matches what is shown, or it asks. What must not happen is the current
      behaviour: showing project A's name in a header nobody reads while the
      person believes they are looking at project B.
- [x] **The fallback, where one is still needed, is defensible and written down.**
      Alphabetically-first is not. The person's most recently opened project, or
      the one they are a member of, or the only one they can read — pick one, say
      why in the code, and make it the same choice on every screen. Board and
      Sprints currently disagree, which is its own bug.
- [x] A test drives the real nav: land on a project's board, click each nav
      entry in turn, and assert the project is still the same one. **Make it
      fail first** — it passes today only because nothing checks.
- [x] `/members` uses the same `?project=` mechanism (LAI-059) and must be
      covered by whatever fix lands.
- [x] Both themes, rendered in a real browser. Full gate green.

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

---

## Build note — SHELL, 2026-09-01

### The test failed first, on the real defect

`navHref` could have been perfect with the bug still shipping, because the bug
was never in a function — it was one `href={route.path}` in a component no test
can render. So the assertion that matters is the **wiring** one, and it was run
against the unmodified `Sidebar` before anything was fixed:

```
not ok 1 - no nav link is built from a bare route.path
  error: 'Sidebar builds a nav href from the bare path, which drops ?project='
```

### An existing test asserted the presence of the bug

`routes.test.ts` "nav items are real links" matched `href={route.path}`
**verbatim**. Its intent is "anchors, not divs with click handlers" — but as
written it pinned the exact expression that was the defect, so it would have
**blocked this fix while never having caught the bug**. Rewritten to assert an
`href` expression and the absence of a click-handler div, which is what it says
it checks.

That is the same shape as the gap the task names in `nav-truth.test.ts`, one
level down: a test can be green, specific, and about the right subject, and
still be pointed at the implementation rather than the property.

### The fallback rule, and why this one

**Most recently active**, from `last_activity_at`, which is already on every
`ProjectView` so it costs no request. It answers what the reader is asking —
*where is work happening?* — rather than *what sorts first?*

Not "most recently opened by you": that needs storage, and the Notes are right
that the selection belongs in the URL. A `localStorage` fallback is the ambient
selection under another name, and makes two browsers disagree about what a bare
`/board` means.

One rule in one place (`api/pick-project.ts`), used by Board, Sprints, Timeline
and Dashboard — which had four copies of `live[0]`, and Board did not even
filter tombstones.

### `/members` asks rather than resolving, deliberately

AC2 allows either. A board with no project is better resolved than refused; a
**members list** silently scoped to a project you did not choose is a
permissions screen showing you the wrong permissions. It already said "No
project chosen" and still does. `navHref('/members', slug)` carries the param,
so reaching it from a project card is unaffected. **Say if you would rather it
resolved like the others** — it is one line and I would rather you chose.

### A blocker found on the way

`BoardScreen` could not use the shared rule at all: it imported a **second**
`listProjects` from `api/tasks.ts` returning a narrow `ProjectSummary` with no
`last_activity_at` and no tombstone handling. Board now uses the real one; the
duplicate is filed as **LAI-226**, not fixed here — collapsing it touches every
screen that lists projects.

### Verified by clicking, which is the whole point

From `/board?project=atlas`, in a browser, with two projects where the two rules
disagree (`atlas` sorts first, `laika-core` is most recently active):

```
click Sprints    -> /sprints?project=atlas
click Timeline   -> /timeline?project=atlas
click Board      -> /board?project=atlas
click Dashboard  -> /dashboard?project=atlas
```

And every bare entry point resolves *and rewrites the address bar*:
`/board`, `/sprints`, `/timeline`, `/dashboard` all become `?project=laika-core`
— the busy project, not the alphabetical one. Org-level links stay bare
(`/organisation`, `/tokens`).

Both themes through the real theme control; the href survives the switch.

### Five mutations, five reds

Sidebar reverted to the bare path (1 fail), `navHref` stops attaching (6),
org-level routes also carry it (1), fallback reverted to alphabetically-first
(4), `null` activity wins "most recent" (1). Anchors asserted to match exactly
once before mutating; baseline confirmed green first.

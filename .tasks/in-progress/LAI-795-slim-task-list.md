---
id: LAI-795
title: 'Slim task list: Board and List load tasks without their description and acceptance text; the task panel loads them when opened'
area: server
assignee: owner-direct
priority: p1
depends-on: [LAI-785]
discovered-from: LAI-786
status: in-progress
started: 2026-10-20T04:32:27Z
---

## Goal

LAI-786 measured that `description_md` and `acceptance_md` are 83% of a
gzip'd 200-task page (126,960 B, or 21,234 B without them). On a slow
connection (10 KB/s, the owner's Jio link on a bad day) that is about 13 s
against about 2 s. The Board, List, Timeline, Calendar, Capacity and the
client store never render those two fields; only the task panel does.

Owner direct instruction (2026-10-20): pages load only the data they need.

## Acceptance criteria

- [ ] `GET /api/v1/projects/:slug/tasks` accepts a field selector (for example
      `fields=slim`) that omits `description_md` and `acceptance_md`. Without
      it the response is unchanged, so agents, the CLI and existing clients
      keep working.
- [ ] The web client store requests the slim shape for every list it keeps,
      and the task panel fetches the full task (`GET /api/v1/tasks/:id`) when
      opened, with a loading state that does not jump.
- [ ] Anything else in the web app that reads description or acceptance from
      the list (search, effort "why", similar tasks, markdown previews, the
      List's search box) is found by a full grep, not a sample, and either
      moves to the full fetch or is shown to need only server-side data.
- [ ] Search on Board and List still matches description text, or the
      decision to search titles only is written into SPEC with the reason.
- [ ] Measured on a production-shaped fixture: bytes of one 200-task page,
      plain and gzip, before and after; recorded in the task file.
- [ ] Tests: the server field selector (both shapes, unknown values refused),
      the panel fetching the full task, and a browser test that the Board's
      task request carries the slim selector. Tests count bytes or fields,
      never wall-clock time.
- [ ] SPEC section 6.4 names the selector.
- [ ] Gate: test, lint, format exit 0.

## Notes / context

- Live-update refresh paths must request the slim shape too, or the saving
  is lost on every change.
- The effort/forecast fields stay in the slim shape; they are small.
- Do not add a dependency.

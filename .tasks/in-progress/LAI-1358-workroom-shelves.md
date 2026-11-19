---
id: LAI-1358
title: "Archive and Delete on the task's full page, read-only once put away"
area: web
assignee: chief
priority: p2
depends-on: [LAI-1353, LAI-1354]
discovered-from: LAI-1354
status: in-progress
started: 2026-11-19T06:47:49Z
---

## Goal

The owner, 2026-11-19 ("where is delete button"). Board card LAIKA-1160, under the parent
LAIKA-1156, *Task archive and delete*.

LAI-1353 and LAI-1354 put Archive and Delete in the task drawer, but missed the full-page view,
the Workroom (`/task/LC-12`, reached by *Expand to full page*). There:
- neither action appears;
- a task that is archived or in Trash stays editable;
- `/task/LC-12` answers *No task LC-12* for a task put away, because the page looks only in
  the board's live set.

## Acceptance criteria

- [ ] The archive and Trash actions and the banner live in **one shared hook and component**,
  and both the drawer and the Workroom use them. The drawer behaves as before; its browser tests
  are unchanged and green.
- [ ] The Workroom header offers *Archive* and *Delete…* to whoever may, with the drawer's
  confirm and Undo. A task put away shows the banner with *Restore*.
- [ ] Nothing on the Workroom can edit a task that is archived or in Trash.
- [ ] `/task/<key>` opens a task that is archived or in Trash: when the key misses the live set,
  the page looks on the space's two shelves before saying *No task*.
- [ ] Both themes. CI green on the PR into `integration-ksage`.

## Notes / context

- Web only (`server/web/`). The server already serves both shelves (`?archived=only`,
  `?trash=only`).
- A shared hook in a `.ts` file needs a mirror test or a `WEB_NO_MIRROR_REQUIRED` entry with
  its reason. Its behaviour is exercised in the browser.

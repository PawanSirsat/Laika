---
id: LAI-519
title: 'A block marked Not work time stays on the day as the design draws it — hatched, with × in the editor and *Back to review* — read and undone through the API'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-515
status: backlog
---

## Goal

The owner's My Day design keeps a dismissed draft on the Timeline as a
hatched *Not work time* block: picked, the editor's head says *× Not work
time* and offers *Back to review*. Today a dismissed draft leaves
`GET /me/time` and nothing can bring it back but Undo in the moment, so
LAI-515 left both unbuilt. This is the server half; the web half follows in
the same task's second commit range or a task CHIEF files when this lands.

## Acceptance criteria

- [ ] `GET /me/time?day=` answers the day's dismissed drafts in their own
      list (`dismissed`), each with its span, minutes and card — read only by
      whoever may read the day's drafts (D-102), and never counted anywhere.
- [ ] `POST /me/time-drafts/:id/restore` puts a dismissed draft back to
      pending; `can()` as `time_drafts.manage_own`; undoable as the other
      draft writes are (LAI-831); `404` for a draft that is not dismissed.
- [ ] SPEC §6.4 names both; the client mirror in `server/web/src/api/time.ts`
      is CHIEF's to file as the web half (§4.4, two owners).
- [ ] Tests: the list, the restore, the refusal for someone else's draft.

## Notes / context

The design: `docs/design/MyDay.dc.html` (`notwork` state, *Back to review*),
`TimelineV2.dc.html` (`S.notwork`, hatched). D-112 records the owner's
choice to build the design as it is.

---
id: LAI-223
title: comment_count is on every task and nothing renders it
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-066
status: backlog
started:
finished:
---

## Goal

**LAI-072 is done and its purpose is unrealised.** Its goal reads:

> Every card in `docs/design/Laika Prototype.dc.html` shows a comment count.
> `TaskView` has no such field, so LAI-066 ships the card without it.

So LAI-072 added the field — `area: server`, four criteria, all about the
payload — and LAI-066 was written while the field did not exist and lists the
comment count under **Explicitly NOT in this task**.

Both are now closed, and the result is a field nobody shows:

```
GET /projects/:slug/tasks  →  … "comment_count": 0, …     served
grep -rn comment_count server/web/src                     one hit: nothing
```

The client `Task` type does not even declare it.

## Why this is worth a task rather than a line in another one

It is the seam between a server task and a UI task, and **each was individually
correct**. LAI-072 delivered exactly what it promised; LAI-066's exclusion was
accurate on the day it was written and quietly stopped being accurate when
LAI-072 landed. Nothing failed, no test went red, and the design's card still
does not match.

The general shape, which is worth more than this instance: **an exclusion
justified by "the data does not exist" expires the moment the data exists, and
nothing watches for that.** Same family as the `api/auth.ts` exemption whose
"thin boundary" reason expired (LAI-220), and the dead CSS that outlived the
markup it styled.

## Acceptance criteria

- [ ] The client `Task` type declares `comment_count`.
- [ ] The card shows it where the design puts it — in the footer, beside the
      dependency count — and **shows nothing when it is zero**, the way the
      dependency count already does. A row of `0`s is noise on every card.
- [ ] The list view shows it too, or there is a stated reason it does not.
- [ ] Both themes.

## Notes

- Guarded against per-task fetching by LAI-072 itself, which computes it in one
  query per page: *"a board of 50 tasks must not issue 50 counts."* The UI must
  not undo that by fetching threads to count them.
- Worth checking `blocks` at the same time — also served on `TaskView`, also
  unused by the client. It is the reverse of `dependencies` and would let a card
  say what it is holding up, not only what is holding it.

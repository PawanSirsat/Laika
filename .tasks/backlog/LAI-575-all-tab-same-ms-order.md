---
id: LAI-575
title: "Task panel's All tab shows same-millisecond activity rows newest-first inside an oldest-first thread"
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-543
status: backlog
---

Filed by SHELL (Belka, dispatched by polly) from CHIEF's block, 2026-10-28,
while fixing the LAI-543 review blocker. That blocker was claim rows in one
millisecond ordered by ULID. This is the census finding outside LAI-543's
scope. Board: LAIKA-827.

## The defect

`server/web/src/routes/screens/board/TaskDetailPanel.tsx` builds the **All**
tab by merging comments and activity, oldest first:

```ts
].sort((a, b) => a.at - b.at || (a.kind === 'comment' ? -1 : 1))
```

The activity comes from the feed newest first (`created_at DESC, seq DESC`,
`server/src/db/activity.ts`), and a stable sort keeps the input order on a
tie. So two activity rows written in the same millisecond show **reversed**
in an oldest-first thread. That happens routinely: a claim's
`task.status_changed` and `task.updated`, or an expiry and a reclaim. It is
display only and nothing is derived from it. The History tab renders the feed
as it came and is not affected.

## Fix

Break an event/event tie by `seq` ascending (the server's insert-order
`rowid`), as `execution-derive.ts`'s `inWriteOrder` does after LAI-543's
review.

## Acceptance criteria

- [ ] Two activity rows with one `created_at` show in `seq` order (oldest
      first) in the All tab, whatever order the feed handed them in.
- [ ] A comment still sorts before an event on a tie.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Role / machine

SHELL. Owner area: `web`.

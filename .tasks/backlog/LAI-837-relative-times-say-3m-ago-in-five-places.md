---
id: LAI-837
title: 'Relative times say "3m ago", "2h" and "starts in 3d" in five places and "3 min ago" everywhere else'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-830
status: backlog
---

## Goal

LAI-830 moved every clock time and every duration in the web app onto one
helper each. It left **relative times** ("when", not "how long") alone,
because the owner's request was about the clock and about durations, and
`timeLabel`'s `4 min ago` / `3 h ago` form was the owner's own choice
(D-065). Its census found that five other places still build their own
compact form, where `m` could be read as months:

| Site | Prints |
| --- | --- |
| `server/web/src/api/tokens.ts:167` | `Used 3m ago`, `Used 2h ago`, `Used 4d ago` |
| `server/web/src/routes/screens/ProjectStats.tsx:26` | `3m ago`, `2h ago`, `4d ago` |
| `server/web/src/routes/screens/task/TaskMeta.tsx:77` | `3m ago`, `2h ago`, `4d ago` |
| `server/web/src/routes/screens/timeline/TimelineScreen.tsx:65` | `starts in 3d`, `ended 3d ago` |
| `server/web/src/api/board-derive.ts:148,186` `staleFor` / `updatedAge` | `12m`, `2h`, `3d` (card footer) |

`board-derive.ts`'s compact form on the card footer was kept on purpose
(D-065: a footer has no room); this task should say whether that still
holds, not assume it.

## Acceptance criteria

- [ ] The four non-footer sites read as `timeLabel` does (`3 min ago`,
      `2 h ago`, then a date) or through `formatDuration` with `ago`/`in`,
      one decision for all four, recorded here.
- [ ] The card footer either joins them or keeps `2h` with the reason
      restated in its comment.
- [ ] Tests that fail on today's code for each site changed.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

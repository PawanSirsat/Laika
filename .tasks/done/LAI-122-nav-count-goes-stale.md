---
id: LAI-122
title: The sidebar sprint count goes stale the moment a screen changes the data
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-083]
discovered-from: LAI-083
status: done
started: 2026-08-25T03:18:10Z
finished: 2026-08-25T03:46:18Z
reviewed: 2026-08-26T10:00:00+05:30
---

## Goal

`useShellContext` fetches `countSprints` once when the shell mounts and never
again. Delete a sprint on `/sprints` and **the badge keeps the old number** until
a full page reload.

Reproduced against the built app: two sprints, badge reads `2`, delete one, the
list correctly shows one sprint and the badge still reads `2`.

This is the exact failure D-028 exists to correct, one layer over: *"every number
comes from an API"* is necessary but not sufficient — a number that **came** from
the API and has since stopped being true is as wrong as a fixture, and harder to
spot because it was right a moment ago.

It will not stay a sprints problem. Every count the shell grows — open tasks,
review queue — has the same shape the first time a screen mutates it.

## Acceptance criteria

- [x] A mutation on a screen updates any shell number derived from the same data,
      without a page reload.
- [x] The fix is **not** a poll. LAI-049 already refused a timer nobody
      remembers to remove, and the shell is the worst place for one.
- [x] Assert it: change the underlying data and check the rendered count, rather
      than checking that a refetch function exists.

## Notes / context

Three approaches, in the order I would try them:

1. **Refetch on route change.** Smallest, and wrong in the case that matters —
   deleting a sprint does not change the route, so the badge stays stale on the
   screen the reader is looking at.
2. **An invalidation signal the shell subscribes to** — a counter a screen bumps
   after a mutation. Small, explicit, and no library. My `use-sprints.ts` already
   has the seam: every mutation ends in one `setAttempt(n => n + 1)`.
3. **SSE (LAI-048/LAI-070).** The real answer, and it makes this whole class of
   bug disappear rather than patching one instance. The server has streamed
   activity since LAI-048 and nothing consumes it. If LAI-070 is close, this
   task may be better spent there than on a bespoke signal.

**`use-shell-context.ts` and `AppShell.tsx` are Builder-B's** under D-028, which
is why this is a task rather than a fix — I could not have done it from
`routes/screens/sprints/` even if the right answer were obvious.

---

## Reproduced first (builder-b, 2026-08-25T03:46:18Z)

Not taken on trust. On the built app, deleted a sprint through the UI:

```
server sprints   3      screen cards  3      screen header  "laika-core · 3 sprints"
sidebar badge    4 sprints                   ← stale
```

## The approach, and why the task's own recommendation needed checking

The task offered three options and preferred **SSE** *"if LAI-070 is close"*.
LAI-070 landed today, so the precondition is met — but the note also assumed the
stream would carry a sprint event, and §4.8 **has no sprint verb** (LAI-113).

I read the call sites and concluded the stream said nothing about sprints. **I
was wrong**, and only found out by probing a live stream while mutating:

```
create sprint  →  project.updated
rename sprint  →  project.updated
delete sprint  →  project.updated
```

Sprint changes ride under `project.updated` precisely *because* there is no
sprint verb. So SSE works, and the shell now refetches its counts on a short
list of project-level types.

That list is the cost control, and it is tested in both directions: too narrow
and the badge silently keeps a dead number; too wide and one person commenting
costs a `countSprints` request in every open tab. Verified live that task
traffic does **not** trigger a recount.

## One connection, not two

The board has streamed since LAI-070. Subscribing the shell the obvious way adds
a **second permanent connection per tab** — and this server speaks **HTTP/1.1**
(measured: `http_version=1.1`), where browsers allow about six per origin. Two
long-lived streams are two slots gone for the life of the tab, and a third
consumer later makes three.

So `api/event-stream.ts` owns one `EventSource` per project, ref-counted by its
subscribers and closed when the last leaves. **`useEvents`'s public API is
unchanged**, so `BoardScreen` was not touched and its tests still pass.

This is the shape `theme/use-theme.ts` already arrived at, for the same reason: a
per-component copy of something inherently shared is a bug waiting for a second
caller.

## Verified against the running instance

| | badge | server |
| --- | --- | --- |
| before | 3 sprints | 3 |
| after create | **4 sprints** | 4 |
| after delete | **3 sprints** | 3 |

**No reload**, and both changes were made *outside this tab's UI* — so this also
covers the case option 2 could never reach: a sprint **someone else** deleted.

LAI-070's behaviour re-checked after the refactor: pill `LIVE · SSE`, feed
seeded, and a task created elsewhere appeared on the board without a reload.

## On AC3

*"Check the rendered count, rather than checking that a refetch function
exists."* The rendered check is the table above — `@laika/web` has no renderer
by design (CONVENTIONS §4), so it cannot be a unit test. What **is** unit-tested
is the decision the hook makes and the guarantee underneath it:

- `event-stream.test.ts` — one connection for N consumers, a fresh one after the
  last leaves, fan-out to all, control frames kept distinct. Proven able to fail
  by restoring one-connection-per-subscriber: three tests go red.
- `shell-context-refresh.test.ts` — the trigger list. Proven twice: removing
  `project.updated` (the frame sprints actually emit) fails, and adding
  `sprint.deleted` fails because **the server can never send it** — the exact
  mistake LAI-070 made by writing type names from memory.

AC2 is met by construction: there is no timer anywhere in this change.

## Review — PM, 2026-08-26

**Accepted.** The sidebar count no longer lies after a mutation.

Your framing when you filed it is the part worth keeping: *"a number that came
from the API and has since stopped being true is as wrong as a fixture, and
harder to spot, because it was right a moment ago."* That is a better statement
of the rule than "no hardcoded data" — it covers the case that rule misses.

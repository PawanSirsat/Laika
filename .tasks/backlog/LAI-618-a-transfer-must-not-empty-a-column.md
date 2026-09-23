---
id: LAI-618
title: Taking a status must not leave the other column holding nothing
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-617
status: backlog
---

## Goal

`PUT /projects/:slug/board-columns/:id/statuses` **refuses** an empty list:

```
{"statuses":[]}  ->  422
"Invalid request body … expected array to have >=1 items"
```

But it will produce exactly that state as a side effect. A status belongs to
one column, so writing it into column B removes it from column A — and the
validation guards **the column being written**, never the one losing one.

Reproduced on a stock demo board. `Testing` held `['review']` and nothing else:

```bash
PUT .../board-columns/<in-progress>/statuses  {"statuses":["in_progress","review"]}
-> 200

In progress    ['in_progress', 'review']
Testing        []            <-- emptied, by a request that never named it
To do          ['todo', 'backlog']
```

A column holding no statuses can never contain a card. On the owner's live
board this is a `BACKLOGS` column reading `0` next to a `TO DO` column holding
`backlog` — which is what made them report it as a major bug.

## Acceptance criteria

- [ ] A `PUT` that would leave **another** column with no statuses is refused
      with the same clarity as the direct case — naming the column that would
      be emptied, not a generic `422`.
- [ ] Or, if the product decision is that emptying is allowed, the emptied
      column is **deleted** in the same transaction rather than left as a row
      that can never hold anything. Either is defensible; the current state,
      where it survives holding nothing, is not.
- [ ] Whichever is chosen, a test drives the **transfer** path — not just the
      direct `statuses: []` write, which is already guarded and already passes.
      That asymmetry is the whole bug.
- [ ] Existing boards already in this state are considered: a migration, or a
      documented note that the UI now hides them (LAI-617).

## Notes / context

**The client half is done** and is not a substitute for this. LAI-617 stops the
UI drawing a zero-status column and warns before a click that would empty one.
It cannot stop the state being reached — by the API directly, by the MCP tools,
or by any other client.

**Why the guard reads as complete when it is not.** The validator is on the
request body, and the request body is always valid: `['in_progress','review']`
is two items. The damage is to a row the request never mentions. A test that
only writes `[]` and asserts `422` passes forever while this is broken.

**`server/src/` is CORE's.** Found from the UI side while fixing what it looks
like; filed rather than crossed into.

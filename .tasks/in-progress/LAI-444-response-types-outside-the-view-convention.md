---
id: LAI-444
title: 'A response type that is not a `*View` has no client mirror check'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-213]
discovered-from: LAI-206
status: backlog
---

## Goal

LAI-213's drift check binds a server `*View` type to its client counterpart, in
both directions. **It finds those types by their name.** So a response shape that
does not end in `View` is invisible to it — the client's copy can drift from the
server's and **nothing goes red.**

Found while reviewing LAI-206: `SetupStatusBody` is such a type, on
`GET /api/v1/setup/status` — **an endpoint that answers before anyone
authenticates.**

## Why a naming convention is the wrong load-bearing thing

The convention is good and the check reading it is reasonable. **The problem is
that nothing enforces the convention itself**, so the guard's coverage is a
function of what people happened to call things — and a type gets missed by being
named badly rather than by anyone deciding it should be.

That is the same shape as three other findings this week: a guard whose reach is
decided by something nobody is checking. `use-events.test.ts` reading
`ACTIVITY_TYPES` as text; `parity.test.ts` excluding a tool by an inline `!==`;
`schema-spec-drift` reading §4's tables and therefore treating any table in §4 as
a schema declaration.

## Acceptance criteria

- [ ] **Enumerate what is unguarded first, and put the list in the task.** Every
      exported type that is serialised to a response and does not end in `View`.
      **The count is the finding** — if it is two, this is small; if it is
      fifteen, the naming convention is not being followed and that is the real
      report.
- [ ] Each one is **either renamed to `*View`** — bringing it under the existing
      check with no new machinery — **or added to the check by name**, with a
      reason. Renaming is preferred; a second mechanism is not.
- [ ] **A guard that a new response type cannot be added outside the net.** This
      is the criterion that matters: without it the list is correct today and
      wrong at the next endpoint. Deriving the set from the route handlers'
      return types is one way; a named allow-list with a staleness test is
      another; **an unenforced convention is not.**
- [ ] Prove it: add a throwaway response type outside the convention and watch
      the new guard go red.
- [ ] Full gate green — **`EXIT 0`**, not a pass count.

## Notes / context

**Do not widen LAI-213 by loosening it.** Matching `*View` *or* `*Body` *or*
`*Response` is the version of this fix that looks done and moves the same problem
one suffix along.

**`SetupStatusBody` is covered locally by LAI-158's third criterion**, so this
task is about the class rather than that instance. If the enumeration finds that
it is the only one, say so and close this as fixed by LAI-158 — **that is a valid
outcome and cheaper than building a net for one fish.**

The pre-auth case is the reason for p2 rather than p3: a drifted field on
`/setup/status` is visible to anyone who can reach the port.

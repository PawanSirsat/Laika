---
id: LAI-444
title: 'A response type that is not a `*View` has no client mirror check'
area: server
assignee: core
priority: p2
depends-on: [LAI-213]
discovered-from: LAI-206
status: review
started: 2026-09-01T17:25:00Z
finished: 2026-09-01T17:50:00Z
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

- [x] **Enumerate what is unguarded first, and put the list in the task.** Every
      exported type that is serialised to a response and does not end in `View`.
      **The count is the finding** — if it is two, this is small; if it is
      fifteen, the naming convention is not being followed and that is the real
      report.
- [x] Each one is **either renamed to `*View`** — bringing it under the existing
      check with no new machinery — **or added to the check by name**, with a
      reason. Renaming is preferred; a second mechanism is not.
- [x] **A guard that a new response type cannot be added outside the net.** This
      is the criterion that matters: without it the list is correct today and
      wrong at the next endpoint. Deriving the set from the route handlers'
      return types is one way; a named allow-list with a staleness test is
      another; **an unenforced convention is not.**
- [x] Prove it: add a throwaway response type outside the convention and watch
      the new guard go red.
- [x] Full gate green — **`EXIT 0`**, not a pass count.

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

## Outcome

### The premise is wrong, and the correction changes the fix

**LAI-213's check does not find types by name.** There is no `readdir`, no regex
on `View`, no name-based discovery anywhere in `view-type-drift.test.ts`. It uses
a **hand-written `PAIRS` table of seven entries**, and one of those —
`ProjectSummary` — already does not end in `View`.

So **AC2's preferred remedy accomplishes nothing.** Renaming a type to `*View`
does not bring it under the check; a `PAIRS` entry is the work either way, and
"no new machinery" was never on the table.

### The census (AC1) — 28 served, 7 paired, 21 unguarded

**Twelve of the twenty-one already end in `View`**: `AvatarView`, `CapacityView`,
`HeartbeatView`, `InviteView`, `MetricsView`, `OrgAiView`, `OrgView`,
`ProjectView`, `TagView`, `TokenView`, `UnlistedView` — and `PresenceView`.

**The convention is being followed and the guard does not read it.** Coverage is
decided by a list nobody checks for completeness. That is the task's own
diagnosis — *"a guard whose reach is decided by something nobody is checking"* —
one layer lower than it supposed: not the naming, the table.

**Fourteen have a client counterpart today and are simply unpaired.** Filed as
**LAI-160** with the full mapping. **`TokenView` is the one to look at: client and
server use the identical name and are still not compared.**

**Seven have no client mirror at all** — the unbuilt screens. They cannot be
paired and want a different reason from the fourteen, so the map keeps them apart.

The Notes' escape hatch — *"if the enumeration finds it is the only one, close
this as fixed by LAI-158"* — does not apply. It is not one fish.

### What was built

`server/test/tooling/response-type-coverage.test.ts`: derive what the server
serves, read what `PAIRS` covers, require the difference to be **named**. Six
assertions, of which two exist only to stop the other four passing over empty
sets.

Served is derived from **two independent signals** — an exported `*View`, and a
type named in a `c.json<…>` — rather than "every exported interface", which would
be mostly inputs and options and would be exempted into uselessness.

It reads `web/` and never writes it, the same standing as `structure.test.ts`
(both trees) and `env-contract.test.ts` (`docker/`). **`PAIRS` is SHELL's**, so
adding the fourteen is LAI-160 rather than a crossing.

One assertion checks that each entry claiming a client mirror **names a type that
exists** — a wrong guess would send LAI-160 hunting for something imaginary and
nothing else would catch it.

### Proof (AC4)

| mutation | result |
| --- | --- |
| a new `DiagnosticsView` response type nobody paired | red — `"DiagnosticsView"` |
| a new `DiagnosticsPayload`, **not** ending in `View`, served via `c.json` | red — `"DiagnosticsPayload"` |
| pair `TokenView` in `PAIRS`, leaving the exemption behind | red — *"TokenView is paired now — remove it from UNPAIRED"* |

**The first two are the corrected diagnosis demonstrated rather than argued**: the
net catches by what is *served*, not by what it is called.

### Gate

`@laika/server` **1748/1748**, `cli` 19/19, `pnpm lint` EXIT=0, `pnpm format`
EXIT=0. `server/web` red on LAI-208's declared assertion only.

### On §2

I claimed this one in two commits, which is what produced the red you are holding
LAI-400 for. **From LAI-159 onward I claim in one commit**, whatever §2 ends up
saying, so nothing of mine holds a landing in the meantime.

---
id: LAI-160
title: Fourteen server response types have a client mirror and no pair
area: web
assignee: shell
priority: p2
depends-on: [LAI-444]
discovered-from: LAI-444
started: 2026-09-01T18:15:00+05:30
finished: 2026-09-01T18:50:00+05:30
status: review
---

## Goal

LAI-444 counted the surface. **The server serves 28 response types; `PAIRS`
covers 7.** Of the 21 unguarded, **fourteen already have a client counterpart** —
the mirror exists, the pair was never added, and the two can drift with nothing
going red.

`PAIRS` lives in `server/web/test/api/view-type-drift.test.ts`, which is SHELL's,
so this is a task rather than a crossing.

## The fourteen

| server type | `serverFile` | client type | `clientFile` |
| --- | --- | --- | --- |
| `AcceptedInviteBody` | `http/routes/invites.ts` | `AcceptedInvite` | `invites.ts` |
| `CreatedInviteBody` | `http/routes/invites.ts` | `CreatedInvite` | `invites.ts` |
| `CreatedTokenBody` | `http/routes/tokens.ts` | `CreatedToken` | `tokens.ts` |
| `HealthBody` | `http/routes/health.ts` | `Health` | `health.ts` |
| `InvitePreview` | `services/invites.ts` | `InvitePreview` | `invites.ts` |
| `InviteView` | `services/invites.ts` | `PendingInvite` | `invites.ts` |
| `MeProfile` | `services/me.ts` | `MeProfile` | `me.ts` |
| `ProjectContextView` | `services/projects.ts` | `ProjectContext` | `project-context.ts` |
| `ProjectView` | `services/projects.ts` | `Project` | `projects.ts` |
| `SetupResultBody` | `http/routes/setup.ts` | `SetupResult` | `setup.ts` |
| `SetupStatusBody` | `http/routes/setup.ts` | `SetupStatus` | `setup.ts` |
| `TagView` | `services/tags.ts` | `ProjectTag` | `tags.ts` |
| `TokenView` | `services/tokens.ts` | `TokenView` | `tokens.ts` |
| `UnlistedView` | `services/unlisted.ts` | `UnlistedWork` | `unlisted.ts` |

`clientFile` is the likely module and worth confirming — the server side and the
client type name are the parts LAI-444 verified.

**`TokenView` is the one to notice.** Client and server use the *identical name*
and are still not compared, which is the sharpest evidence that the naming
convention is not what decides coverage.

**`SetupStatusBody` is pre-auth** (`GET /api/v1/setup/status`) and is why LAI-444
is p2. LAI-158 covers that one locally; this brings it under the general check.

## Acceptance criteria

- [x] Each of the fourteen has a `PAIRS` entry, or a `clientOmits` entry with a
      reason where a field is deliberately not mirrored.
- [x] `server/test/tooling/response-type-coverage.test.ts` goes green as entries
      land — **each pair added must be deleted from its `UNPAIRED` map**, and the
      staleness test fails until it is. That file is CORE's; the deletions are a
      one-line change per entry and are the named crossing this task authorises,
      **or** hand them back and CORE removes them as you land.
- [x] The seven with **no** client type — `AvatarView`, `CapacityView`,
      `HeartbeatView`, `MetricsView`, `OrgAiView`, `OrgView`, `PresenceView` —
      are **not** in scope. They feed unbuilt screens and get their pair when the
      screen does.
- [x] Full gate `EXIT 0`.

## Notes

**Adding a pair can go red, and that is the point.** These have never been
compared; some will turn out to disagree. A disagreement found here is a real
client/server drift and wants its own task rather than a `clientOmits` entry that
papers over it — `clientOmits` is for a field the client deliberately does not
mirror, not for one it got wrong.

No new dependencies.


---

## Submitted — SHELL, 2026-09-01

**Thirteen pairs added, not fourteen — and `PAIRS` goes from 7 to 20.** Root gate
`EXIT 0`: 1748 server, 604 web, 49 cli, zero
`Unhandled|Errors|Failed|not ok`.

Two of the fourteen went red, which is the number the Notes said to expect. They
were not the same kind of thing.

### `SetupStatusBody.system` — real, and declared rather than exempted

Served since LAI-206, mirrored by nothing. **The client type is declared now**,
not `clientOmits`'d: the omission was never a decision, and an exemption would
have filed it as one. That follows `Task.blocks` and `Task.sprint_id`, which are
declared with a note naming who renders them — here, **LAI-158**, which was
already filed and now has a type to render from.

`SetupSystemStatus`, not `SystemStatus`, because `routes/screens/SystemStatus.tsx`
is the component that draws it and one name for the wire shape and its renderer
makes every import site pick which it meant.

### `ProjectView` — the table is wrong, and I have not paired it

**It was never unpaired.** `PAIRS` has `ProjectSummary` → `Project`,
`ProjectSummary extends ProjectView`, and **`fieldsOf` resolves `extends`** — so
every `ProjectView` field is already compared.

Adding the entry the table asks for made the check **red, correctly**: it asserts
the base type sends `task_counts`, `member_count`, `blocked_count`, `members` and
`last_activity_at`, which are the five the summary derives and the base must not
send.

So **LAI-444's census counts a literal name in `PAIRS` and cannot see coverage
inherited through `extends`.** Its total is not a to-do list. The reason is
written where somebody would go to re-add the entry — beside the `ProjectSummary`
pair — rather than only here.

### The census: thirteen deleted, `ProjectView` handed back

`ProjectView`'s row is **left exactly as it was**. Trying to reclassify it turned
`names a client type that exists` red: the map's second column is *the client
type*, and prose fails it. **There is no slot for "covered another way"** — which
is the finding rather than an inconvenience, and designing one is CORE's call, so
I said why in their file and changed nothing else.

### Verified the pairs are not vacuous

A pair whose parser finds nothing compares an empty set to an empty set and
passes. All **20** were probed for field counts before I trusted the green:

```
 9 vs  9  TokenView → TokenView       8 vs  8  UnlistedView → UnlistedWork
 8 vs  8  InvitePreview → InvitePreview     9 vs  9  InviteView → PendingInvite
 2 vs  2  SetupStatusBody → SetupStatus     … every pair compares real fields
```

And two mutations, both **red**: a server field the client lacks (`TokenView`),
and a client field the server does not send (`Health`).

### Scale, since you asked

**Small.** Twelve of the fourteen agreed already. The convention is being
followed and the guard simply was not reading it — which is what LAI-444
concluded, now confirmed from the other side.

---
id: LAI-160
title: Fourteen server response types have a client mirror and no pair
area: web
assignee: shell
priority: p2
depends-on: [LAI-444]
discovered-from: LAI-444
started: 2026-09-01T18:15:00+05:30
status: in-progress
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

- [ ] Each of the fourteen has a `PAIRS` entry, or a `clientOmits` entry with a
      reason where a field is deliberately not mirrored.
- [ ] `server/test/tooling/response-type-coverage.test.ts` goes green as entries
      land — **each pair added must be deleted from its `UNPAIRED` map**, and the
      staleness test fails until it is. That file is CORE's; the deletions are a
      one-line change per entry and are the named crossing this task authorises,
      **or** hand them back and CORE removes them as you land.
- [ ] The seven with **no** client type — `AvatarView`, `CapacityView`,
      `HeartbeatView`, `MetricsView`, `OrgAiView`, `OrgView`, `PresenceView` —
      are **not** in scope. They feed unbuilt screens and get their pair when the
      screen does.
- [ ] Full gate `EXIT 0`.

## Notes

**Adding a pair can go red, and that is the point.** These have never been
compared; some will turn out to disagree. A disagreement found here is a real
client/server drift and wants its own task rather than a `clientOmits` entry that
papers over it — `clientOmits` is for a field the client deliberately does not
mirror, not for one it got wrong.

No new dependencies.

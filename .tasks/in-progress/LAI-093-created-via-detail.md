---
id: LAI-093
title: '`created_via` says "agent" but never which agent'
area: server
assignee: core
priority: p2
depends-on: [LAI-011]
discovered-from:
status: in-progress
started: 2026-09-01T12:30:00Z
---

## Goal

The design's task detail reads **`created via agent · mira-cli`** — the channel
*and* the client. `created_via` is a closed enum
(`web` | `mcp` | `api` | `webhook` | `meeting`) and carries no name, so the most
we can render is `created via api`.

**On a board where agents and humans share one task list, "which agent" is the
attribution that matters.** D-010 makes humans and agents equal participants and
D-007 says agents never self-certify — both assume a reader can tell *who* acted.
Today an agent-created task is indistinguishable from a curl.

## Acceptance criteria

- [ ] A task records the client that created it, not only the channel. **Check
      what already exists before adding a column** — `activity.actor_token_id` is
      on every row (§4.8) and tokens are named, so the name may already be
      reachable by join rather than by duplication.
- [ ] If it is reachable, expose it and add no column. **A second copy of a name
      that can be derived will drift from the token it came from.**
- [ ] Works for tasks created before this lands — old rows have no client and
      must render as `created via api`, not as a blank or "unknown".
- [ ] The same treatment for comments if it is free; do not widen if it is not.
- [ ] §4.5/§4.9/§6.4 updated as needed (D-011).

## Notes / context

**M3 is where this becomes real** — tokens are what carry an agent's identity,
and until they land the only writer is a browser session. Worth doing now anyway:
the shape decided here is what M3 populates, and deciding it under load is worse.

**Do not invent a display name from the user agent string.** It is attacker
-controlled and it is not identity.

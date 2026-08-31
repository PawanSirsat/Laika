---
id: LAI-093
title: '`created_via` says "agent" but never which agent'
area: server
assignee: core
priority: p2
depends-on: [LAI-011]
discovered-from:
status: review
started: 2026-09-01T12:30:00Z
finished: 2026-09-01T12:55:00Z
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

- [x] A task records the client that created it, not only the channel. **Check
      what already exists before adding a column** — `activity.actor_token_id` is
      on every row (§4.8) and tokens are named, so the name may already be
      reachable by join rather than by duplication.
- [x] If it is reachable, expose it and add no column. **A second copy of a name
      that can be derived will drift from the token it came from.**
- [x] Works for tasks created before this lands — old rows have no client and
      must render as `created via api`, not as a blank or "unknown".
- [x] The same treatment for comments if it is free; do not widen if it is not.
- [ ] §4.5/§4.9/§6.4 updated as needed (D-011).

## Notes / context

**M3 is where this becomes real** — tokens are what carry an agent's identity,
and until they land the only writer is a browser session. Worth doing now anyway:
the shape decided here is what M3 populates, and deciding it under load is worse.

**Do not invent a display name from the user agent string.** It is attacker
-controlled and it is not identity.

## Notes back — CORE, 2026-09-01

**Derived, no column** — the criterion's first instruction, and it was reachable:
`activity.actor_token_id` (§4.8) joined to `tokens.name`. The test that makes it
concrete is *"follows a rename rather than keeping the old name"*: a stored copy
would still say `mira-cli` after the token was renamed and nothing would ever
reconcile them.

`null` — never `"unknown"` — for all three causes: browser session, task older
than tokens, token since deleted (`ON DELETE set null` means the audit row
outlives the name). They mean the same thing to a reader, and the honest absence
beats a word invented for it.

**Comments: not done, because not free.** `activity` has a `task_id` column but
no `comment_id` — a comment's id lives in the payload JSON, so the same join
would mean matching serialised text. The criterion said not to widen if it was
not free.

**AC5 (§4.5/§4.9/§6.4) is unticked, and I would like your ruling.** §4.5's table
lists *columns*, and `created_by_client` is deliberately not one, so it does not
belong there. What may be worth a line is §4.9: **`tokens.name` is now a
wire-visible value**, which quietly constrains what renaming or deleting a token
means for anyone reading a task. Proposed rather than assumed — `docs/` is
yours, and I would rather you wrote it than ratified mine. If you would rather
it stayed unsaid, say so and I will tick the criterion as considered-and-declined
with your reason.

**One thing about my tooling, since I have been reporting its output to you.**
The `innerJoin → leftJoin` mutation came back `STAYED GREEN` and I nearly
recorded a test gap. It is not one — `pnpm typecheck` rejects it, and typecheck
is part of `pnpm test` since LAI-136. **My harness runs `npx vitest` directly and
so bypasses the gate I added yesterday.** "Stayed green" from it means "vitest
did not catch it", not "nothing catches it", and I have been reading it as the
stronger claim.

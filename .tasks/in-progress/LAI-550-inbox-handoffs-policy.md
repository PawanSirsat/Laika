---
id: LAI-550
title: 'Inbox → Hand-offs (Received/Sent/Needs approval/Recovery), badge counts, Access-tab hand-off policy controls'
area: web
assignee: shell
priority: p1
depends-on: [LAI-546]
discovered-from:
status: in-progress
started: 2026-10-30T06:02:00+02:00
---

Implements **proposal §6 (Inbox, Settings → Access), §4.5** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A human sees every hand-off that needs their action in one Inbox tab,
with a badge that counts only open items for them, and sets the project's
hand-off policy on the Access tab.

## Scope

- New `INBOX_TABS` entry Hand-offs with filters Received, Sent, Needs approval, Recovery.
- `inboxCount` includes open items needing *your* action only.
- Access tab: `allow_other_owners`, `cross_owner_requires_approval`, `max_handoffs`, `offer_ttl_minutes`.

## Out of scope

- The dialog (LAI-549)

## Acceptance criteria

- [ ] Expired or resolved offers never count in the badge (asserted).
- [ ] A non-admin sees the policy read-only; the server refuses their write (e2e).
- [ ] Filters reflect API data; no hardcoded counts.
- [ ] Both themes, keyboard, 390 px.
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Vitest; Playwright e2e for badge and policy; screenshots.

## Dependencies

`depends-on: [LAI-546]`.

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2 days, confidence M.

## Branch

`LAI-550-inbox-handoffs`

## Migration / rollout notes

None. LAI-976 / LAI-977 (Access tab, in review) must be merged or rebased onto first.

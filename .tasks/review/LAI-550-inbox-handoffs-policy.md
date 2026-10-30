---
id: LAI-550
title: 'Inbox → Hand-offs (Received/Sent/Needs approval/Recovery), badge counts, Access-tab hand-off policy controls'
area: web
assignee: shell
priority: p1
depends-on: [LAI-546]
discovered-from:
status: review
finished: 2026-10-30T08:05:00+02:00
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

- [x] Expired or resolved offers never count in the badge (asserted).
- [x] A non-admin sees the policy read-only; the server refuses their write (e2e).
- [x] Filters reflect API data; no hardcoded counts.
- [x] Both themes, keyboard, 390 px.
- [x] Repo-root gate exits 0.

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

## Builder notes (SHELL, Belka, 2026-10-30)

- **Built on LAI-1009** (PR #156, `GET /handoff-offers`), merged into this
  branch on CHIEF's direction; this PR targets `LAI-1009-person-handoff-inbox`
  until #156 merges. The first plan — a per-task fan-out — was dropped.
- **Badge** = `counts.received + counts.needs_approval`, the server's live,
  unexpired counts; nothing is counted from rows. The server half of *expired
  or resolved never count* is LAI-1009's
  `person-handoff-inbox.test.ts` (*counts every view, live and unexpired
  only*); the client half is `person-handoffs.test.ts` and
  `inbox-handoffs.test.ts` (an expired row on screen leaves the badge at 4).
- **The server refusing a member's policy write** is asserted in
  `server/test/services/handoffs.test.ts` (member → `forbidden`); the browser
  test shows a member every value with no control, and a refused save said
  beside the form.
- **Work requests are not on the person inbox** (LAI-1009: *they are the
  agent's to answer*), so the Hand-offs tab distinguishes hand-off and
  recovery offers; the drawer keeps the work request.
- **Named crossing** (CHIEF-authorised): the three `UNPAIRED` entries for
  `PersonHandoffView`, `PersonHandoffInbox` and `HandoffPolicyView` in
  `server/test/tooling/response-type-coverage.test.ts`, removed in the commit
  that pairs them.
- *Name the receiver* of an unnamed recovery (`next_action: name_receiver`) is
  worded, not built: approving with `to_agent_id` needs an agent picker for
  another owner's agents, which no endpoint lists for a person.


---
id: LAI-1151
title: 'Your own developer access: pending pairing requests and recent setup activity'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-1149]
status: backlog
---

## Goal

Your own Developer access tab (design frame F) draws what the admin's
Developer setup read serves for someone else: your pending pairing requests
(to approve or decline) and your recent setup activity over 30 days. Neither
has a `/me` read today.

## Acceptance criteria

- [ ] A session read of your own pending pairing requests (device label,
      platform, requested at, key fingerprint for the approve call) — never the
      pairing code (D-124, D-132 item 2).
- [ ] A session read of your own recent setup activity, 30 days, the same items
      `/people/:id/developer-setup` lists for an admin; no look written.
- [ ] Policy rows in §3.1 and the routes in §6.4 (named edits); tests for both
      reads and that another person's requests never appear.

## Notes / context

Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion. Approve and decline already exist (`POST /devices/pairing-requests/:id/approve|deny`). CORE's area.

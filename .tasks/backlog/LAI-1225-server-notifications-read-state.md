---
id: LAI-1225
title: 'Server-side notifications for what waits on a person, with read state across devices'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1221
status: backlog
---

## Why

LAI-1221 put a notifications bell in the app header. It is built only from
what the client can already read, and that splits *read* in two:

- **Notices** (`GET /me/notices`, D-134 — added to a space, a tool, device or
  token revoked, confirmed time changed) carry the server's `read_at`; the
  bell reads them, opens them with `POST /me/notices/:id/read` and *Mark all
  as read* calls `POST /me/notices/read-all`. That works.
- **Everything that waits on the reader** — review decisions
  (`GET /review`, `can_decide`), hand-offs (`GET /handoff-offers`, views
  `received` and `needs_approval`), open unlisted work (`GET /unlisted`,
  `audit_log.export`) and token alerts (`GET /me/token-alerts`) — has no read
  state on the server. The bell counts these as new when they arrived after a
  per-device *last seen* time in `localStorage`
  (`laika.notifications.seen.<userId>`) and says *on this device* in the UI.
  So a review marked read on the laptop is new again on the phone.

No endpoint exposes **@mentions** to the person mentioned
(`GET /projects/:slug/mentionable` lists who *can* be mentioned; comments
carry mentions, but nothing addresses them to a reader), so the bell has no
mentions at all.

## What is wanted (a proposal — CHIEF and CORE decide the shape)

- One person-scoped feed, or new `NoticeKind`s on the existing notices
  table, for: a review waiting on the reader's decision, a hand-off offered to
  or needing approval from them, an @mention of them in a comment, a token
  alert, and — for `audit_log.export` holders — unlisted work logged. Each
  item addressed to one person, gated by the same `can()` actions the source
  endpoints use, with `read_at`.
- `unread_count` across all kinds, so the bell's badge is one server number.
- An SSE verb (or the existing frames on a person-level stream) so a new item
  reaches an open tab without polling; today the bell refreshes from the open
  space's shared stream and the shell's one-minute polls.

## Then (SHELL, separate task)

Swap the bell's derived sources and the per-device *last seen* for the feed;
drop the *on this device* wording. The client half lives in
`server/web/src/components/shell/notifications-model.ts` and
`use-notifications.ts`.

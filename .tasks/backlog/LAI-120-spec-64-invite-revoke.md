---
id: LAI-120
title: SPEC §6.4 is missing the invite revoke endpoint
area: docs
assignee: unclaimed
priority: p3
depends-on: [LAI-071]
discovered-from: LAI-071
status: backlog
---

## Goal

LAI-071 AC8 asks the spec to gain the invite endpoints. **Four of the five were
already there** — §6.4 lines 518-519 list `GET /invites`, `POST /invites`,
`POST /invites/accept` and `GET /invites/:token`, so the AC's premise is mostly
already satisfied and nothing was needed for them.

The fifth is not there. AC2 asks for revoke, §6.4 describes no way to do it, and
LAI-071 built `DELETE /api/v1/invites/:id`. D-011 makes the spec authoritative, so
the built endpoint is currently ahead of the document.

**`docs/` is PM's**, which is the only reason this is a task rather than an edit.

## Acceptance criteria

- [ ] §6.4 gains `DELETE /api/v1/invites/:id` beside the other four, marked
      `admin+` like the rest of the row.
- [ ] The line records that revoking **deletes the row** rather than setting a
      state: §4.11 has no `revoked_at`, a revoked pending invite is
      indistinguishable to every caller from one that never existed, and nothing
      references it. An accepted invite is different and answers `409` — it is the
      record of how somebody got in.
- [ ] LAI-071 AC8 is ticked when this lands, or PM ticks it on accept and notes
      that the missing half travelled here.

## Notes / context

Two facts from the build worth having in the spec if PM thinks they belong there,
and worth deciding rather than leaving to the next reader:

- **Invites expire after 7 days**, matching §4.12's meeting-review window; §11.6
  already lists "invite expiry" in the cron sweep but names no number.
- **No mail is sent.** The create response carries `email_sent: false` and an
  `accept_url` the inviter passes on by hand. §11.7 configures no SMTP and nothing
  reads one, so a UI that says "invitation sent" would be lying.

Related: LAI-080 is about "specified, not yet built" turning the drift check red.
This is the mirror case — built, not yet specified — and it does **not** turn
anything red today, because LAI-051 checks §4 against `schema.ts` and nothing
checks §6.4 against the routes. That gap may be worth its own task.
